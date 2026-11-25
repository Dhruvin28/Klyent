// Server-side copy of the pure plan geometry in apps/frontend/src/lib/designer/geometry.ts.
// The Interior 3D scene compiler must produce rooms exactly as the designer derives
// them, so keep these functions behaviourally identical to the frontend versions.
import type { Opening, Plan, Wall } from './plan'

export interface Vec2 {
  x: number
  y: number
}

export const EPS = 1 // mm: endpoints closer than this are the same joint

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x
export const len = (a: Vec2) => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)
export const same = (a: Vec2, b: Vec2, eps = EPS) => dist(a, b) <= eps

export function wallLength(w: Pick<Wall, 'a' | 'b'>) {
  return dist(w.a, w.b)
}

export function wallDir(w: Pick<Wall, 'a' | 'b'>): Vec2 {
  const l = wallLength(w) || 1
  return { x: (w.b.x - w.a.x) / l, y: (w.b.y - w.a.y) / l }
}

/** Unit normal pointing to the wall's left side (a→b, y-down plan coordinates). */
export function wallLeftNormal(w: Pick<Wall, 'a' | 'b'>): Vec2 {
  const d = wallDir(w)
  return { x: d.y, y: -d.x }
}

export function projectToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0
  const point = add(a, scale(ab, t))
  return { t, point, distance: dist(p, point) }
}

export function openingSpan(o: Pick<Opening, 'offset' | 'width'>) {
  return { start: o.offset - o.width / 2, end: o.offset + o.width / 2 }
}

export function clampOpeningOffset(offset: number, width: number, wallLen: number) {
  const half = width / 2
  if (wallLen <= width) return wallLen / 2
  return Math.min(wallLen - half, Math.max(half, offset))
}

export function signedArea(pts: Vec2[]) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export function polygonArea(pts: Vec2[]) {
  return Math.abs(signedArea(pts))
}

export function centroid(pts: Vec2[]): Vec2 {
  const a = signedArea(pts)
  if (Math.abs(a) < 1e-6) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 })
    return scale(s, 1 / Math.max(1, pts.length))
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function pointInPolygon(p: Vec2, pts: Vec2[]) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function interiorPoint(pts: Vec2[]): Vec2 {
  const c = centroid(pts)
  if (pointInPolygon(c, pts)) return c
  const ccw = signedArea(pts) > 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const l = dist(a, b)
    if (l < 1) continue
    const d = scale(sub(b, a), 1 / l)
    const n = ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }
    const p = add(scale(add(a, b), 0.5), scale(n, Math.min(50, l / 4)))
    if (pointInPolygon(p, pts)) return p
  }
  return c
}

export function insetPolygon(pts: Vec2[], insets: number[]): Vec2[] {
  const n = pts.length
  if (n < 3) return pts
  const ccw = signedArea(pts) > 0
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]
    const d = scale(sub(b, a), 1 / (dist(a, b) || 1))
    const inward = ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }
    const off = scale(inward, insets[i] ?? 0)
    return { p: add(a, off), d }
  })
  return lines.map((l, i) => {
    const prev = lines[(i - 1 + n) % n]
    const den = cross(prev.d, l.d)
    if (Math.abs(den) < 1e-9) return l.p
    const t = cross(sub(l.p, prev.p), l.d) / den
    return add(prev.p, scale(prev.d, t))
  })
}

interface Node {
  p: Vec2
  edges: { to: number; thickness: number }[]
}

/** Enclosed areas formed by the walls (faces of the planar wall graph), as centreline polygons. */
export function findEnclosures(walls: Wall[]): { points: Vec2[]; thickness: number[] }[] {
  const nodes: Node[] = []
  const nodeAt = (p: Vec2) => {
    let i = nodes.findIndex((n) => same(n.p, p))
    if (i < 0) {
      nodes.push({ p, edges: [] })
      i = nodes.length - 1
    }
    return i
  }
  const segs: { a: Vec2; b: Vec2; t: number }[] = []
  const ends = walls.flatMap((w) => [w.a, w.b])
  for (const w of walls) {
    if (wallLength(w) < EPS) continue
    const cuts = ends
      .map((p) => ({ p, ...projectToSegment(p, w.a, w.b) }))
      .filter((c) => c.distance <= EPS && c.t > 1e-6 && c.t < 1 - 1e-6)
      .sort((x, y) => x.t - y.t)
    const pts = [w.a, ...cuts.map((c) => c.point), w.b]
    for (let i = 0; i < pts.length - 1; i++) if (!same(pts[i], pts[i + 1])) segs.push({ a: pts[i], b: pts[i + 1], t: w.thickness })
  }
  for (const s of segs) {
    const i = nodeAt(s.a)
    const j = nodeAt(s.b)
    if (i === j || nodes[i].edges.some((e) => e.to === j)) continue
    nodes[i].edges.push({ to: j, thickness: s.t })
    nodes[j].edges.push({ to: i, thickness: s.t })
  }
  const angle = (from: number, to: number) => Math.atan2(nodes[to].p.y - nodes[from].p.y, nodes[to].p.x - nodes[from].p.x)
  for (let i = 0; i < nodes.length; i++) nodes[i].edges.sort((e1, e2) => angle(i, e1.to) - angle(i, e2.to))

  const visited = new Set<string>()
  const faces: { points: Vec2[]; thickness: number[] }[] = []
  for (let i = 0; i < nodes.length; i++) {
    for (const e0 of nodes[i].edges) {
      if (visited.has(`${i}>${e0.to}`)) continue
      const idx: number[] = []
      const th: number[] = []
      let u = i
      let e = e0
      let guard = 0
      while (!visited.has(`${u}>${e.to}`) && guard++ < 10_000) {
        visited.add(`${u}>${e.to}`)
        idx.push(u)
        th.push(e.thickness)
        const v = e.to
        const list = nodes[v].edges
        const back = list.findIndex((x) => x.to === u)
        e = list[(back - 1 + list.length) % list.length]
        u = v
      }
      if (idx.length < 3) continue
      let changed = true
      while (changed && idx.length >= 3) {
        changed = false
        for (let k = 0; k < idx.length; k++) {
          const next = (k + 1) % idx.length
          const prev = (k - 1 + idx.length) % idx.length
          if (idx[prev] === idx[next]) {
            const [hi, lo] = next > k ? [next, k] : [k, next]
            idx.splice(hi, 1)
            th.splice(hi, 1)
            idx.splice(lo, 1)
            th.splice(lo, 1)
            changed = true
            break
          }
        }
      }
      if (idx.length < 3) continue
      const pts = idx.map((k) => nodes[k].p)
      if (signedArea(pts) <= 0) continue
      faces.push({ points: pts.map((p) => ({ ...p })), thickness: th })
    }
  }
  return faces.filter((f) => polygonArea(f.points) >= 0.5e6)
}

export function roomInnerPolygon(room: { points: Vec2[] }, walls: Wall[]): Vec2[] {
  const n = room.points.length
  const insets = room.points.map((a, i) => {
    const b = room.points[(i + 1) % n]
    const mid = scale(add(a, b), 0.5)
    let t = 0
    for (const w of walls) if (projectToSegment(mid, w.a, w.b).distance <= EPS) t = Math.max(t, w.thickness)
    return t / 2
  })
  return insetPolygon(room.points, insets)
}

export function planBounds(plan: Pick<Plan, 'walls' | 'items'>): { min: Vec2; max: Vec2 } | null {
  const pts = [...plan.walls.flatMap((w) => [w.a, w.b]), ...plan.items.map((i) => ({ x: i.x, y: i.y }))]
  if (!pts.length) return null
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  }
}
