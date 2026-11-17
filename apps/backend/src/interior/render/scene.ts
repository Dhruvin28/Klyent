import earcut from 'earcut'
import {
  EPS,
  add,
  centroid,
  clampOpeningOffset,
  openingSpan,
  pointInPolygon,
  projectToSegment,
  roomInnerPolygon,
  scale,
  wallDir,
  wallLeftNormal,
  wallLength,
  type Vec2,
} from '../../designer/geometry'
import type { CeilingZone, Fixture, Item, MatRef, Opening, Plan, Wall, WallPanel } from '../../designer/plan'
import type { ViewSpec } from '../build/views'

// Server-side scene compiler for the Blender render worker. It mirrors the geometry that
// the designer builds in three.js (apps/frontend/src/lib/designer/scene.ts) so a render
// shows exactly the reconstructed model, but writes plain triangle meshes + material and
// light descriptions that the Blender script (blender/render_scene.py) turns into a
// physically based scene. Output coordinates are Blender's: X = plan x, Y = -plan y,
// Z = up, all in metres.

const MM = 0.001
type V3 = [number, number, number]

export interface SceneMaterial {
  id: string
  type: 'pbr' | 'glass' | 'emissive'
  color: string
  roughness: number
  metalness: number
  pattern?: 'wood' | 'fabric' | 'plaster'
  /** Library texture: image file + repeats per metre. */
  texture?: { file: string; repeat: [number, number]; rotation: number }
  strength?: number
}

export interface SceneMesh {
  name: string
  material: string
  positions: number[]
  uvs: number[]
  indices: number[]
  /** Bevel width in metres (0 = none); softens the hard CG edges of furniture. */
  bevel: number
  /** Weld vertices before bevelling (needed for the per-face box meshes). */
  weld: boolean
  smooth: boolean
  castShadow: boolean
}

export interface SceneLight {
  kind: 'point' | 'spot' | 'area'
  position: V3
  color: string
  watts: number
  /** Area light edge, or point radius, in metres. */
  size: number
  /** Spot cone angle, radians. */
  cone?: number
  direction?: V3
}

export interface SceneModel {
  file: string
  position: V3
  /** Rotation about Z in radians. */
  rotationZ: number
  /** Target bounding-box size in metres: [width (x), depth (y), height (z)]. */
  size: V3
  name: string
}

export interface SceneExport {
  schema: 'interior-blender-scene/1'
  camera: {
    projection: 'perspective' | 'orthographic'
    position: V3
    target: V3
    up: V3
    /** Vertical field of view in degrees. */
    fov: number
    orthoWidth: number
    orthoHeight: number
  }
  world: {
    preset: string
    sunDirection: V3
    sunColor: string
    sunStrength: number
    skyStrength: number
    skyTop: string
    skyBottom: string
    sunElevation: number
    exposure: number
    night: boolean
  }
  materials: SceneMaterial[]
  meshes: SceneMesh[]
  lights: SceneLight[]
  models: SceneModel[]
  stats: { triangles: number; meshes: number; lights: number; models: number; hidden: string[] }
}

export interface LibraryTexture {
  colorHex: string | null
  file: string | null
  widthMm: number
  heightMm: number
}

export interface ModelFile {
  file: string
  widthMm: number
  depthMm: number
  heightMm: number
}

export interface SceneInputs {
  library: Map<string, LibraryTexture>
  models: Map<string, ModelFile>
}

const c = (hex: string, roughness: number, metalness?: number): MatRef => ({ kind: 'color', hex, roughness, ...(metalness ? { metalness } : {}) })
const DEFAULT_FINISH = {
  wall: c('#f2efe9', 0.9),
  floor: c('#d8cfc2', 0.6),
  ceiling: c('#fbfbfa', 0.95),
  wallTop: c('#3f3f46', 1),
  trim: c('#ebe7e0', 0.9),
  door: c('#a47b54', 0.55),
  frame: c('#5b4636', 0.5),
}

const SLOT_DEFAULTS: Record<string, MatRef> = {
  carcass: c('#efe9df', 0.7),
  shutter: c('#d9cbb6', 0.45),
  handle: c('#8a8a8f', 0.3, 0.9),
  top: c('#2f2f33', 0.25),
  body: c('#b48a60', 0.5),
  frame: c('#8a6a4a', 0.5),
  fabric: c('#b9b2a4', 0.95),
  headboard: c('#8c7a68', 0.9),
  legs: c('#3a2f28', 0.4),
  seat: c('#b9b2a4', 0.9),
}

const LOOKS = {
  morning: { sunElevation: 18, sunColor: '#ffd8a8', sunIntensity: 3, skyTop: '#9fc4f5', skyBottom: '#f6e2c8', envIntensity: 0.9, forceLights: false },
  noon: { sunElevation: 58, sunColor: '#fff4e2', sunIntensity: 4, skyTop: '#86b2f0', skyBottom: '#eef2f7', envIntensity: 1.1, forceLights: false },
  evening: { sunElevation: 7, sunColor: '#ff9d5c', sunIntensity: 2.6, skyTop: '#5f6fa8', skyBottom: '#f3ab78', envIntensity: 0.55, forceLights: false },
  night: { sunElevation: 30, sunColor: '#9fb3ff', sunIntensity: 0, skyTop: '#05070d', skyBottom: '#141a26', envIntensity: 0.04, forceLights: true },
} as const

export function kelvinToHex(k: number): string {
  const t = Math.min(40000, Math.max(1000, k)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

// ── small vector helpers ──
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const vmul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const vdot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const vnorm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Plan point (mm) + height (mm) → Blender world (m). */
const B = (p: Vec2, h = 0): V3 => [p.x * MM, -p.y * MM, h * MM]

class MeshBuilder {
  positions: number[] = []
  uvs: number[] = []
  indices: number[] = []
  private vert(p: V3, uv: [number, number]) {
    this.positions.push(p[0], p[1], p[2])
    this.uvs.push(uv[0], uv[1])
    return this.positions.length / 3 - 1
  }
  /** Planar quad facing `normal`; UVs are metric (metres) along its first edge. */
  quad(p: V3[], normal: V3) {
    const n = vcross(vsub(p[1], p[0]), vsub(p[2], p[0]))
    const q = vdot(n, normal) < 0 ? [p[0], p[3], p[2], p[1]] : p
    const e1 = vnorm(vsub(q[1], q[0]))
    const fn = vnorm(vcross(vsub(q[1], q[0]), vsub(q[2], q[0])))
    const e2 = vcross(fn, e1)
    const ids = q.map((v) => this.vert(v, [vdot(vsub(v, q[0]), e1), vdot(vsub(v, q[0]), e2)]))
    this.indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3])
  }
  /** Horizontal polygon (with optional holes) at height z, facing up or down; UV = world x,y. */
  polygon(outer: Vec2[], holes: Vec2[][], z: number, up: boolean) {
    const flat: number[] = []
    const holeIdx: number[] = []
    const pts: Vec2[] = []
    const push = (ring: Vec2[]) => {
      for (const p of ring) {
        flat.push(p.x, p.y)
        pts.push(p)
      }
    }
    push(outer)
    for (const h of holes) {
      holeIdx.push(pts.length)
      push(h)
    }
    const tris = earcut(flat, holeIdx, 2)
    const base = this.positions.length / 3
    for (const p of pts) this.vert([p.x * MM, -p.y * MM, z], [p.x * MM, -p.y * MM])
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, cc] = [tris[i], tris[i + 1], tris[i + 2]]
      // Orient by the signed area in Blender XY (y flipped from plan).
      const pa = pts[a], pb = pts[b], pc = pts[cc]
      const area = (pb.x - pa.x) * -(pc.y - pa.y) - (pc.x - pa.x) * -(pb.y - pa.y)
      const ccwUp = area > 0
      if (ccwUp === up) this.indices.push(base + a, base + b, base + cc)
      else this.indices.push(base + a, base + cc, base + b)
    }
  }
  box(centre: V3, size: V3, axes: [V3, V3, V3]) {
    const [ax, ay, az] = axes
    const h = [size[0] / 2, size[1] / 2, size[2] / 2]
    const corner = (sx: number, sy: number, sz: number): V3 => vadd(centre, vadd(vmul(ax, sx * h[0]), vadd(vmul(ay, sy * h[1]), vmul(az, sz * h[2]))))
    const faces: { n: V3; v: V3[] }[] = [
      { n: ax, v: [corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1)] },
      { n: vmul(ax, -1), v: [corner(-1, -1, -1), corner(-1, 1, -1), corner(-1, 1, 1), corner(-1, -1, 1)] },
      { n: ay, v: [corner(-1, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(-1, 1, 1)] },
      { n: vmul(ay, -1), v: [corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1)] },
      { n: az, v: [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)] },
      { n: vmul(az, -1), v: [corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1)] },
    ]
    for (const f of faces) this.quad(f.v, f.n)
  }
  /** Closed or open vertical-axis cylinder/cone along +Z; smooth normals come from `smooth`. */
  lathe(centre: V3, rBottom: number, rTop: number, height: number, segs: number, capTop = true, capBottom = true) {
    const ring = (r: number, z: number) => Array.from({ length: segs }, (_, i) => vadd(centre, [Math.cos((i / segs) * Math.PI * 2) * r, Math.sin((i / segs) * Math.PI * 2) * r, z]))
    const lo = ring(rBottom, -height / 2)
    const hi = ring(rTop, height / 2)
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs
      const mid = vsub(vmul(vadd(lo[i], lo[j]), 0.5), centre)
      this.quad([lo[i], lo[j], hi[j], hi[i]], vnorm([mid[0], mid[1], 0]))
    }
    const cap = (pts: V3[], n: V3, r: number) => {
      if (r <= 1e-6) return
      const cz = pts[0][2]
      const c0 = this.vert([centre[0], centre[1], cz], [0, 0])
      const ids = pts.map((p) => this.vert(p, [p[0] - centre[0], p[1] - centre[1]]))
      for (let i = 0; i < segs; i++) {
        const a = ids[i], b = ids[(i + 1) % segs]
        const cross = vcross(vsub(pts[i], [centre[0], centre[1], cz]), vsub(pts[(i + 1) % segs], [centre[0], centre[1], cz]))
        if (cross[2] * n[2] >= 0) this.indices.push(c0, a, b)
        else this.indices.push(c0, b, a)
      }
    }
    if (capTop) cap(hi, [0, 0, 1], rTop)
    if (capBottom) cap(lo, [0, 0, -1], rBottom)
  }
  sphere(centre: V3, r: number) {
    const lat = 10, lon = 16
    const base = this.positions.length / 3
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI
      for (let j = 0; j <= lon; j++) {
        const ph = (j / lon) * Math.PI * 2
        this.vert(vadd(centre, [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]), [j / lon, i / lat])
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = base + i * (lon + 1) + j, b = a + lon + 1
        this.indices.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
  }
  get empty() {
    return this.indices.length === 0
  }
}

interface WallInfo {
  id: string
  meshNames: string[]
  mid: Vec2
  /** Outward normal (plan space) of the exterior side, null for interior partitions. */
  exterior: Vec2 | null
}

export function compileRenderScene(plan: Plan, view: ViewSpec, inputs: SceneInputs): SceneExport {
  const materials = new Map<string, SceneMaterial>()
  const meshes: SceneMesh[] = []
  const lights: SceneLight[] = []
  const models: SceneModel[] = []
  const hidden: string[] = []
  const walls: WallInfo[] = []
  const ceilingMeshes = new Set<string>()
  const furnitureMeshes = new Set<string>()
  const ceilingLights = new Set<SceneLight>()
  const furnitureLights = new Set<SceneLight>()
  const ceilingModels = new Set<SceneModel>()
  const furnitureModels = new Set<SceneModel>()
  const wallsById = new Map(plan.walls.map((w) => [w.id, w]))
  const H = plan.wallHeight
  const look = LOOKS[plan.lighting.preset]
  const lightsOn = plan.lighting.ceilingLights || look.forceLights

  // ── materials ──
  const matId = (ref: MatRef | null | undefined, fallback: MatRef): string => {
    const r = ref ?? fallback
    if (r.kind === 'library') {
      const lib = inputs.library.get(r.materialId)
      if (lib?.file) {
        const id = `lib:${r.materialId}:${r.roughness}:${r.rotation ?? 0}`
        if (!materials.has(id)) {
          materials.set(id, {
            id,
            type: 'pbr',
            color: lib.colorHex ?? '#ffffff',
            roughness: r.roughness,
            metalness: 0,
            texture: { file: lib.file, repeat: [1000 / lib.widthMm, 1000 / lib.heightMm], rotation: ((r.rotation ?? 0) * Math.PI) / 180 },
          })
        }
        return id
      }
      return matId({ kind: 'color', hex: lib?.colorHex ?? '#cccccc', roughness: r.roughness }, fallback.kind === 'library' ? DEFAULT_FINISH.wall : fallback)
    }
    const id = `c:${r.hex}:${r.roughness}:${r.metalness ?? 0}:${r.pattern ?? ''}`
    if (!materials.has(id)) materials.set(id, { id, type: 'pbr', color: r.hex, roughness: r.roughness, metalness: r.metalness ?? 0, ...(r.pattern ? { pattern: r.pattern } : {}) })
    return id
  }
  const glassId = () => {
    if (!materials.has('glass')) materials.set('glass', { id: 'glass', type: 'glass', color: '#e8f2f6', roughness: 0.02, metalness: 0 })
    return 'glass'
  }
  const emitId = (hex: string, strength: number) => {
    const id = `emit:${hex}:${strength}`
    if (!materials.has(id)) materials.set(id, { id, type: 'emissive', color: hex, roughness: 0.5, metalness: 0, strength })
    return id
  }

  let meshCount = 0
  const finish = (name: string, mat: string, mb: MeshBuilder, opts: Partial<Pick<SceneMesh, 'bevel' | 'weld' | 'smooth' | 'castShadow'>> = {}): string | null => {
    if (mb.empty) return null
    const unique = `${name}#${meshCount++}`
    meshes.push({ name: unique, material: mat, positions: mb.positions, uvs: mb.uvs, indices: mb.indices, bevel: opts.bevel ?? 0, weld: opts.weld ?? false, smooth: opts.smooth ?? false, castShadow: opts.castShadow ?? true })
    return unique
  }

  // ── walls ──
  const wallExt = (w: Wall) => {
    const touches = (p: Vec2) => plan.walls.some((o) => o.id !== w.id && projectToSegment(p, o.a, o.b).distance <= EPS)
    const ext = (p: Vec2) => {
      if (!touches(p)) return 0
      let t = 0
      for (const o of plan.walls) if (o.id !== w.id && projectToSegment(p, o.a, o.b).distance <= EPS) t = Math.max(t, o.thickness)
      return t / 2
    }
    return { a: ext(w.a), b: ext(w.b) }
  }

  const buildWall = (w: Wall, openings: Opening[]) => {
    const Lmm = wallLength(w)
    if (Lmm < 10) return
    const Hm = (w.height ?? H) * MM
    const T = w.thickness * MM
    const ext = wallExt(w)
    const u0 = -ext.a * MM
    const u1 = Lmm * MM + ext.b * MM
    const d2 = wallDir(w)
    const n2 = wallLeftNormal(w)
    const d: V3 = [d2.x, -d2.y, 0]
    const nL: V3 = [n2.x, -n2.y, 0]
    const up: V3 = [0, 0, 1]
    const A = B(w.a)
    const P = (u: number, v: number, s: number): V3 => vadd(A, vadd(vmul(d, u), vadd(vmul(up, v), vmul(nL, s))))
    const holes = openings
      .map((o) => {
        const width = Math.min(o.width, Lmm - 20)
        const off = clampOpeningOffset(o.offset, width, Lmm)
        const s = openingSpan({ offset: off, width })
        return { s: s.start * MM, e: s.end * MM, y0: Math.max(0.001, o.sill * MM), y1: Math.min(Hm - 0.02, (o.sill + o.height) * MM) }
      })
      .filter((h) => h.e - h.s > 0.05 && h.y1 - h.y0 > 0.05)

    // Face rectangles around the holes: slice along the wall at every hole edge, then emit
    // the free vertical spans of each slab (handles overlapping openings).
    const cuts = [u0, u1, ...holes.flatMap((h) => [h.s, h.e])].filter((u) => u >= u0 && u <= u1).sort((a, b) => a - b)
    const rects: { ua: number; ub: number; va: number; vb: number }[] = []
    for (let i = 0; i < cuts.length - 1; i++) {
      const ua = cuts[i], ub = cuts[i + 1]
      if (ub - ua < 1e-4) continue
      const mid = (ua + ub) / 2
      const spans = holes.filter((h) => h.s < mid && h.e > mid).map((h) => [h.y0, h.y1] as [number, number]).sort((a, b) => a[0] - b[0])
      let cur = 0
      for (const [a, b] of spans) {
        if (a > cur + 1e-4) rects.push({ ua, ub, va: cur, vb: a })
        cur = Math.max(cur, b)
      }
      if (cur < Hm - 1e-4) rects.push({ ua, ub, va: cur, vb: Hm })
    }
    const names: string[] = []
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const mb = new MeshBuilder()
      const nrm = vmul(nL, sign)
      for (const r of rects) mb.quad([P(r.ua, r.va, (sign * T) / 2), P(r.ub, r.va, (sign * T) / 2), P(r.ub, r.vb, (sign * T) / 2), P(r.ua, r.vb, (sign * T) / 2)], nrm)
      const n = finish(`wall_${w.id}_${side}`, matId(side === 'left' ? w.left : w.right, DEFAULT_FINISH.wall), mb)
      if (n) names.push(n)
    }
    const edges = new MeshBuilder()
    const top = new MeshBuilder()
    const t2 = T / 2
    top.quad([P(u0, Hm, t2), P(u1, Hm, t2), P(u1, Hm, -t2), P(u0, Hm, -t2)], up)
    edges.quad([P(u0, 0, t2), P(u0, Hm, t2), P(u0, Hm, -t2), P(u0, 0, -t2)], vmul(d, -1))
    edges.quad([P(u1, 0, t2), P(u1, Hm, t2), P(u1, Hm, -t2), P(u1, 0, -t2)], d)
    for (const h of holes) {
      edges.quad([P(h.s, h.y0, t2), P(h.s, h.y1, t2), P(h.s, h.y1, -t2), P(h.s, h.y0, -t2)], d)
      edges.quad([P(h.e, h.y0, t2), P(h.e, h.y1, t2), P(h.e, h.y1, -t2), P(h.e, h.y0, -t2)], vmul(d, -1))
      edges.quad([P(h.s, h.y1, t2), P(h.e, h.y1, t2), P(h.e, h.y1, -t2), P(h.s, h.y1, -t2)], vmul(up, -1))
      if (h.y0 > 0.002) edges.quad([P(h.s, h.y0, t2), P(h.e, h.y0, t2), P(h.e, h.y0, -t2), P(h.s, h.y0, -t2)], up)
    }
    const en = finish(`wall_${w.id}_edges`, matId(null, DEFAULT_FINISH.trim), edges)
    if (en) names.push(en)
    const tn = finish(`wall_${w.id}_top`, matId(null, DEFAULT_FINISH.wallTop), top, { castShadow: false })
    if (tn) names.push(tn)

    const mid2 = scale(add(w.a, w.b), 0.5)
    const probe = (s: number) => add(mid2, scale(n2, s * (w.thickness / 2 + 60)))
    const inRoom = (p: Vec2) => plan.rooms.some((r) => pointInPolygon(p, r.points))
    const leftIn = inRoom(probe(1))
    const rightIn = inRoom(probe(-1))
    const exterior = leftIn && !rightIn ? { x: -n2.x, y: -n2.y } : rightIn && !leftIn ? { x: n2.x, y: n2.y } : null
    walls.push({ id: w.id, meshNames: names, mid: mid2, exterior })
  }

  for (const w of plan.walls) buildWall(w, plan.openings.filter((o) => o.wallId === w.id))

  // ── door leaves and window frames ──
  const wallBasis = (w: Wall) => {
    const d2 = wallDir(w)
    const d: V3 = [d2.x, -d2.y, 0]
    // Wall-local axes in Blender space: x along the wall, y towards the wall's left, z up.
    const n2 = wallLeftNormal(w)
    return { d2, axes: [d, [n2.x, -n2.y, 0] as V3, [0, 0, 1] as V3] as [V3, V3, V3] }
  }
  const frameMat = matId(null, DEFAULT_FINISH.frame)
  const doorMat = matId(null, DEFAULT_FINISH.door)
  const trimMat = matId(null, DEFAULT_FINISH.trim)
  const steel = matId(c('#9a9a9f', 0.3, 0.9), DEFAULT_FINISH.frame)
  for (const o of plan.openings) {
    const w = wallsById.get(o.wallId)
    if (!w || o.type === 'opening') continue
    const Lmm = wallLength(w)
    const width = Math.min(o.width, Lmm - 20)
    const off = clampOpeningOffset(o.offset, width, Lmm)
    const Hm = (w.height ?? H) * MM
    const ow = width * MM
    const oh = Math.min(Hm - 0.02, (o.sill + o.height) * MM) - o.sill * MM
    const T = w.thickness * MM
    const { d2, axes } = wallBasis(w)
    const centre = B(add(w.a, scale(d2, off)), o.sill)
    const place = (lx: number, lz: number, ly: number): V3 => vadd(centre, vadd(vmul(axes[0], lx), vadd(vmul(axes[1], -ly), vmul(axes[2], lz))))
    // ly follows the frontend's local z (towards the wall's right), hence the sign flip above.
    const boxAt = (name: string, mat: string, bw: number, bh: number, bd: number, x: number, y: number, z: number, opts: Partial<Pick<SceneMesh, 'bevel' | 'castShadow'>> = {}) => {
      const mb = new MeshBuilder()
      mb.box(place(x, y, z), [bw, bd, bh], axes)
      finish(name, mat, mb, { weld: true, bevel: opts.bevel ?? 0.003, castShadow: opts.castShadow ?? true })
    }
    const f = 0.045
    if (o.type === 'door') {
      boxAt(`door_${o.id}_fl`, frameMat, f, oh, T + 0.01, -ow / 2 + f / 2, oh / 2, 0)
      boxAt(`door_${o.id}_fr`, frameMat, f, oh, T + 0.01, ow / 2 - f / 2, oh / 2, 0)
      boxAt(`door_${o.id}_ft`, frameMat, ow, f, T + 0.01, 0, oh - f / 2, 0)
      const zl = o.flip ? T / 2 - 0.03 : -T / 2 + 0.03
      boxAt(`door_${o.id}_leaf`, doorMat, ow - 2 * f, oh - f - 0.005, 0.04, 0, (oh - f) / 2, zl, { bevel: 0.004 })
      const hx = (o.flip ? -1 : 1) * (ow / 2 - f - 0.07)
      for (const s of [-1, 1]) boxAt(`door_${o.id}_h${s}`, steel, 0.12, 0.018, 0.018, hx, 1.0, zl + s * 0.035, { bevel: 0.004 })
    } else {
      boxAt(`win_${o.id}_fl`, frameMat, f, oh, 0.07, -ow / 2 + f / 2, oh / 2, 0)
      boxAt(`win_${o.id}_fr`, frameMat, f, oh, 0.07, ow / 2 - f / 2, oh / 2, 0)
      boxAt(`win_${o.id}_fb`, frameMat, ow, f, 0.07, 0, f / 2, 0)
      boxAt(`win_${o.id}_ft`, frameMat, ow, f, 0.07, 0, oh - f / 2, 0)
      if (ow > 0.9) boxAt(`win_${o.id}_mullion`, frameMat, 0.035, oh - 2 * f, 0.06, 0, oh / 2, 0)
      boxAt(`win_${o.id}_glass`, glassId(), ow - 2 * f, oh - 2 * f, 0.006, 0, oh / 2, 0, { bevel: 0, castShadow: false })
      boxAt(`win_${o.id}_sill`, trimMat, ow + 0.06, 0.02, T + 0.04, 0, -0.01, 0)
    }
  }

  // ── floors and ceilings ──
  for (const r of plan.rooms) {
    const pts = roomInnerPolygon(r, plan.walls)
    if (pts.length < 3) continue
    const fl = new MeshBuilder()
    fl.polygon(pts, [], 0, true)
    finish(`floor_${r.id}`, matId(r.floor, DEFAULT_FINISH.floor), fl, { castShadow: false })
    const ce = new MeshBuilder()
    ce.polygon(pts, [], H * MM, false)
    const n = finish(`ceiling_${r.id}`, matId(r.ceiling, DEFAULT_FINISH.ceiling), ce, { castShadow: false })
    if (n) ceilingMeshes.add(n)
  }

  const ceilingAt = (p: Vec2) => {
    for (const z of plan.ceilings ?? []) if (pointInPolygon(p, z.outer) && !(z.inner && pointInPolygon(p, z.inner))) return z.level
    return H
  }

  // ── dropped ceilings / POP ──
  const buildZone = (z: CeilingZone) => {
    if (z.outer.length < 3) return
    const y = z.level * MM
    const top = H * MM
    const mat = matId(z.material, DEFAULT_FINISH.ceiling)
    const under = new MeshBuilder()
    under.polygon(z.outer, z.inner && z.inner.length >= 3 ? [z.inner] : [], y, false)
    const reg = (n: string | null) => n && ceilingMeshes.add(n)
    reg(finish(`zone_${z.id}_under`, mat, under, { castShadow: false }))
    if (top - y > 0.005) {
      const fascia = new MeshBuilder()
      const loopFaces = (loop: Vec2[], solidInside: boolean) => {
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i], b = loop[(i + 1) % loop.length]
          const L = Math.hypot(b.x - a.x, b.y - a.y)
          if (L < 1) continue
          let n = { x: (b.y - a.y) / L, y: -(b.x - a.x) / L }
          const probe = { x: (a.x + b.x) / 2 + n.x * 10, y: (a.y + b.y) / 2 + n.y * 10 }
          if (pointInPolygon(probe, loop) === solidInside) n = { x: -n.x, y: -n.y }
          fascia.quad([B(a, y / MM), B(b, y / MM), B(b, (top - 0.001) / MM), B(a, (top - 0.001) / MM)], [n.x, -n.y, 0])
        }
      }
      if (z.inner && z.inner.length >= 3) loopFaces(z.inner, false)
      else loopFaces(z.outer, true)
      reg(finish(`zone_${z.id}_fascia`, mat, fascia, { castShadow: false }))
    }
    if (z.cove && z.inner && z.inner.length >= 3) {
      const strip = new MeshBuilder()
      const wmm = Math.min(80, z.cove.width)
      const loop = z.inner
      const yy = y / MM + 40
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length]
        const L = Math.hypot(b.x - a.x, b.y - a.y)
        if (L < 1) continue
        let n = { x: (b.y - a.y) / L, y: -(b.x - a.x) / L }
        if (pointInPolygon({ x: (a.x + b.x) / 2 + n.x * 10, y: (a.y + b.y) / 2 + n.y * 10 }, loop)) n = { x: -n.x, y: -n.y }
        const off = { x: n.x * wmm, y: n.y * wmm }
        strip.quad([B(a, yy), B(b, yy), B({ x: b.x + off.x, y: b.y + off.y }, yy), B({ x: a.x + off.x, y: a.y + off.y }, yy)], [0, 0, 1])
        if (lightsOn && i % 2 === 0) {
          const m = scale(add(a, b), 0.5)
          const l: SceneLight = { kind: 'point', position: B({ x: m.x + off.x / 2, y: m.y + off.y / 2 }, yy + 40), color: kelvinToHex(z.cove.kelvin), watts: Math.min(30, 6 + L * 0.01), size: 0.03 }
          lights.push(l)
          ceilingLights.add(l)
        }
      }
      reg(finish(`zone_${z.id}_cove`, lightsOn ? emitId(kelvinToHex(z.cove.kelvin), 6) : mat, strip, { castShadow: false }))
    }
  }
  for (const z of plan.ceilings ?? []) buildZone(z)

  // ── wall paneling ──
  const buildPanel = (p: WallPanel, w: Wall) => {
    if (wallLength(w) < 1 || p.length < 1) return
    const { d2, axes } = wallBasis(w)
    const n2 = wallLeftNormal(w)
    const sign = p.side === 'left' ? 1 : -1
    const n = Math.max(1, Math.round(p.divisions))
    const groove = n > 1 ? Math.min(p.groove, p.length / n / 2) : 0
    const boardW = (p.length - groove * (n - 1)) / n
    const mat = matId(p.material ?? c('#8b6a4f', 0.55), DEFAULT_FINISH.trim)
    const mb = new MeshBuilder()
    for (let i = 0; i < n; i++) {
      const u = p.start + i * (boardW + groove) + boardW / 2
      const offs = sign * (w.thickness / 2 + p.depth / 2)
      const ctr = B({ x: w.a.x + d2.x * u + n2.x * offs, y: w.a.y + d2.y * u + n2.y * offs }, p.bottom + p.height / 2)
      mb.box(ctr, [boardW * MM, p.depth * MM, p.height * MM], axes)
    }
    finish(`panel_${p.id}`, mat, mb, { weld: true, bevel: 0.002 })
  }
  for (const p of plan.panels ?? []) {
    const w = wallsById.get(p.wallId)
    if (w) buildPanel(p, w)
  }

  // ── furniture ──
  const buildItem = (it: Item) => {
    const theta = (-it.rotation * Math.PI) / 180
    const cos = Math.cos(theta), sin = Math.sin(theta)
    // Item-local (x right, y up, z front, metres) → Blender world.
    const T = (lx: number, ly: number, lz: number): V3 => {
      const x = lx * cos + lz * sin
      const z = -lx * sin + lz * cos
      return [it.x * MM + x, -(it.y * MM + z), it.elevation * MM + ly]
    }
    // Local axes in Blender space after the same rotation.
    const ax: V3 = [cos, -(-sin), 0]
    const ay: V3 = [0, 0, 1]
    const az: V3 = [sin, -cos, 0]
    const W = it.width * MM, D = it.depth * MM, Hh = it.height * MM
    if (it.source.kind === 'model') {
      const model = inputs.models.get(it.source.modelId)
      if (model) {
        const m: SceneModel = { file: model.file, position: T(0, 0, 0), rotationZ: theta, size: [W, D, Hh], name: it.name }
        models.push(m)
        furnitureModels.add(m)
        return
      }
      const mb = new MeshBuilder()
      mb.box(T(0, Hh / 2, 0), [W, D, Hh], [ax, az, ay])
      const n = finish(`item_${it.id}`, matId(c('#b8c2cc', 0.7), DEFAULT_FINISH.trim), mb, { weld: true, bevel: 0.005 })
      if (n) furnitureMeshes.add(n)
      return
    }
    const slot = (name: string) => matId(it.materials[name], SLOT_DEFAULTS[name] ?? DEFAULT_FINISH.trim)
    const groups = new Map<string, { mb: MeshBuilder; bevel: number }>()
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, slotName: string, bevel = 0.002) => {
      if (w <= 0 || h <= 0 || d <= 0) return
      const key = `${slotName}:${bevel}`
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { mb: new MeshBuilder(), bevel }))
      g.mb.box(T(x, y, z), [w, d, h], [ax, az, ay])
    }
    parametricBoxes(it, W, D, Hh, box)
    for (const [key, g] of groups) {
      const [slotName] = key.split(':')
      const soft = slotName === 'fabric' || slotName === 'seat' || slotName === 'headboard'
      const n = finish(`item_${it.id}_${slotName}`, slot(slotName), g.mb, { weld: true, bevel: soft ? Math.max(g.bevel, 0.025) : g.bevel, smooth: true })
      if (n) furnitureMeshes.add(n)
    }
  }
  for (const it of plan.items) buildItem(it)

  // ── fixtures ──
  const fixtures = plan.fixtures ?? []
  let realLights = 0
  const buildFixture = (f: Fixture) => {
    const hex = kelvinToHex(f.kelvin)
    const ceil = ceilingAt(f) * MM
    const on = lightsOn && f.on
    const emit = on ? emitId(hex, 9) : matId(c('#f4f1ea', 0.4), DEFAULT_FINISH.trim)
    const metal = matId(c('#2b2b2e', 0.4, 0.8), DEFAULT_FINISH.frame)
    const r = (f.size * MM) / 2
    const at = (z: number): V3 => [f.x * MM, -f.y * MM, z]
    const put = (name: string, mat: string, mb: MeshBuilder, flush: boolean) => {
      const n = finish(name, mat, mb, { castShadow: false, smooth: true })
      if (n) (flush ? ceilingMeshes : furnitureMeshes).add(n)
    }
    let lightZ = ceil - 0.05
    let flush = true
    switch (f.kind) {
      case 'downlight':
      case 'spot': {
        const mb = new MeshBuilder()
        mb.lathe(at(ceil - 0.006), r, r, 0.012, 24)
        put(`fx_${f.id}`, emit, mb, true)
        break
      }
      case 'pendant': {
        flush = false
        const drop = f.mount !== null ? f.mount * MM : ceil - 0.7
        const rod = new MeshBuilder()
        rod.lathe(at((ceil + drop) / 2), 0.004, 0.004, Math.max(0.01, ceil - drop), 6)
        put(`fx_${f.id}_rod`, metal, rod, false)
        const shade = new MeshBuilder()
        shade.lathe(at(drop + r * 0.45), r, r * 0.12, r * 0.9, 24, false, false)
        put(`fx_${f.id}_shade`, metal, shade, false)
        const bulb = new MeshBuilder()
        bulb.sphere(at(drop + r * 0.2), r * 0.35)
        put(`fx_${f.id}_bulb`, emit, bulb, false)
        lightZ = drop
        break
      }
      case 'chandelier': {
        flush = false
        const drop = f.mount !== null ? f.mount * MM : ceil - 0.6
        const rod = new MeshBuilder()
        rod.lathe(at((ceil + drop) / 2), 0.004, 0.004, Math.max(0.01, ceil - drop), 6)
        put(`fx_${f.id}_rod`, metal, rod, false)
        const orb = new MeshBuilder()
        orb.sphere(at(drop), r * 0.6)
        put(`fx_${f.id}_orb`, emit, orb, false)
        lightZ = drop
        break
      }
      case 'wall_light': {
        flush = false
        const z = (f.mount ?? 1800) * MM
        const mb = new MeshBuilder()
        mb.box(at(z), [0.12, 0.08, 0.2], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        put(`fx_${f.id}`, emit, mb, false)
        lightZ = z
        break
      }
      case 'strip': {
        const mb = new MeshBuilder()
        mb.box(at(ceil - 0.006), [f.size * MM, 0.03, 0.012], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        put(`fx_${f.id}`, emit, mb, true)
        break
      }
      case 'fan': {
        const body = new MeshBuilder()
        body.lathe(at(ceil - 0.25), 0.09, 0.09, 0.12, 20)
        put(`fx_${f.id}_body`, metal, body, true)
        const wood = matId(c('#6b4a33', 0.6), DEFAULT_FINISH.trim)
        const blades = new MeshBuilder()
        for (let k = 0; k < 3; k++) {
          const ang = (k * Math.PI * 2) / 3
          const ca = Math.cos(ang), sa = Math.sin(ang)
          blades.box(at(ceil - 0.3), [r * 0.9, 0.11, 0.008], [[ca, sa, 0], [-sa, ca, 0], [0, 0, 1]])
        }
        put(`fx_${f.id}_blades`, wood, blades, true)
        break
      }
    }
    if (on && f.kind !== 'fan' && realLights < 60) {
      realLights++
      const l: SceneLight =
        f.kind === 'spot'
          ? { kind: 'spot', position: at(lightZ), color: hex, watts: 60, size: 0.04, cone: Math.PI / 3.2, direction: [0, 0, -1] }
          : f.kind === 'downlight'
            ? { kind: 'spot', position: at(lightZ), color: hex, watts: 45, size: 0.04, cone: Math.PI * 0.62, direction: [0, 0, -1] }
            : { kind: 'point', position: at(lightZ), color: hex, watts: f.kind === 'strip' ? 25 : f.kind === 'chandelier' ? 140 : f.kind === 'pendant' ? 70 : 25, size: f.kind === 'chandelier' ? 0.12 : 0.05 }
      lights.push(l)
      ;(flush ? ceilingLights : furnitureLights).add(l)
    }
  }
  for (const f of fixtures) buildFixture(f)

  // Automatic ceiling panels where the drawings give no fixtures (same grid as the designer).
  if (lightsOn) {
    const hex = kelvinToHex(plan.lighting.lightTemp)
    for (const r of plan.rooms) {
      const pts = roomInnerPolygon(r, plan.walls)
      if (pts.length < 3) continue
      if (fixtures.some((f) => pointInPolygon(f, pts))) continue
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
      const nx = Math.max(1, Math.round((maxX - minX) / 2400))
      const ny = Math.max(1, Math.round((maxY - minY) / 2400))
      const spots: Vec2[] = []
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const p = { x: minX + ((i + 0.5) * (maxX - minX)) / nx, y: minY + ((j + 0.5) * (maxY - minY)) / ny }
        if (pointInPolygon(p, pts)) spots.push(p)
      }
      if (!spots.length) spots.push(centroid(pts))
      for (const p of spots) {
        const z = H * MM - 0.01
        const mb = new MeshBuilder()
        mb.box([p.x * MM, -p.y * MM, z], [0.6, 0.6, 0.004], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        const n = finish(`panel_light_${r.id}`, emitId(hex, 8), mb, { castShadow: false })
        if (n) ceilingMeshes.add(n)
        const l: SceneLight = { kind: 'area', position: [p.x * MM, -p.y * MM, z - 0.01], color: hex, watts: 90, size: 0.6, direction: [0, 0, -1] }
        lights.push(l)
        ceilingLights.add(l)
      }
    }
  }

  // ── view-dependent visibility (same rules as the designer's camera cutaway) ──
  const cam = view.position
  const camPlan = { x: cam[0] * MM, y: cam[1] * MM }
  const camZ = cam[2] * MM
  const hide = new Set<string>()
  for (const w of walls) {
    if (!w.exterior) continue
    const toCam = { x: camPlan.x - w.mid.x * MM, y: camPlan.y - w.mid.y * MM }
    if (toCam.x * w.exterior.x + toCam.y * w.exterior.y > 0.05) {
      w.meshNames.forEach((n) => hide.add(n))
      hidden.push(`wall ${w.id} (exterior, camera outside)`)
    }
  }
  const inside = camZ < H * MM - 0.05
  const mode = view.visibility.ceilings === 'show' ? true : view.visibility.ceilings === 'hide' ? false : inside
  let dropLights = new Set<SceneLight>()
  const dropModels = new Set<SceneModel>()
  if (!mode) {
    ceilingMeshes.forEach((n) => hide.add(n))
    dropLights = new Set(ceilingLights)
    ceilingModels.forEach((m) => dropModels.add(m))
    hidden.push('ceilings')
  }
  if (!view.visibility.items) {
    furnitureMeshes.forEach((n) => hide.add(n))
    furnitureLights.forEach((l) => dropLights.add(l))
    furnitureModels.forEach((m) => dropModels.add(m))
    hidden.push('furniture')
  }

  const keptMeshes = meshes.filter((m) => !hide.has(m.name))
  const keptLights = lights.filter((l) => !dropLights.has(l))
  const keptModels = models.filter((m) => !dropModels.has(m))

  const az = (plan.lighting.sunAzimuth * Math.PI) / 180
  const el = (look.sunElevation * Math.PI) / 180
  const B3 = (p: V3): V3 => p
  return {
    schema: 'interior-blender-scene/1',
    camera: {
      projection: view.projection,
      position: B3([view.position[0] * MM, -view.position[1] * MM, view.position[2] * MM]),
      target: B3([view.target[0] * MM, -view.target[1] * MM, view.target[2] * MM]),
      up: B3([view.up[0], -view.up[1], view.up[2]]),
      fov: view.fov,
      orthoWidth: (view.ortho?.width ?? 0) * MM,
      orthoHeight: (view.ortho?.height ?? 0) * MM,
    },
    world: {
      preset: plan.lighting.preset,
      // Direction the sun is *at* (from the origin); azimuth 0 = plan top, clockwise.
      sunDirection: [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)],
      sunColor: look.sunColor,
      sunStrength: look.sunIntensity,
      skyStrength: look.envIntensity,
      skyTop: look.skyTop,
      skyBottom: look.skyBottom,
      sunElevation: look.sunElevation,
      exposure: plan.lighting.exposure,
      night: plan.lighting.preset === 'night',
    },
    materials: [...materials.values()],
    meshes: keptMeshes,
    lights: keptLights,
    models: keptModels,
    stats: { triangles: keptMeshes.reduce((s, m) => s + m.indices.length / 3, 0), meshes: keptMeshes.length, lights: keptLights.length, models: keptModels.length, hidden },
  }
}

/** Ports of the designer's parametric furniture (apps/frontend/src/lib/designer/parametric.ts). */
type BoxFn = (w: number, h: number, d: number, x: number, y: number, z: number, slot: string, bevel?: number) => void
function parametricBoxes(item: Item, W: number, D: number, H: number, box: BoxFn) {
  if (item.source.kind !== 'parametric') return
  const type = item.source.type
  const p = item.params
  const num = (k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d)
  const handleStyle = typeof p.handle === 'string' ? p.handle : 'bar'
  const BOARD = 0.018
  const GAP = 0.003
  const shutter = (x0: number, x1: number, y0: number, y1: number, zFront: number, handleAt: 'left' | 'right' | 'top' | 'bottom' | 'center') => {
    const w = x1 - x0 - GAP
    const h = y1 - y0 - GAP
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    box(w, h, BOARD, cx, cy, zFront - BOARD / 2, 'shutter', 0.003)
    const z = zFront + 0.01
    if (handleStyle === 'profile') {
      box(w, 0.012, 0.006, cx, y1 - GAP - 0.006, zFront + 0.003, 'handle', 0.001)
      return
    }
    const inset = 0.05
    const hx = handleAt === 'left' ? x0 + inset : handleAt === 'right' ? x1 - inset : cx
    const hy = handleAt === 'top' ? y1 - inset : handleAt === 'bottom' ? y0 + inset : Math.min(cy, y0 + 1.05)
    if (handleStyle === 'knob') box(0.025, 0.025, 0.025, hx, hy, z, 'handle', 0.008)
    else if (handleAt === 'top' || handleAt === 'bottom') box(Math.min(0.3, w * 0.6), 0.012, 0.02, hx, hy, z, 'handle', 0.004)
    else box(0.012, Math.min(0.3, h * 0.5), 0.02, hx, hy, z, 'handle', 0.004)
  }
  const shutterRow = (x0: number, x1: number, y0: number, y1: number, n: number, zFront: number, vertical: 'top' | 'bottom' | null) => {
    const cw = (x1 - x0) / n
    for (let i = 0; i < n; i++) shutter(x0 + i * cw, x0 + (i + 1) * cw, y0, y1, zFront, vertical ?? (n === 1 ? 'right' : i % 2 === 0 ? 'right' : 'left'))
  }
  const drawerStack = (x0: number, x1: number, y0: number, y1: number, n: number, zFront: number) => {
    const ch = (y1 - y0) / n
    for (let i = 0; i < n; i++) shutter(x0, x1, y0 + i * ch, y0 + (i + 1) * ch, zFront, 'top')
  }
  const front = D / 2
  switch (type) {
    case 'wardrobe': {
      const loft = !!p.loft
      const doors = Math.max(1, Math.round(num('doors', 3)))
      box(W, H, D - BOARD, 0, H / 2, -BOARD / 2, 'carcass')
      const split = loft ? H - Math.min(0.6, H * 0.25) : H
      shutterRow(-W / 2, W / 2, 0, split, doors, front, null)
      if (loft) shutterRow(-W / 2, W / 2, split, H, doors, front, 'bottom')
      break
    }
    case 'base_cabinet': {
      const plinth = 0.1, top = 0.02
      const doors = Math.max(0, Math.round(num('doors', 2)))
      const drawers = Math.max(0, Math.round(num('drawers', 0)))
      box(W, plinth, D - 0.06, 0, plinth / 2, -0.03, 'carcass')
      box(W, H - plinth - top, D - BOARD, 0, plinth + (H - plinth - top) / 2, -BOARD / 2, 'carcass')
      box(W + 0.01, top, D + 0.02, 0, H - top / 2, 0.01, 'top', 0.003)
      const cols = doors + (drawers > 0 ? 1 : 0)
      if (cols > 0) {
        const cw = W / cols
        let x = -W / 2
        if (drawers > 0) {
          drawerStack(x, x + cw, plinth, H - top, drawers, front)
          x += cw
        }
        if (doors > 0) shutterRow(x, W / 2, plinth, H - top, doors, front, handleStyle === 'profile' ? null : 'top')
      }
      break
    }
    case 'wall_cabinet': {
      const doors = Math.max(1, Math.round(num('doors', 2)))
      box(W, H, D - BOARD, 0, H / 2, -BOARD / 2, 'carcass')
      shutterRow(-W / 2, W / 2, 0, H, doors, front, handleStyle === 'profile' ? null : 'bottom')
      break
    }
    case 'tall_unit': {
      const doors = Math.max(1, Math.round(num('doors', 2)))
      box(W, H, D - BOARD, 0, H / 2, -BOARD / 2, 'carcass')
      const ch = H / doors
      for (let i = 0; i < doors; i++) shutter(-W / 2, W / 2, i * ch, (i + 1) * ch, front, 'right')
      break
    }
    case 'shelf': {
      const shelves = Math.max(1, Math.round(num('shelves', 4)))
      const t = 0.025
      box(t, H, D, -W / 2 + t / 2, H / 2, 0, 'carcass')
      box(t, H, D, W / 2 - t / 2, H / 2, 0, 'carcass')
      box(W - 2 * t, H, 0.009, 0, H / 2, -D / 2 + 0.0045, 'carcass', 0.001)
      for (let i = 0; i <= shelves; i++) box(W - 2 * t, t, D - 0.01, 0, Math.min(H - t / 2, t / 2 + (i * (H - t)) / shelves), 0.005, 'carcass')
      break
    }
    case 'tv_unit': {
      const drawers = Math.max(0, Math.round(num('drawers', 2)))
      box(W, H, D - BOARD, 0, H / 2, -BOARD / 2, 'carcass')
      if (drawers > 0) {
        const cw = W / drawers
        for (let i = 0; i < drawers; i++) shutter(-W / 2 + i * cw, -W / 2 + (i + 1) * cw, 0.04, H, front, 'top')
      }
      break
    }
    case 'bed': {
      const baseH = Math.min(0.38, H * 0.35)
      const head = 0.08
      box(W, baseH, D - head, 0, baseH / 2, head / 2, 'frame', 0.006)
      box(W - 0.04, 0.22, D - head - 0.06, 0, baseH + 0.11, head / 2, 'fabric')
      box(W + 0.06, H, head, 0, H / 2, -D / 2 + head / 2, 'headboard')
      const pillowW = Math.min(0.7, (W - 0.15) / 2)
      for (const s of W > 1.2 ? [-1, 1] : [0]) box(pillowW, 0.12, 0.42, s * (pillowW / 2 + 0.04), baseH + 0.28, -D / 2 + head + 0.3, 'fabric')
      box(W - 0.02, 0.03, 0.55, 0, baseH + 0.235, D / 2 - 0.35, 'headboard')
      break
    }
    case 'sofa': {
      const seats = Math.max(1, Math.round(num('seats', 3)))
      const legH = 0.08
      const arm = Math.min(0.2, W * 0.12)
      const backD = Math.min(0.22, D * 0.25)
      const seatH = 0.44
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.04, legH, 0.04, sx * (W / 2 - 0.06), legH / 2, sz * (D / 2 - 0.06), 'legs', 0.004)
      box(W, seatH - legH - 0.12, D, 0, legH + (seatH - legH - 0.12) / 2, 0, 'fabric')
      box(W - 2 * arm, H - legH, backD, 0, legH + (H - legH) / 2, -D / 2 + backD / 2, 'fabric')
      for (const s of [-1, 1]) box(arm, 0.62 - legH, D, s * (W / 2 - arm / 2), legH + (0.62 - legH) / 2, 0, 'fabric')
      const cw = (W - 2 * arm) / seats
      for (let i = 0; i < seats; i++) box(cw - 0.01, 0.12, D - backD - 0.02, -W / 2 + arm + cw * (i + 0.5), seatH - 0.06, backD / 2, 'fabric')
      break
    }
    case 'table': {
      const top = 0.04
      box(W, top, D, 0, H - top / 2, 0, 'top', 0.004)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, H - top, 0.05, sx * (W / 2 - 0.08), (H - top) / 2, sz * (D / 2 - 0.08), 'legs', 0.004)
      break
    }
    case 'chair': {
      const seatY = Math.min(0.46, H * 0.52)
      box(W, 0.04, D, 0, seatY, 0, 'seat')
      box(W, H - seatY - 0.02, 0.03, 0, seatY + (H - seatY) / 2, -D / 2 + 0.015, 'seat')
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.035, seatY - 0.02, 0.035, sx * (W / 2 - 0.03), (seatY - 0.02) / 2, sz * (D / 2 - 0.03), 'legs', 0.003)
      break
    }
    default:
      box(W, H, D, 0, H / 2, 0, 'body', 0.003)
  }
}

