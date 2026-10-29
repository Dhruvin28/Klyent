import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GradientEquirectTexture } from 'three-gpu-pathtracer'
import { DEFAULT_FINISH, LIGHTING_LOOKS, PARAMETRIC, kelvinToHex } from './defaults'
import {
  add,
  centroid,
  clampOpeningOffset,
  openingSpan,
  pointInPolygon,
  roomInnerPolygon,
  scale,
  wallDir,
  wallExtensions,
  wallLeftNormal,
  wallLength,
} from './geometry'
import { MaterialResolver } from './materials'
import { buildParametric } from './parametric'
import type { DesignModel, Item, Opening, Plan, Room, Vec2, Wall } from './types'

const MM = 0.001

/** What a click in 3D landed on. */
export type PickTarget =
  | { kind: 'wall'; id: string; side: 'left' | 'right' }
  | { kind: 'floor'; id: string }
  | { kind: 'ceiling'; id: string }
  | { kind: 'item'; id: string; slot: string | null }
  | { kind: 'opening'; id: string }

/** Plan (mm, y down) → world (m, y up). */
export const toWorld = (p: Vec2, y = 0) => new THREE.Vector3(p.x * MM, y, p.y * MM)

// ── GLB model cache (shared by every scene in the tab) ──

interface LoadedModel {
  scene: THREE.Object3D
  box: THREE.Box3
}
const modelCache = new Map<string, Promise<LoadedModel | null>>()

export function loadModel(model: DesignModel, loadAsset: (id: string) => Promise<Blob>): Promise<LoadedModel | null> {
  let p = modelCache.get(model.glbAssetId)
  if (!p) {
    p = loadAsset(model.glbAssetId)
      .then((b) => b.arrayBuffer())
      .then((buf) => new GLTFLoader().parseAsync(buf, ''))
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        gltf.scene.updateMatrixWorld(true)
        return { scene: gltf.scene, box: new THREE.Box3().setFromObject(gltf.scene) }
      })
      .catch(() => {
        modelCache.delete(model.glbAssetId)
        return null
      })
    modelCache.set(model.glbAssetId, p)
  }
  return p
}

// ── Mesh helpers ──

/** Planar face from a 2D shape mapped onto an (origin, xAxis, yAxis) frame; normal = x × y. */
function faceFromShape(shape: THREE.Shape, origin: THREE.Vector3, xAxis: THREE.Vector3, yAxis: THREE.Vector3) {
  const geo = new THREE.ShapeGeometry(shape)
  const z = new THREE.Vector3().crossVectors(xAxis, yAxis)
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(xAxis, yAxis, z).setPosition(origin))
  return geo
}

/** Builds a non-indexed geometry from quads whose winding is fixed to face `normal`. */
class QuadBuilder {
  positions: number[] = []
  uvs: number[] = []
  quad(p: THREE.Vector3[], normal: THREE.Vector3, uvSize: [number, number]) {
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]))
    const q = n.dot(normal) < 0 ? [p[0], p[3], p[2], p[1]] : p
    const uv = [
      [0, 0],
      [uvSize[0], 0],
      [uvSize[0], uvSize[1]],
      [0, uvSize[1]],
    ]
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(q[i].x, q[i].y, q[i].z)
      this.uvs.push(uv[i][0], uv[i][1])
    }
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    g.computeVertexNormals()
    return g
  }
}

function tagMesh(geo: THREE.BufferGeometry, mat: THREE.Material, target: PickTarget | null, shadows = true) {
  const m = new THREE.Mesh(geo, mat)
  m.userData.target = target
  m.castShadow = shadows
  m.receiveShadow = true
  return m
}

interface WallInfo {
  group: THREE.Group
  mid: THREE.Vector3
  /** Outward normal of the exterior side, or null for interior partitions. */
  exterior: THREE.Vector3 | null
}

export interface SceneContext {
  library: MaterialResolver
  models: Map<string, DesignModel>
  loadAsset: (id: string) => Promise<Blob>
}

/**
 * The three.js representation of a plan. Rebuilt wholesale on every plan change
 * (plans are small); materials and model downloads are cached across rebuilds.
 */
export class DesignScene {
  readonly scene = new THREE.Scene()
  private content = new THREE.Group()
  private walls: WallInfo[] = []
  private ceilings: THREE.Object3D[] = []
  private itemGroups = new Map<string, THREE.Object3D>()
  private pending: Promise<unknown>[] = []
  private sky: GradientEquirectTexture | null = null
  private selectionHelper: THREE.BoxHelper | null = null
  sun = new THREE.DirectionalLight()
  wallHeight = 2.7
  /** World-space bounds of the plan contents. */
  bounds = new THREE.Box3()

  constructor(private ctx: SceneContext) {
    this.scene.add(this.content)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.sun, this.sun.target)
  }

  setModels(models: Map<string, DesignModel>) {
    this.ctx.models = models
  }

  /** Resolves when all textures and models requested by the last build have loaded. */
  async ready() {
    await Promise.allSettled(this.pending)
    await this.ctx.library.ready()
  }

  build(plan: Plan) {
    this.clear()
    this.wallHeight = plan.wallHeight * MM
    const lib = this.ctx.library
    const wallsById = new Map(plan.walls.map((w) => [w.id, w]))

    for (const w of plan.walls) this.buildWall(w, plan, plan.openings.filter((o) => o.wallId === w.id))
    for (const o of plan.openings) {
      const w = wallsById.get(o.wallId)
      if (w) this.buildOpeningFill(w, o, plan)
    }
    for (const r of plan.rooms) this.buildRoom(r, plan)
    for (const it of plan.items) this.buildItem(it)
    this.buildLights(plan)

    this.bounds.setFromObject(this.content)
    if (this.bounds.isEmpty()) this.bounds.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2.7, 3))
    this.placeSun(plan)
    void lib
  }

  /** Hides exterior walls between the camera and the interior, and ceilings when looking from above. */
  applyCamera(camera: THREE.Camera) {
    const p = camera.position
    for (const w of this.walls) {
      w.group.visible = !(w.exterior && new THREE.Vector3(p.x - w.mid.x, 0, p.z - w.mid.z).dot(w.exterior) > 0.05)
    }
    const inside = p.y < this.wallHeight - 0.05
    for (const c of this.ceilings) c.visible = inside
  }

  /** Shows every wall and ceiling (for path-traced renders from inside a room). */
  showAll() {
    for (const w of this.walls) w.group.visible = true
    for (const c of this.ceilings) c.visible = true
  }

  /** Highlights a plan item, wall or opening with a bounding box. */
  setSelection(id: string | null) {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper)
      this.selectionHelper.dispose()
      this.selectionHelper = null
    }
    if (!id) return
    const obj = this.itemGroups.get(id)
    if (!obj) return
    this.selectionHelper = new THREE.BoxHelper(obj, 0x2563eb)
    this.selectionHelper.userData.helper = true
    this.scene.add(this.selectionHelper)
  }

  /** Objects that should be raycast for picking. */
  pickables(): THREE.Object3D[] {
    return [this.content]
  }

  dispose() {
    this.clear()
    this.sky?.dispose()
  }

  // ── builders ──

  private clear() {
    this.setSelection(null)
    this.content.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !m.userData.sharedGeometry) m.geometry.dispose()
    })
    this.scene.remove(this.content)
    this.content = new THREE.Group()
    this.scene.add(this.content)
    this.walls = []
    this.ceilings = []
    this.itemGroups.clear()
    this.pending = []
  }

  private buildWall(w: Wall, plan: Plan, openings: Opening[]) {
    const L = wallLength(w) * MM
    if (L < 0.01) return
    const H = (w.height ?? plan.wallHeight) * MM
    const T = w.thickness * MM
    const ext = wallExtensions(w, plan.walls)
    const u0 = -ext.a * MM
    const u1 = L + ext.b * MM
    const d2 = wallDir(w)
    const n2 = wallLeftNormal(w)
    const d = new THREE.Vector3(d2.x, 0, d2.y)
    const nL = new THREE.Vector3(n2.x, 0, n2.y)
    const up = new THREE.Vector3(0, 1, 0)
    const A = toWorld(w.a)
    const group = new THREE.Group()
    group.userData.wallId = w.id

    const holes = openings
      .map((o) => {
        const width = Math.min(o.width, wallLength(w) - 20)
        const off = clampOpeningOffset(o.offset, width, wallLength(w))
        const s = openingSpan({ offset: off, width })
        return { s: s.start * MM, e: s.end * MM, y0: o.sill * MM, y1: Math.min(H - 0.02, (o.sill + o.height) * MM) }
      })
      .filter((h) => h.e - h.s > 0.05 && h.y1 - h.y0 > 0.05)

    // Side faces with holes. Right face: shape (u, v) on frame (d, up) → normal -nL.
    const shape = (mirror: boolean) => {
      const sx = mirror ? -1 : 1
      const s = new THREE.Shape()
      s.moveTo(sx * u0, 0)
      s.lineTo(sx * u1, 0)
      s.lineTo(sx * u1, H)
      s.lineTo(sx * u0, H)
      s.closePath()
      for (const h of holes) {
        const hole = new THREE.Path()
        // Doors reaching the floor are cut 1mm above it so the outline stays closed.
        const y0 = Math.max(0.001, h.y0)
        hole.moveTo(sx * h.s, y0)
        hole.lineTo(sx * h.s, h.y1)
        hole.lineTo(sx * h.e, h.y1)
        hole.lineTo(sx * h.e, y0)
        hole.closePath()
        s.holes.push(hole)
      }
      return s
    }
    const lib = this.ctx.library
    const rightGeo = faceFromShape(shape(false), A.clone().addScaledVector(nL, -T / 2), d, up)
    const leftGeo = faceFromShape(shape(true), A.clone().addScaledVector(nL, T / 2), d.clone().negate(), up)
    group.add(tagMesh(leftGeo, lib.get(w.left ?? DEFAULT_FINISH.wall, DEFAULT_FINISH.wall), { kind: 'wall', id: w.id, side: 'left' }))
    group.add(tagMesh(rightGeo, lib.get(w.right ?? DEFAULT_FINISH.wall, DEFAULT_FINISH.wall), { kind: 'wall', id: w.id, side: 'right' }))

    // Reveals, end caps and top.
    const P = (u: number, v: number, s: number) => A.clone().addScaledVector(d, u).addScaledVector(up, v).addScaledVector(nL, s)
    const edges = new QuadBuilder()
    const top = new QuadBuilder()
    const t2 = T / 2
    top.quad([P(u0, H, t2), P(u1, H, t2), P(u1, H, -t2), P(u0, H, -t2)], up, [u1 - u0, T])
    edges.quad([P(u0, 0, t2), P(u0, H, t2), P(u0, H, -t2), P(u0, 0, -t2)], d.clone().negate(), [T, H])
    edges.quad([P(u1, 0, t2), P(u1, H, t2), P(u1, H, -t2), P(u1, 0, -t2)], d, [T, H])
    for (const h of holes) {
      const y0 = Math.max(0.001, h.y0)
      edges.quad([P(h.s, y0, t2), P(h.s, h.y1, t2), P(h.s, h.y1, -t2), P(h.s, y0, -t2)], d, [T, h.y1 - y0])
      edges.quad([P(h.e, y0, t2), P(h.e, h.y1, t2), P(h.e, h.y1, -t2), P(h.e, y0, -t2)], d.clone().negate(), [T, h.y1 - y0])
      edges.quad([P(h.s, h.y1, t2), P(h.e, h.y1, t2), P(h.e, h.y1, -t2), P(h.s, h.y1, -t2)], up.clone().negate(), [h.e - h.s, T])
      if (y0 > 0.002) edges.quad([P(h.s, y0, t2), P(h.e, y0, t2), P(h.e, y0, -t2), P(h.s, y0, -t2)], up, [h.e - h.s, T])
    }
    group.add(tagMesh(edges.build(), lib.get(DEFAULT_FINISH.trim, DEFAULT_FINISH.trim), { kind: 'wall', id: w.id, side: 'left' }))
    group.add(tagMesh(top.build(), lib.get(DEFAULT_FINISH.wallTop, DEFAULT_FINISH.wallTop), null, false))

    this.content.add(group)
    this.itemGroups.set(w.id, group)

    // Which side faces outside? Probe just past each face for a room.
    const mid2 = scale(add(w.a, w.b), 0.5)
    const probe = (s: number) => add(mid2, scale(n2, s * (w.thickness / 2 + 60)))
    const inRoom = (p: Vec2) => plan.rooms.some((r) => pointInPolygon(p, r.points))
    const leftIn = inRoom(probe(1))
    const rightIn = inRoom(probe(-1))
    const exterior = leftIn && !rightIn ? nL.clone().negate() : rightIn && !leftIn ? nL.clone() : null
    this.walls.push({ group, mid: toWorld(mid2, H / 2), exterior })
  }

  /** Door leaf / window frame and glass inside an opening. */
  private buildOpeningFill(w: Wall, o: Opening, plan: Plan) {
    if (o.type === 'opening') return
    const lib = this.ctx.library
    const L = wallLength(w)
    const width = Math.min(o.width, L - 20)
    const off = clampOpeningOffset(o.offset, width, L)
    const H = (w.height ?? plan.wallHeight) * MM
    const ow = width * MM
    const oh = Math.min(H - 0.02, (o.sill + o.height) * MM) - o.sill * MM
    const T = w.thickness * MM
    const g = new THREE.Group()
    const d2 = wallDir(w)
    const centre = add(w.a, scale(d2, off))
    g.position.copy(toWorld(centre, o.sill * MM))
    g.rotation.y = -Math.atan2(d2.y, d2.x)
    const target: PickTarget = { kind: 'opening', id: o.id }
    const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, m: THREE.Material, shadows = true) => {
      const geo = new THREE.BoxGeometry(bw, bh, bd)
      const mesh = tagMesh(geo, m, target, shadows)
      mesh.position.set(x, y, z)
      g.add(mesh)
    }
    const frame = lib.get(DEFAULT_FINISH.frame, DEFAULT_FINISH.frame)
    const f = 0.045
    if (o.type === 'door') {
      box(f, oh, T + 0.01, -ow / 2 + f / 2, oh / 2, 0, frame)
      box(f, oh, T + 0.01, ow / 2 - f / 2, oh / 2, 0, frame)
      box(ow, f, T + 0.01, 0, oh - f / 2, 0, frame)
      box(ow - 2 * f, oh - f - 0.005, 0.04, 0, (oh - f) / 2, o.flip ? T / 2 - 0.03 : -T / 2 + 0.03, lib.get(DEFAULT_FINISH.door, DEFAULT_FINISH.door))
      const hx = (o.flip ? -1 : 1) * (ow / 2 - f - 0.07)
      for (const s of [-1, 1]) box(0.12, 0.018, 0.018, hx, 1.0, (o.flip ? T / 2 - 0.03 : -T / 2 + 0.03) + s * 0.035, lib.get({ kind: 'color', hex: '#9a9a9f', roughness: 0.3, metalness: 0.9 }, DEFAULT_FINISH.frame))
    } else {
      box(f, oh, 0.07, -ow / 2 + f / 2, oh / 2, 0, frame)
      box(f, oh, 0.07, ow / 2 - f / 2, oh / 2, 0, frame)
      box(ow, f, 0.07, 0, f / 2, 0, frame)
      box(ow, f, 0.07, 0, oh - f / 2, 0, frame)
      if (ow > 0.9) box(0.035, oh - 2 * f, 0.06, 0, oh / 2, 0, frame)
      box(ow - 2 * f, oh - 2 * f, 0.006, 0, oh / 2, 0, lib.glass(), false)
      // Sill board.
      box(ow + 0.06, 0.02, T + 0.04, 0, -0.01, 0, lib.get(DEFAULT_FINISH.trim, DEFAULT_FINISH.trim))
    }
    this.content.add(g)
    this.itemGroups.set(o.id, g)
  }

  private buildRoom(r: Room, plan: Plan) {
    const pts = roomInnerPolygon(r, plan.walls)
    if (pts.length < 3) return
    const lib = this.ctx.library
    // Floor: shape (x, -y) on frame (+X, -Z) → normal +Y, world z = plan y.
    const floorShape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * MM, -p.y * MM)))
    const floor = faceFromShape(floorShape, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1))
    this.content.add(tagMesh(floor, lib.get(r.floor ?? DEFAULT_FINISH.floor, DEFAULT_FINISH.floor), { kind: 'floor', id: r.id }, false))
    // Ceiling: shape (x, y) on frame (+X, +Z) → normal -Y.
    const ceilShape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * MM, p.y * MM)))
    const ceil = faceFromShape(ceilShape, new THREE.Vector3(0, plan.wallHeight * MM, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1))
    const ceilMesh = tagMesh(ceil, lib.get(r.ceiling ?? DEFAULT_FINISH.ceiling, DEFAULT_FINISH.ceiling), { kind: 'ceiling', id: r.id }, false)
    this.content.add(ceilMesh)
    this.ceilings.push(ceilMesh)
  }

  private buildItem(it: Item) {
    const lib = this.ctx.library
    const g = new THREE.Group()
    g.position.copy(toWorld({ x: it.x, y: it.y }, it.elevation * MM))
    g.rotation.y = (-it.rotation * Math.PI) / 180
    g.userData.itemId = it.id
    const tagChildren = (root: THREE.Object3D) =>
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.userData.target = { kind: 'item', id: it.id, slot: (o.userData.slot as string) ?? null } satisfies PickTarget
      })

    if (it.source.kind === 'parametric') {
      const spec = PARAMETRIC[it.source.type]
      const body = buildParametric(it.source.type, it, (slot) => {
        const def = spec?.slots[slot]?.default ?? DEFAULT_FINISH.trim
        return lib.get(it.materials[slot] ?? def, def)
      })
      tagChildren(body)
      g.add(body)
    } else {
      const model = this.ctx.models.get(it.source.modelId)
      const w = it.width * MM
      const h = it.height * MM
      const dd = it.depth * MM
      // Placeholder box until (or if) the model loads.
      const ph = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), new THREE.MeshStandardMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.5 }))
      ph.position.y = h / 2
      ph.userData.target = { kind: 'item', id: it.id, slot: null } satisfies PickTarget
      g.add(ph)
      if (model) {
        const p = loadModel(model, this.ctx.loadAsset).then((loaded) => {
          if (!loaded || !g.parent) return
          const size = loaded.box.getSize(new THREE.Vector3())
          const centre = loaded.box.getCenter(new THREE.Vector3())
          const inst = loaded.scene.clone(true)
          inst.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) o.userData.sharedGeometry = true
          })
          const holder = new THREE.Group()
          holder.scale.set(size.x ? w / size.x : 1, size.y ? h / size.y : 1, size.z ? dd / size.z : 1)
          inst.position.set(-centre.x, -loaded.box.min.y, -centre.z)
          holder.add(inst)
          tagChildren(holder)
          g.remove(ph)
          ph.geometry.dispose()
          ;(ph.material as THREE.Material).dispose()
          g.add(holder)
        })
        this.pending.push(p)
      }
    }
    this.content.add(g)
    this.itemGroups.set(it.id, g)
  }

  private buildLights(plan: Plan) {
    const look = LIGHTING_LOOKS[plan.lighting.preset]
    if (!this.sky) this.sky = new GradientEquirectTexture(256)
    this.sky.topColor.set(look.skyTop)
    this.sky.bottomColor.set(look.skyBottom)
    this.sky.exponent = 2
    this.sky.update()
    this.sky.mapping = THREE.EquirectangularReflectionMapping
    this.scene.background = this.sky
    this.scene.environment = this.sky
    this.scene.environmentIntensity = look.envIntensity
    this.scene.backgroundIntensity = 1

    this.sun.color.set(look.sunColor)
    this.sun.intensity = look.sunIntensity
    this.sun.visible = look.sunIntensity > 0

    if (!(plan.lighting.ceilingLights || look.forceLights)) return
    const hex = kelvinToHex(plan.lighting.lightTemp)
    const y = plan.wallHeight * MM - 0.01
    for (const r of plan.rooms) {
      const pts = roomInnerPolygon(r, plan.walls)
      if (pts.length < 3) continue
      // One panel per ~2.4 m grid cell inside the room.
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const nx = Math.max(1, Math.round((maxX - minX) / 2400))
      const ny = Math.max(1, Math.round((maxY - minY) / 2400))
      let placed = 0
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const p = { x: minX + ((i + 0.5) * (maxX - minX)) / nx, y: minY + ((j + 0.5) * (maxY - minY)) / ny }
          if (!pointInPolygon(p, pts)) continue
          this.addCeilingLight(toWorld(p, y), hex)
          placed++
        }
      }
      if (!placed) this.addCeilingLight(toWorld(centroid(pts), y), hex)
    }
  }

  private addCeilingLight(pos: THREE.Vector3, hex: string) {
    const light = new THREE.RectAreaLight(hex, 12, 0.6, 0.6)
    light.position.copy(pos)
    light.lookAt(pos.x, 0, pos.z)
    this.content.add(light)
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), this.ctx.library.emissive(hex))
    panel.position.copy(pos).add(new THREE.Vector3(0, -0.002, 0))
    panel.rotation.x = Math.PI / 2
    panel.castShadow = false
    this.content.add(panel)
    this.ceilings.push(light, panel)
  }

  private placeSun(plan: Plan) {
    const look = LIGHTING_LOOKS[plan.lighting.preset]
    const az = (plan.lighting.sunAzimuth * Math.PI) / 180
    const el = (look.sunElevation * Math.PI) / 180
    const c = this.bounds.getCenter(new THREE.Vector3())
    const r = Math.max(10, this.bounds.getSize(new THREE.Vector3()).length() * 1.5)
    // Azimuth 0 = from plan top (−z), clockwise.
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
    this.sun.position.copy(c).addScaledVector(dir, r)
    this.sun.target.position.copy(c)
    const half = Math.max(5, this.bounds.getSize(new THREE.Vector3()).length() * 0.7)
    const cam = this.sun.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 0.5
    cam.far = r * 2
    cam.updateProjectionMatrix()
  }
}

/** Default bird's-eye camera for a plan. */
export function overviewCamera(bounds: THREE.Box3, aspect: number) {
  const c = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const r = Math.max(4, Math.max(size.x, size.z) * 0.9 / Math.min(1, aspect))
  return { position: new THREE.Vector3(c.x + r * 0.55, Math.max(6, r * 1.1), c.z + r * 0.85), target: new THREE.Vector3(c.x, 0, c.z) }
}
