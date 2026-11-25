import { PNG } from 'pngjs'
import type { SceneExport } from './scene'

// Deterministic software renderer for the compiled scene (no Blender, GPU or native deps).
//
// It produces a clean, noise-free, dimension-exact image: z-buffered triangles, finish
// colours, a sun with shadow map, ambient occlusion, fixture light fall-off and crisp
// structural outlines. It serves two jobs:
//   1. the geometric *guide* sent to the AI image model (clean input => faithful output);
//   2. the exact render itself for technical views (plans, elevations, reflected ceilings).
// It also returns a structural edge mask, used to measure how closely an AI image keeps the
// model's geometry.

type V3 = [number, number, number]

export interface GuideModelGeometry {
  /** Positions normalised to a unit box: x,y in [-0.5,0.5], z in [0,1] (Blender axes). */
  positions: Float32Array
  indices: Uint32Array
  /** Linear-ish sRGB base colour of this primitive (0..1). */
  color: [number, number, number]
}

export interface GuideOptions {
  width: number
  height: number
  /** Aspect (w/h) the view was authored for; when it differs the horizontal extent is kept. */
  refAspect?: number
  /** Supersampling factor per axis (anti-aliasing). Default 2. */
  supersample?: number
  models?: Map<string, GuideModelGeometry[]>
}

export interface GuideResult {
  png: PNG
  /** 1 where a structural edge (silhouette / crease) was drawn, at the output resolution. */
  edges: Uint8Array
  stats: { triangles: number; ms: number }
}

const hexRgb = (hex: string): V3 => {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0')
  return [parseInt(n.slice(0, 2), 16) / 255 || 0, parseInt(n.slice(2, 4), 16) / 255 || 0, parseInt(n.slice(4, 6), 16) / 255 || 0]
}
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const toSrgb8 = (l: number) => {
  const v = l <= 0 ? 0 : l >= 1 ? 1 : l
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.round(c * 255)
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

interface Basis {
  pos: V3
  right: V3
  up: V3
  fwd: V3
}

function cameraBasis(position: V3, target: V3, upHint: V3): Basis {
  const fwd = norm(sub(target, position))
  let right = cross(fwd, norm(upHint))
  if (Math.hypot(...right) < 1e-6) right = cross(fwd, [0, 1, 0])
  right = norm(right)
  const up = norm(cross(right, fwd))
  return { pos: position, right, up, fwd }
}

interface Tris {
  /** World positions, 3 floats per vertex. */
  verts: Float32Array
  /** 3 vertex indices per triangle. */
  idx: Uint32Array
  /** Mesh index per triangle. */
  mesh: Int32Array
  /** Geometric normal per triangle (world). */
  normal: Float32Array
  count: number
}

interface MeshInfo {
  color: V3
  emissive: boolean
  strength: number
}

/** Flattens the compiled scene (and model proxies) into one triangle soup. Glass is left out. */
function collect(scene: SceneExport, models: Map<string, GuideModelGeometry[]> | undefined) {
  const infos: MeshInfo[] = []
  const mats = new Map(scene.materials.map((m) => [m.id, m]))
  const vertChunks: Float32Array[] = []
  const idxChunks: number[][] = []
  let vbase = 0
  const meshOfTri: number[] = []
  const push = (positions: ArrayLike<number>, indices: ArrayLike<number>, info: MeshInfo) => {
    if (!indices.length) return
    const mi = infos.push(info) - 1
    vertChunks.push(Float32Array.from(positions as ArrayLike<number> as number[]))
    const list = new Array<number>(indices.length)
    for (let i = 0; i < indices.length; i++) list[i] = indices[i] + vbase
    idxChunks.push(list)
    for (let i = 0; i < indices.length; i += 3) meshOfTri.push(mi)
    vbase += positions.length / 3
  }
  for (const m of scene.meshes) {
    const mat = mats.get(m.material)
    if (mat?.type === 'glass') continue
    const [r, g, b] = hexRgb(mat?.color ?? '#b8b8b8')
    // Textured finishes keep their tint colour in the guide (white = unknown, use a warm neutral).
    const white = mat?.texture && r > 0.97 && g > 0.97 && b > 0.97
    const col: V3 = white ? [0.72, 0.68, 0.62] : [r, g, b]
    push(m.positions, m.indices, { color: [toLin(col[0]), toLin(col[1]), toLin(col[2])], emissive: mat?.type === 'emissive', strength: mat?.strength ?? 0 })
  }
  for (const md of scene.models) {
    const parts = models?.get(md.file)
    const [sx, sy, sz] = md.size
    const c = Math.cos(md.rotationZ), s = Math.sin(md.rotationZ)
    const place = (p: ArrayLike<number>) => {
      const out = new Array<number>(p.length)
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i] * sx, y = p[i + 1] * sy
        out[i] = md.position[0] + x * c - y * s
        out[i + 1] = md.position[1] + x * s + y * c
        out[i + 2] = md.position[2] + p[i + 2] * sz
      }
      return out
    }
    if (parts?.length) {
      for (const part of parts) push(place(part.positions), part.indices, { color: [toLin(part.color[0]), toLin(part.color[1]), toLin(part.color[2])], emissive: false, strength: 0 })
    } else {
      // Bounding-box proxy when the model geometry is unavailable.
      const box: number[] = []
      for (const z of [0, 1]) for (const y of [-0.5, 0.5]) for (const x of [-0.5, 0.5]) box.push(x, y, z)
      const faces = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3]
      push(place(box), faces, { color: [toLin(0.72), toLin(0.76), toLin(0.8)], emissive: false, strength: 0 })
    }
  }
  const total = vertChunks.reduce((n, v) => n + v.length, 0)
  const verts = new Float32Array(total)
  let off = 0
  for (const v of vertChunks) {
    verts.set(v, off)
    off += v.length
  }
  const flat = idxChunks.flat()
  const idx = Uint32Array.from(flat)
  const count = idx.length / 3
  const normal = new Float32Array(count * 3)
  for (let t = 0; t < count; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
    const n = norm(cross([verts[b] - verts[a], verts[b + 1] - verts[a + 1], verts[b + 2] - verts[a + 2]], [verts[c] - verts[a], verts[c + 1] - verts[a + 1], verts[c + 2] - verts[a + 2]]))
    normal[t * 3] = n[0]
    normal[t * 3 + 1] = n[1]
    normal[t * 3 + 2] = n[2]
  }
  const tris: Tris = { verts, idx, mesh: Int32Array.from(meshOfTri), normal, count }
  return { tris, infos }
}

interface Raster {
  depth: Float32Array
  tri: Int32Array
}

interface ProjSpec {
  persp: boolean
  /** Perspective: focal length in pixels. Orthographic: pixels per metre. */
  k: number
  cx: number
  cy: number
}

/** Z-buffer rasteriser over camera-space vertices (x right, y up, z forward). */
function rasterize(t: Tris, basis: Basis, proj: ProjSpec, W: number, H: number, near = 0.03): Raster {
  const n = t.verts.length / 3
  const cam = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const p: V3 = [t.verts[i * 3] - basis.pos[0], t.verts[i * 3 + 1] - basis.pos[1], t.verts[i * 3 + 2] - basis.pos[2]]
    cam[i * 3] = dot(p, basis.right)
    cam[i * 3 + 1] = dot(p, basis.up)
    cam[i * 3 + 2] = dot(p, basis.fwd)
  }
  const depth = new Float32Array(W * H).fill(Infinity)
  const tri = new Int32Array(W * H).fill(-1)
  const draw = (id: number, a: V3, b: V3, c: V3) => {
    // Screen coordinates and the interpolant (1/z for perspective, z for orthographic).
    const sx = [0, 0, 0], sy = [0, 0, 0], q = [0, 0, 0]
    const P = [a, b, c]
    for (let i = 0; i < 3; i++) {
      const [x, y, z] = P[i]
      if (proj.persp) {
        sx[i] = proj.cx + (x / z) * proj.k
        sy[i] = proj.cy - (y / z) * proj.k
        q[i] = 1 / z
      } else {
        sx[i] = proj.cx + x * proj.k
        sy[i] = proj.cy - y * proj.k
        q[i] = z
      }
    }
    const minX = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])))
    const maxX = Math.min(W - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])))
    const minY = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])))
    const maxY = Math.min(H - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])))
    if (minX > maxX || minY > maxY) return
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])
    if (Math.abs(area) < 1e-9) return
    const inv = 1 / area
    const EPS = -1e-4
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) * inv
        const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) * inv
        const w2 = 1 - w0 - w1
        if (w0 < EPS || w1 < EPS || w2 < EPS) continue
        const qi = w0 * q[0] + w1 * q[1] + w2 * q[2]
        const z = proj.persp ? 1 / qi : qi
        const o = y * W + x
        // Relative tolerance: coplanar surfaces keep the first one drawn instead of z-fighting.
        if (z < depth[o] - (Math.abs(z) * 2e-5 + 1e-5)) {
          depth[o] = z
          tri[o] = id
        }
      }
    }
  }
  const v = (i: number): V3 => [cam[i * 3], cam[i * 3 + 1], cam[i * 3 + 2]]
  for (let id = 0; id < t.count; id++) {
    const a = v(t.idx[id * 3]), b = v(t.idx[id * 3 + 1]), c = v(t.idx[id * 3 + 2])
    // Clip against the near plane (Sutherland–Hodgman on one plane).
    const inside = [a[2] > near, b[2] > near, c[2] > near]
    const nIn = +inside[0] + +inside[1] + +inside[2]
    if (nIn === 0) continue
    if (nIn === 3) {
      draw(id, a, b, c)
      continue
    }
    const poly: V3[] = []
    const ring = [a, b, c]
    for (let i = 0; i < 3; i++) {
      const cur = ring[i], nxt = ring[(i + 1) % 3]
      const ci = cur[2] > near, ni = nxt[2] > near
      if (ci) poly.push(cur)
      if (ci !== ni) {
        const s = (near - cur[2]) / (nxt[2] - cur[2])
        poly.push([cur[0] + (nxt[0] - cur[0]) * s, cur[1] + (nxt[1] - cur[1]) * s, near])
      }
    }
    for (let i = 1; i + 1 < poly.length; i++) draw(id, poly[0], poly[i], poly[i + 1])
  }
  return { depth, tri }
}

const SKY_FALLBACK_TOP = '#9fc4f5'

/** Separable blur of the AO buffer that only mixes pixels at similar depth (keeps edges crisp). */
function aoBlur(ao: Float32Array, depth: Float32Array, W: number, H: number, radius: number): Float32Array {
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x
        const z = depth[o]
        if (!Number.isFinite(z)) {
          out[o] = src[o]
          continue
        }
        const tol = 0.05 + z * 0.02
        let s = 0, w = 0
        for (let d = -radius; d <= radius; d++) {
          const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
          const j = yy * W + xx
          if (Math.abs(depth[j] - z) > tol) continue
          const wt = 1 - Math.abs(d) / (radius + 1)
          s += src[j] * wt
          w += wt
        }
        out[o] = w ? s / w : src[o]
      }
    }
    return out
  }
  return pass(pass(ao, true), false)
}

export function renderGuide(scene: SceneExport, opts: GuideOptions): GuideResult {
  const started = Date.now()
  const ss = Math.max(1, Math.min(3, Math.round(opts.supersample ?? 2)))
  const W = opts.width * ss, H = opts.height * ss
  const { tris, infos } = collect(scene, opts.models)
  const cam = scene.camera
  const basis = cameraBasis(cam.position, cam.target, cam.up)
  const aspect = opts.width / opts.height
  const refAspect = opts.refAspect && opts.refAspect > 0 ? opts.refAspect : aspect

  const persp = cam.projection !== 'orthographic'
  let k: number
  if (persp) {
    // Vertical fov at the reference aspect; keep the horizontal extent when the aspect changes.
    const tanV = Math.tan((cam.fov * Math.PI) / 360)
    const tanV2 = tanV * (refAspect / aspect)
    k = H / 2 / tanV2
  } else {
    const ow = Math.max(cam.orthoWidth, 0.1), oh = Math.max(cam.orthoHeight, 0.1)
    // Same sizing rule as the Blender script, expressed as the visible box at the reference aspect.
    const scale = refAspect >= 1 ? Math.max(ow, oh * refAspect) : Math.max(oh, ow / refAspect)
    const refW = refAspect >= 1 ? scale : scale * refAspect
    const refH = refW / refAspect
    k = Math.min(W / refW, H / refH)
  }
  const proj: ProjSpec = { persp, k, cx: W / 2, cy: H / 2 }
  const ras = rasterize(tris, basis, proj, W, H, cam.clipStart ?? 0.03)

  // ── sun shadow map ──
  const night = scene.world.night
  const L = norm(scene.world.sunDirection as V3)
  const sunOn = !night && scene.world.sunStrength > 0
  let shadow: { map: Float32Array; size: number; basis: Basis; k: number; cx: number; cy: number } | null = null
  if (sunOn && tris.count) {
    const lb = cameraBasis([0, 0, 0], [-L[0], -L[1], -L[2]], Math.abs(L[2]) > 0.95 ? [0, 1, 0] : [0, 0, 1])
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity
    for (let i = 0; i < tris.verts.length; i += 3) {
      const p: V3 = [tris.verts[i], tris.verts[i + 1], tris.verts[i + 2]]
      const x = dot(p, lb.right), y = dot(p, lb.up), z = dot(p, lb.fwd)
      if (x < mnx) mnx = x
      if (x > mxx) mxx = x
      if (y < mny) mny = y
      if (y > mxy) mxy = y
      if (z < mnz) mnz = z
    }
    const size = 2048
    const span = Math.max(mxx - mnx, mxy - mny, 0.5) * 1.02
    // Shift so that every depth is positive.
    const sb: Basis = { ...lb, pos: [lb.fwd[0] * (mnz - 1), lb.fwd[1] * (mnz - 1), lb.fwd[2] * (mnz - 1)] }
    const sk = size / span
    const scx = size / 2 - ((mnx + mxx) / 2) * sk
    const scy = size / 2 + ((mny + mxy) / 2) * sk
    const sr = rasterize(tris, sb, { persp: false, k: sk, cx: scx, cy: scy }, size, size)
    shadow = { map: sr.depth, size, basis: sb, k: sk, cx: scx, cy: scy }
  }

  // ── lights (warm fixtures) ──
  const lamp = scene.lights
    .slice()
    .sort((a, b) => b.watts - a.watts)
    .slice(0, 24)
    .map((l) => ({ p: l.position as V3, c: hexRgb(l.color).map(toLin) as V3, w: l.watts }))

  const sunC = hexRgb(scene.world.sunColor).map(toLin) as V3
  const skyTop = hexRgb(scene.world.skyTop || SKY_FALLBACK_TOP).map(toLin) as V3
  const skyBot = hexRgb(scene.world.skyBottom || '#eef2f7').map(toLin) as V3
  const exposure = Math.max(0.3, scene.world.exposure || 1)
  const ambBase = night ? 0.07 : 0.5 * Math.min(1.4, Math.max(0.5, scene.world.skyStrength + 0.25))
  const sunGain = night ? 0 : Math.min(1.5, scene.world.sunStrength * 0.16)

  // ── ambient occlusion kernel ──
  const KN = 14
  const kernel: [number, number][] = []
  for (let i = 0; i < KN; i++) {
    const r = Math.sqrt((i + 0.5) / KN)
    const a = i * 2.399963
    kernel.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  const aoRadiusM = 0.45

  // Ambient occlusion pass: noise-rotated kernel, then a depth-aware blur to remove the noise.
  const aoRaw = new Float32Array(W * H).fill(1)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x
      if (ras.tri[o] < 0) continue
      const z = ras.depth[o]
      const rpx = Math.max(2, Math.min(48 * ss, persp ? (aoRadiusM * k) / z : aoRadiusM * k))
      const rot = 6.2831853 * (((52.9829189 * (((0.06711056 * x + 0.00583715 * y) % 1) + 1)) % 1))
      const cr = Math.cos(rot), sr = Math.sin(rot)
      let occ = 0
      for (let i = 0; i < KN; i++) {
        const kx = kernel[i][0] * cr - kernel[i][1] * sr, ky = kernel[i][0] * sr + kernel[i][1] * cr
        const sx = Math.round(x + kx * rpx), sy = Math.round(y + ky * rpx)
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
        const dz = z - ras.depth[sy * W + sx]
        if (dz > 0.025 * Math.max(1, z * 0.5) && dz < aoRadiusM * 1.6) occ += 1 - dz / (aoRadiusM * 1.6)
      }
      aoRaw[o] = Math.max(0.28, 1 - (occ / KN) * 1.25)
    }
  }
  const aoBuf = aoBlur(aoRaw, ras.depth, W, H, 3 * ss)

  const color = new Float32Array(W * H * 3)
  const bgTop = persp ? skyTop : ([0.93, 0.93, 0.93] as V3)
  const bgBot = persp ? skyBot : ([0.93, 0.93, 0.93] as V3)
  const tanHalf = persp ? 1 / k : 0

  for (let y = 0; y < H; y++) {
    const bgT = y / H
    for (let x = 0; x < W; x++) {
      const o = y * W + x
      const id = ras.tri[o]
      if (id < 0) {
        for (let c = 0; c < 3; c++) color[o * 3 + c] = bgTop[c] * (1 - bgT) + bgBot[c] * bgT
        continue
      }
      const z = ras.depth[o]
      const info = infos[tris.mesh[id]]
      // Camera-space position of the pixel centre → world.
      const px = x + 0.5 - proj.cx, py = -(y + 0.5 - proj.cy)
      const cxm = persp ? px * tanHalf * z : px / k
      const cym = persp ? py * tanHalf * z : py / k
      const wp: V3 = [
        basis.pos[0] + basis.right[0] * cxm + basis.up[0] * cym + basis.fwd[0] * z,
        basis.pos[1] + basis.right[1] * cxm + basis.up[1] * cym + basis.fwd[1] * z,
        basis.pos[2] + basis.right[2] * cxm + basis.up[2] * cym + basis.fwd[2] * z,
      ]
      if (info.emissive) {
        const e = Math.min(1.6, 0.9 + info.strength * 0.05)
        for (let c = 0; c < 3; c++) color[o * 3 + c] = Math.min(1.6, info.color[c] * e * 1.6)
        continue
      }
      let n: V3 = [tris.normal[id * 3], tris.normal[id * 3 + 1], tris.normal[id * 3 + 2]]
      const view: V3 = persp ? norm(sub(wp, basis.pos)) : basis.fwd
      if (dot(n, view) > 0) n = [-n[0], -n[1], -n[2]]

      const ao = aoBuf[o]

      // Sky/ground ambient (up-facing surfaces catch more skylight).
      let light = ambBase * (0.9 + 0.1 * n[2]) * ao

      // Sun with shadow-map visibility.
      if (sunOn && shadow) {
        const nl = dot(n, L)
        if (nl > 0) {
          const d: V3 = sub(wp, shadow.basis.pos)
          const lx = dot(d, shadow.basis.right), ly = dot(d, shadow.basis.up), lz = dot(d, shadow.basis.fwd)
          const mx = Math.round(shadow.cx + lx * shadow.k), my = Math.round(shadow.cy - ly * shadow.k)
          let vis = 1
          if (mx > 1 && my > 1 && mx < shadow.size - 2 && my < shadow.size - 2) {
            const bias = 0.035 + 0.05 * (1 - nl)
            let lit = 0
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (lz - bias <= shadow.map[(my + oy) * shadow.size + mx + ox]) lit++
            vis = lit / 9
          }
          light += sunGain * nl * vis * (0.5 + 0.5 * ao)
        }
      }

      // Fixture lights: inverse-square fall-off, tinted, no shadows (guide only).
      for (const l of lamp) {
        const dx = l.p[0] - wp[0], dy = l.p[1] - wp[1], dz = l.p[2] - wp[2]
        const d2 = dx * dx + dy * dy + dz * dz
        const inv = 1 / Math.sqrt(d2 || 1)
        const nl = n[0] * dx * inv + n[1] * dy * inv + n[2] * dz * inv
        if (nl <= 0) continue
        const e = Math.min(0.9, (l.w * 0.0085 * nl) / (d2 + 0.6)) * ao
        light += e * (night ? 2.2 : 0.7)
      }
      const L0 = light * exposure
      const o3 = o * 3
      color[o3] = info.color[0] * L0
      color[o3 + 1] = info.color[1] * L0
      color[o3 + 2] = info.color[2] * L0
    }
  }

  // ── structural edges at supersample resolution ──
  const edgeSS = new Uint8Array(W * H)
  const nrm = tris.normal
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const o = y * W + x
      const a = ras.tri[o]
      for (const o2 of [o + 1, o + W]) {
        const b = ras.tri[o2]
        if (a === b) continue
        if (a < 0 || b < 0) {
          edgeSS[o] = 1
          continue
        }
        if (tris.mesh[a] !== tris.mesh[b]) {
          edgeSS[o] = 1
          continue
        }
        const d = nrm[a * 3] * nrm[b * 3] + nrm[a * 3 + 1] * nrm[b * 3 + 1] + nrm[a * 3 + 2] * nrm[b * 3 + 2]
        if (Math.abs(d) < 0.86) edgeSS[o] = 1
      }
      // Depth discontinuity inside one mesh (e.g. a wall edge in front of the far wall).
      if (!edgeSS[o]) {
        const z0 = ras.depth[o], z1 = ras.depth[o + 1]
        if (Number.isFinite(z0) && Number.isFinite(z1) && Math.abs(z0 - z1) > 0.12 + z0 * 0.03) edgeSS[o] = 1
      }
    }
  }

  // ── resolve: box filter + outline blend ──
  const out = new PNG({ width: opts.width, height: opts.height })
  const edges = new Uint8Array(opts.width * opts.height)
  const ink: V3 = [0.035, 0.035, 0.045]
  const inv = 1 / (ss * ss)
  for (let y = 0; y < opts.height; y++) {
    for (let x = 0; x < opts.width; x++) {
      let r = 0, g = 0, b = 0, e = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const o = (y * ss + sy) * W + x * ss + sx
          // Tone-map per sample so highlights roll off before averaging (soft, clean AA).
          const cr = color[o * 3], cg = color[o * 3 + 1], cb = color[o * 3 + 2]
          r += cr / (1 + cr * 0.35)
          g += cg / (1 + cg * 0.35)
          b += cb / (1 + cb * 0.35)
          e += edgeSS[o]
        }
      }
      const f = Math.min(1, e * inv * 1.6)
      const p = (y * opts.width + x) * 4
      const mix = f * 0.8
      out.data[p] = toSrgb8((r * inv) * (1 - mix) + ink[0] * mix)
      out.data[p + 1] = toSrgb8((g * inv) * (1 - mix) + ink[1] * mix)
      out.data[p + 2] = toSrgb8((b * inv) * (1 - mix) + ink[2] * mix)
      out.data[p + 3] = 255
      edges[y * opts.width + x] = f > 0.3 ? 1 : 0
    }
  }
  return { png: out, edges, stats: { triangles: tris.count, ms: Date.now() - started } }
}
