import { PNG } from 'pngjs'
import type { AiWall, Pt } from '../contracts'

// Deterministic refinement of AI wall estimates against the drawing itself (plan §7, §10.3).
// Everything here works in page px and records what moved, so evidence stays traceable.

export interface RefinedWall {
  id: string
  a: Pt
  b: Pt
  thicknessPx: number
  kind: AiWall['kind']
  confidence: number
  method: 'vector' | 'raster' | 'ai'
  /** Largest endpoint movement applied by refinement, px. */
  shiftPx: number
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s })
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y
const len = (a: Pt) => Math.hypot(a.x, a.y)
const norm = (a: Pt) => mul(a, 1 / (len(a) || 1))

// ── Spatial index over vector segments ──

export class SegmentIndex {
  private cells = new Map<string, number[]>()
  constructor(
    readonly segs: Float32Array,
    private cell = 96
  ) {
    const n = Math.floor(segs.length / 5)
    for (let i = 0; i < n; i++) {
      const x0 = Math.min(segs[i * 5], segs[i * 5 + 2])
      const x1 = Math.max(segs[i * 5], segs[i * 5 + 2])
      const y0 = Math.min(segs[i * 5 + 1], segs[i * 5 + 3])
      const y1 = Math.max(segs[i * 5 + 1], segs[i * 5 + 3])
      for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
        for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
          const k = `${cx},${cy}`
          let list = this.cells.get(k)
          if (!list) this.cells.set(k, (list = []))
          list.push(i)
        }
      }
    }
  }
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    const out = new Set<number>()
    for (let cx = Math.floor(x0 / this.cell); cx <= Math.floor(x1 / this.cell); cx++) {
      for (let cy = Math.floor(y0 / this.cell); cy <= Math.floor(y1 / this.cell); cy++) {
        for (const i of this.cells.get(`${cx},${cy}`) ?? []) out.add(i)
      }
    }
    return [...out]
  }
}

/**
 * Snaps a wall to the two parallel face lines that bound it in the vector drawing.
 * Returns null when no convincing pair of faces is found (the AI estimate is kept).
 */
function refineWithVectors(w: AiWall, index: SegmentIndex): { a: Pt; b: Pt; thickness: number } | null {
  const d = norm(sub(w.b, w.a))
  const n = { x: -d.y, y: d.x }
  const L = len(sub(w.b, w.a))
  if (L < 8) return null
  const reach = Math.max(w.thicknessPx * 1.6, 10)
  const x0 = Math.min(w.a.x, w.b.x) - reach
  const x1 = Math.max(w.a.x, w.b.x) + reach
  const y0 = Math.min(w.a.y, w.b.y) - reach
  const y1 = Math.max(w.a.y, w.b.y) + reach
  const s = index.segs
  // Candidate face lines: parallel within 2°, overlapping ≥ 25% of the wall, within reach.
  const cands: { off: number; cover: number }[] = []
  for (const i of index.query(x0, y0, x1, y1)) {
    const p = { x: s[i * 5], y: s[i * 5 + 1] }
    const q = { x: s[i * 5 + 2], y: s[i * 5 + 3] }
    const sd = sub(q, p)
    const sl = len(sd)
    if (sl < Math.min(20, L * 0.2)) continue
    if (Math.abs(dot(norm(sd), n)) > Math.sin((2 * Math.PI) / 180)) continue
    const o1 = dot(sub(p, w.a), n)
    const o2 = dot(sub(q, w.a), n)
    const off = (o1 + o2) / 2
    if (Math.abs(off) > reach) continue
    const t1 = dot(sub(p, w.a), d)
    const t2 = dot(sub(q, w.a), d)
    const cover = Math.max(0, Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)))
    if (cover < L * 0.25) continue
    cands.push({ off, cover })
  }
  if (cands.length < 2) return null
  // Cluster offsets (1.5px) weighting by coverage.
  cands.sort((p, q) => p.off - q.off)
  const clusters: { off: number; cover: number }[] = []
  for (const c of cands) {
    const last = clusters[clusters.length - 1]
    if (last && Math.abs(c.off - last.off) < 1.5) {
      last.off = (last.off * last.cover + c.off * c.cover) / (last.cover + c.cover)
      last.cover += c.cover
    } else clusters.push({ ...c })
  }
  const target = Math.max(2, w.thicknessPx)
  let best: { lo: number; hi: number; score: number } | null = null
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const lo = clusters[i]
      const hi = clusters[j]
      const t = hi.off - lo.off
      if (t < target * 0.45 || t > target * 2.2) continue
      // Prefer pairs that straddle the AI centreline, match its thickness and cover the wall.
      const straddle = lo.off <= target * 0.35 && hi.off >= -target * 0.35 ? 1 : 0.4
      const score = straddle * Math.min(lo.cover, hi.cover) * (1 - Math.min(0.9, Math.abs(t - target) / target)) * (1 - Math.min(0.9, Math.abs((lo.off + hi.off) / 2) / reach))
      if (!best || score > best.score) best = { lo: lo.off, hi: hi.off, score }
    }
  }
  if (!best || best.score < L * 0.15) return null
  const mid = (best.lo + best.hi) / 2
  return { a: add(w.a, mul(n, mid)), b: add(w.b, mul(n, mid)), thickness: best.hi - best.lo }
}

// ── Raster refinement ──

export interface Gray {
  width: number
  height: number
  data: Uint8Array
  threshold: number
}

export function decodeGray(png: Buffer): Gray {
  const img = PNG.sync.read(png)
  const data = new Uint8Array(img.width * img.height)
  const hist = new Array(256).fill(0)
  for (let i = 0; i < data.length; i++) {
    const v = (img.data[i * 4] * 299 + img.data[i * 4 + 1] * 587 + img.data[i * 4 + 2] * 114) / 1000
    data[i] = v
    hist[data[i]]++
  }
  // Otsu threshold.
  const total = data.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return { width: img.width, height: img.height, data, threshold: Math.min(threshold, 200) }
}

/**
 * Finds the dark band of a raster wall by sampling profiles perpendicular to it.
 * Works best for poché/solid or double-line walls; returns null when profiles disagree.
 */
function refineWithRaster(w: AiWall, g: Gray): { a: Pt; b: Pt; thickness: number } | null {
  const d = norm(sub(w.b, w.a))
  const n = { x: -d.y, y: d.x }
  const L = len(sub(w.b, w.a))
  if (L < 20) return null
  const reach = Math.ceil(Math.max(w.thicknessPx * 1.5, 8))
  const dark = (p: Pt) => {
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (x < 0 || y < 0 || x >= g.width || y >= g.height) return false
    return g.data[y * g.width + x] < g.threshold
  }
  const centres: number[] = []
  const thick: number[] = []
  const K = 11
  for (let k = 1; k <= K; k++) {
    const t = 0.1 + (0.8 * k) / (K + 1)
    const base = add(w.a, mul(d, L * t))
    // Mark dark runs along the normal.
    const prof: boolean[] = []
    for (let o = -reach; o <= reach; o++) prof.push(dark(add(base, mul(n, o))))
    // Dark runs across the wall (1 px gaps bridged for anti-aliasing).
    const runs: { lo: number; hi: number }[] = []
    for (let i = 0; i < prof.length; i++) {
      if (!prof[i]) continue
      const last = runs[runs.length - 1]
      if (last && i - last.hi <= 2) last.hi = i
      else runs.push({ lo: i, hi: i })
    }
    if (!runs.length) continue
    // Candidate bands: a solid (poché) run, or the outer span of two face lines
    // (double-line walls have a light core). Pick the one matching the thickness best.
    const tw = Math.max(2, w.thicknessPx)
    let best: { centre: number; thickness: number; score: number } | null = null
    const consider = (centre: number, thickness: number) => {
      const score = Math.abs(thickness - tw) / tw + (Math.abs(centre - reach) / reach) * 0.35
      if (thickness >= 2 && score < 0.6 && (!best || score < best.score)) best = { centre, thickness, score }
    }
    const mid = (r: { lo: number; hi: number }) => (r.lo + r.hi) / 2
    for (let a = 0; a < runs.length; a++) {
      // Solid (poché) wall: the run's edges are the faces.
      consider(mid(runs[a]), runs[a].hi - runs[a].lo + 1)
      for (let b = a + 1; b < runs.length; b++) {
        // Double-line wall: faces are the centres of the two strokes, with a light core between.
        if (runs[b].lo - runs[a].hi < 3) continue
        consider((mid(runs[a]) + mid(runs[b])) / 2, mid(runs[b]) - mid(runs[a]))
      }
    }
    if (!best) continue
    const pick = best as { centre: number; thickness: number }
    centres.push(pick.centre - reach)
    thick.push(pick.thickness)
  }
  if (centres.length < 5) return null
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
  const mc = med(centres)
  const consistent = centres.filter((c) => Math.abs(c - mc) <= 1.5).length
  if (consistent < centres.length * 0.6) return null
  const mt = med(thick)
  return { a: add(w.a, mul(n, mc)), b: add(w.b, mul(n, mc)), thickness: mt }
}

/** Makes nearly axis-aligned walls exactly axis-aligned (tolerance 1.5°). */
function orthogonalize(w: { a: Pt; b: Pt }) {
  const dx = w.b.x - w.a.x
  const dy = w.b.y - w.a.y
  const ang = (Math.abs(Math.atan2(dy, dx)) * 180) / Math.PI
  const tol = 1.5
  if (ang < tol || ang > 180 - tol) {
    const y = (w.a.y + w.b.y) / 2
    return { a: { x: w.a.x, y }, b: { x: w.b.x, y } }
  }
  if (Math.abs(ang - 90) < tol) {
    const x = (w.a.x + w.b.x) / 2
    return { a: { x, y: w.a.y }, b: { x, y: w.b.y } }
  }
  return w
}

const lineIntersect = (p: Pt, r: Pt, q: Pt, s: Pt): Pt | null => {
  const den = r.x * s.y - r.y * s.x
  if (Math.abs(den) < 1e-9) return null
  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den
  return add(p, mul(r, t))
}

/**
 * Closes the wall graph: endpoints near another wall's line are moved onto it (corners
 * meet at the centreline intersection, T-junctions land on the host centreline), then
 * coincident endpoints are merged so room detection sees one joint.
 */
export function joinWalls(walls: RefinedWall[], tolPx: (w: RefinedWall) => number): RefinedWall[] {
  const out = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }))
  for (const w of out) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end]
      const tol = tolPx(w)
      let best: { pt: Pt; d: number } | null = null
      for (const o of out) {
        if (o === w) continue
        const od = sub(o.b, o.a)
        const ol = len(od)
        if (ol < 1) continue
        const odn = mul(od, 1 / ol)
        const t = dot(sub(p, o.a), odn)
        const along = Math.max(0, Math.min(ol, t))
        const foot = add(o.a, mul(odn, along))
        // Distance to the other segment (allowing the joint to sit just beyond its end).
        const dseg = len(sub(p, foot))
        if (dseg > tol + Math.max(o.thicknessPx, w.thicknessPx) / 2) continue
        // Corner/T: intersect the two centrelines.
        const wd = sub(w.b, w.a)
        const x = lineIntersect(w.a, wd, o.a, od)
        if (!x) continue
        const move = len(sub(x, p))
        const tx = dot(sub(x, o.a), odn)
        if (tx < -tol || tx > ol + tol) continue
        if (move > tol + o.thicknessPx) continue
        if (!best || move < best.d) best = { pt: x, d: move }
      }
      if (best) w[end] = best.pt
    }
  }
  // Merge coincident endpoints (cluster within 0.75 px).
  const pts: Pt[] = []
  const snap = (p: Pt) => {
    const hit = pts.find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 0.75)
    if (hit) return hit
    pts.push(p)
    return p
  }
  for (const w of out) {
    w.a = snap(w.a)
    w.b = snap(w.b)
  }
  return out.filter((w) => len(sub(w.b, w.a)) >= 2)
}

/**
 * Snaps a dimension's measured end points to the drawing's extension lines (vector
 * sheets): the line work perpendicular to the measurement direction that sits within a
 * few px of the AI estimate. Only the coordinate along the measurement is changed.
 */
export function snapDimension<T extends { p1: Pt; p2: Pt }>(d: T, index: SegmentIndex, tolPx = 6): T & { snapped: number } {
  const dir = norm(sub(d.p2, d.p1))
  const L = len(sub(d.p2, d.p1))
  if (L < 10) return { ...d, snapped: 0 }
  const s = index.segs
  let snapped = 0
  const snapEnd = (p: Pt): Pt => {
    let best: { delta: number; score: number } | null = null
    for (const i of index.query(p.x - 40, p.y - 40, p.x + 40, p.y + 40)) {
      const a = { x: s[i * 5], y: s[i * 5 + 1] }
      const b = { x: s[i * 5 + 2], y: s[i * 5 + 3] }
      const sd = sub(b, a)
      const sl = len(sd)
      if (sl < 4) continue
      if (Math.abs(dot(norm(sd), dir)) > 0.03) continue // must be perpendicular to the measurement
      const delta = dot(sub(a, p), dir)
      if (Math.abs(delta) > tolPx) continue
      // The extension line must pass close to the end point across the measurement.
      const perp = { x: -dir.y, y: dir.x }
      const t0 = dot(sub(a, p), perp)
      const t1 = dot(sub(b, p), perp)
      const gap = Math.min(t0, t1) > 0 ? Math.min(t0, t1) : Math.max(t0, t1) < 0 ? -Math.max(t0, t1) : 0
      if (gap > 30) continue
      const score = Math.abs(delta) + gap * 0.1
      if (!best || score < best.score) best = { delta, score }
    }
    if (!best) return p
    snapped++
    return add(p, mul(dir, best.delta))
  }
  const p1 = snapEnd(d.p1)
  const p2 = snapEnd(d.p2)
  return { ...d, p1, p2, snapped }
}

/**
 * Snaps an opening's ends to the jamb lines of the wall gap (vector sheets): line work
 * perpendicular to the wall, crossing the wall band, within a few px of each end.
 */
export function snapOpening<T extends { center: Pt; widthPx: number }>(o: T, wall: { a: Pt; b: Pt; thicknessPx: number }, index: SegmentIndex, tolPx = 8): T {
  const d = norm(sub(wall.b, wall.a))
  const n = { x: -d.y, y: d.x }
  const s = index.segs
  const half = Math.max(wall.thicknessPx, 4)
  const snapEnd = (sign: 1 | -1): number | null => {
    const e = add(o.center, mul(d, (sign * o.widthPx) / 2))
    let best: { along: number; err: number } | null = null
    for (const i of index.query(e.x - 30, e.y - 30, e.x + 30, e.y + 30)) {
      const a = { x: s[i * 5], y: s[i * 5 + 1] }
      const b = { x: s[i * 5 + 2], y: s[i * 5 + 3] }
      const sd = sub(b, a)
      if (len(sd) < 3 || Math.abs(dot(norm(sd), d)) > 0.05) continue
      const along = dot(sub(a, o.center), d)
      const err = Math.abs(along - (sign * o.widthPx) / 2)
      if (err > tolPx) continue
      // Must cross (or sit within) the wall band.
      const o1 = dot(sub(a, wall.a), n) - dot(sub(o.center, wall.a), n)
      const o2 = dot(sub(b, wall.a), n) - dot(sub(o.center, wall.a), n)
      if (Math.max(o1, o2) < -half || Math.min(o1, o2) > half) continue
      if (!best || err < best.err) best = { along, err }
    }
    return best ? best.along : null
  }
  const lo = snapEnd(-1)
  const hi = snapEnd(1)
  if (lo === null || hi === null || hi - lo < 4) return o
  return { ...o, center: add(o.center, mul(d, (lo + hi) / 2)), widthPx: hi - lo }
}

/** Snaps each edge of a furniture footprint to the parallel outline drawn for it. */
export function snapFootprint<T extends { center: Pt; widthPx: number; depthPx: number; rotationDeg: number }>(f: T, index: SegmentIndex, tolPx = 6): T {
  const r = (f.rotationDeg * Math.PI) / 180
  // Item frame: u along the width (front edge), v towards the front (rotation 0 = down the page).
  const u = { x: Math.cos(r), y: Math.sin(r) }
  const v = { x: -Math.sin(r), y: Math.cos(r) }
  const s = index.segs
  const edges = [
    { axis: u, other: v, off: f.widthPx / 2, span: f.depthPx },
    { axis: u, other: v, off: -f.widthPx / 2, span: f.depthPx },
    { axis: v, other: u, off: f.depthPx / 2, span: f.widthPx },
    { axis: v, other: u, off: -f.depthPx / 2, span: f.widthPx },
  ]
  const snapped = edges.map((e) => {
    const p = add(f.center, mul(e.axis, e.off))
    let best: { off: number; err: number } | null = null
    const reach = Math.max(e.span / 2, 20)
    for (const i of index.query(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
      const a = { x: s[i * 5], y: s[i * 5 + 1] }
      const b = { x: s[i * 5 + 2], y: s[i * 5 + 3] }
      const sd = sub(b, a)
      if (len(sd) < Math.min(10, e.span * 0.3)) continue
      if (Math.abs(dot(norm(sd), e.axis)) > 0.035) continue // parallel to the edge
      const off = dot(sub(a, f.center), e.axis)
      const err = Math.abs(off - e.off)
      if (err > tolPx) continue
      const t1 = dot(sub(a, f.center), e.other)
      const t2 = dot(sub(b, f.center), e.other)
      const cover = Math.max(0, Math.min(e.span / 2, Math.max(t1, t2)) - Math.max(-e.span / 2, Math.min(t1, t2)))
      if (cover < e.span * 0.4) continue
      if (!best || err < best.err) best = { off, err }
    }
    return best ? best.off : e.off
  })
  const [w1, w0, d1, d0] = snapped
  if (w1 - w0 < 4 || d1 - d0 < 4) return f
  const center = add(add(f.center, mul(u, (w1 + w0) / 2)), mul(v, (d1 + d0) / 2))
  return { ...f, center, widthPx: w1 - w0, depthPx: d1 - d0 }
}

/** Full refinement pipeline for one page. */
export function refineWalls(walls: AiWall[], opts: { index: SegmentIndex | null; gray: Gray | null }): RefinedWall[] {
  const refined: RefinedWall[] = walls.map((w) => {
    let r: { a: Pt; b: Pt; thickness: number } | null = null
    let method: RefinedWall['method'] = 'ai'
    if (opts.index) {
      r = refineWithVectors(w, opts.index)
      if (r) method = 'vector'
    } else if (opts.gray) {
      r = refineWithRaster(w, opts.gray)
      if (r) method = 'raster'
    }
    const base = r ?? { a: w.a, b: w.b, thickness: w.thicknessPx }
    const o = orthogonalize(base)
    const shiftPx = Math.max(len(sub(o.a, w.a)), len(sub(o.b, w.b)))
    return { id: w.id, a: o.a, b: o.b, thicknessPx: base.thickness, kind: w.kind, confidence: w.confidence, method, shiftPx }
  })
  return joinWalls(refined, (w) => Math.max(6, w.thicknessPx * 1.2))
}
