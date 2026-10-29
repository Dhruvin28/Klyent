import type { Item, Opening, Plan, Room, Vec2, Wall } from './types'

export const uid = () => crypto.randomUUID()

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

/** Unit direction a→b. */
export function wallDir(w: Pick<Wall, 'a' | 'b'>): Vec2 {
  const l = wallLength(w) || 1
  return { x: (w.b.x - w.a.x) / l, y: (w.b.y - w.a.y) / l }
}

/** Unit normal pointing to the wall's left side (a→b, y-down plan coordinates). */
export function wallLeftNormal(w: Pick<Wall, 'a' | 'b'>): Vec2 {
  const d = wallDir(w)
  return { x: d.y, y: -d.x }
}

/** Closest point on segment ab to p, with t in [0,1] and distance. */
export function projectToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0
  const point = add(a, scale(ab, t))
  return { t, point, distance: dist(p, point) }
}

/** The four corners of a wall's footprint (a-left, b-left, b-right, a-right). */
export function wallOutline(w: Wall): Vec2[] {
  const n = scale(wallLeftNormal(w), w.thickness / 2)
  return [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)]
}

/**
 * How far each end of a wall is pushed past its endpoint so neighbouring walls
 * meet without a gap at corners and T-junctions.
 */
export function wallExtensions(w: Wall, walls: Wall[]): { a: number; b: number } {
  const touches = (p: Vec2) =>
    walls.some((o) => o.id !== w.id && projectToSegment(p, o.a, o.b).distance <= EPS)
  const ext = (p: Vec2) => {
    if (!touches(p)) return 0
    // Half the thickest wall met here, so a thin wall butts fully into a thick one.
    let t = 0
    for (const o of walls) if (o.id !== w.id && projectToSegment(p, o.a, o.b).distance <= EPS) t = Math.max(t, o.thickness)
    return t / 2
  }
  return { a: ext(w.a), b: ext(w.b) }
}

export function openingSpan(o: Pick<Opening, 'offset' | 'width'>) {
  return { start: o.offset - o.width / 2, end: o.offset + o.width / 2 }
}

/** Keeps an opening fully inside its wall. */
export function clampOpeningOffset(offset: number, width: number, wallLen: number) {
  const half = width / 2
  if (wallLen <= width) return wallLen / 2
  return Math.min(wallLen - half, Math.max(half, offset))
}

// ── Polygons ────────────────────────────────────────────────────────────

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

/** A point guaranteed inside a simple polygon (centroid, or a nudged edge midpoint for concave shapes). */
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
    // Inward normal for this winding.
    const n = ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }
    const p = add(scale(add(a, b), 0.5), scale(n, Math.min(50, l / 4)))
    if (pointInPolygon(p, pts)) return p
  }
  return c
}

/**
 * Offsets every edge of a simple polygon inwards by its own distance (e.g. half the
 * thickness of the wall on that edge) and intersects neighbouring edges.
 */
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
    if (Math.abs(den) < 1e-9) return l.p // collinear edges: keep the offset point
    const t = cross(sub(l.p, prev.p), l.d) / den
    return add(prev.p, scale(prev.d, t))
  })
}

// ── Room detection ──────────────────────────────────────────────────────

interface Node {
  p: Vec2
  edges: { to: number; thickness: number }[]
}

/**
 * Finds the enclosed areas formed by the walls (the faces of the planar wall graph).
 * Walls are split where another wall's end lands on them (T-junctions).
 * Returns centreline polygons with the thickness of the wall along each edge.
 */
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
    // Split at every other wall end lying on this wall's interior.
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
        // Next edge: the one just before the reverse edge in angular order, which
        // traces faces with a consistent winding.
        const list = nodes[v].edges
        const back = list.findIndex((x) => x.to === u)
        e = list[(back - 1 + list.length) % list.length]
        u = v
      }
      if (idx.length < 3) continue
      // Remove spikes left by dangling walls (…A→B→A…).
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
      // This traversal walks interior faces with positive signed area in y-down space.
      if (signedArea(pts) <= 0) continue
      faces.push({ points: pts.map((p) => ({ ...p })), thickness: th })
    }
  }
  return faces.filter((f) => polygonArea(f.points) >= 0.5e6) // ≥ 0.5 m²
}

/** Recomputes rooms from walls, keeping names and finishes of rooms that still exist. */
export function syncRooms(walls: Wall[], prev: Room[]): Room[] {
  const faces = findEnclosures(walls)
  const used = new Set<string>()
  let counter = prev.length
  return faces.map((f) => {
    const probe = interiorPoint(f.points)
    const match =
      prev.find((r) => !used.has(r.id) && r.points.length >= 3 && pointInPolygon(probe, r.points)) ??
      prev.find((r) => !used.has(r.id) && r.points.length >= 3 && pointInPolygon(interiorPoint(r.points), f.points))
    if (match) {
      used.add(match.id)
      return { ...match, points: f.points }
    }
    counter += 1
    return { id: uid(), name: `Room ${counter}`, points: f.points, floor: null, ceiling: null }
  })
}

/** Inner (finished) outline of a room: centreline polygon inset by half the wall thickness. */
export function roomInnerPolygon(room: Room, walls: Wall[]): Vec2[] {
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

export function roomAreaSqm(room: Room, walls: Wall[]) {
  return polygonArea(roomInnerPolygon(room, walls)) / 1e6
}

// ── Editing helpers ─────────────────────────────────────────────────────

/** Moves every wall endpoint at `from` to `to` (keeps joints connected). */
export function moveJoint(walls: Wall[], from: Vec2, to: Vec2): Wall[] {
  return walls.map((w) => {
    const a = same(w.a, from) ? to : w.a
    const b = same(w.b, from) ? to : w.b
    return a === w.a && b === w.b ? w : { ...w, a, b }
  })
}

/** Rectangle of four walls (clockwise in plan view), reusing existing joints. */
export function rectangleWalls(p: Vec2, q: Vec2, thickness: number): Wall[] {
  const x0 = Math.min(p.x, q.x)
  const x1 = Math.max(p.x, q.x)
  const y0 = Math.min(p.y, q.y)
  const y1 = Math.max(p.y, q.y)
  const c = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
  return c.map((a, i) => ({ id: uid(), a, b: c[(i + 1) % 4], thickness, height: null, left: null, right: null }))
}

/**
 * Splits wall `w` at point p (on the wall), moving openings onto the right half.
 * Used when a new wall starts or ends in the middle of an existing one.
 */
export function splitWall(plan: Plan, wallId: string, p: Vec2): Plan {
  const w = plan.walls.find((x) => x.id === wallId)
  if (!w) return plan
  const { t } = projectToSegment(p, w.a, w.b)
  const L = wallLength(w)
  const cut = t * L
  if (cut < EPS * 10 || L - cut < EPS * 10) return plan
  const w1: Wall = { ...w, b: p }
  const w2: Wall = { ...w, id: uid(), a: p }
  const openings = plan.openings.map((o) => (o.wallId === w.id && o.offset > cut ? { ...o, wallId: w2.id, offset: o.offset - cut } : o))
  return { ...plan, walls: plan.walls.flatMap((x) => (x.id === w.id ? [w1, w2] : [x])), openings }
}

/** Removes zero-length walls and openings that no longer fit their wall. */
export function cleanupPlan(plan: Plan): Plan {
  const walls = plan.walls.filter((w) => wallLength(w) >= 10)
  const byId = new Map(walls.map((w) => [w.id, w]))
  const openings = plan.openings
    .filter((o) => byId.has(o.wallId))
    .map((o) => {
      const L = wallLength(byId.get(o.wallId)!)
      const width = Math.min(o.width, Math.max(100, L - 20))
      return { ...o, width, offset: clampOpeningOffset(o.offset, width, L) }
    })
  return { ...plan, walls, openings, rooms: syncRooms(walls, plan.rooms) }
}

export interface SnapResult {
  point: Vec2
  kind: 'joint' | 'wall' | 'grid' | 'none'
  wallId?: string
}

/**
 * Snaps a cursor position: to wall joints first, then onto walls, then to the grid.
 * `from` enables 0/45/90° angle locking while drawing.
 */
export function snapPoint(p: Vec2, walls: Wall[], opts: { grid: number; radius: number; from?: Vec2 | null; enabled: boolean }): SnapResult {
  if (!opts.enabled) return { point: p, kind: 'none' }
  let best: SnapResult | null = null
  let bestD = opts.radius
  for (const w of walls) {
    for (const q of [w.a, w.b]) {
      const d = dist(p, q)
      if (d < bestD) {
        bestD = d
        best = { point: q, kind: 'joint' }
      }
    }
  }
  if (best) return best
  let target = p
  if (opts.from) {
    const v = sub(p, opts.from)
    const L = len(v)
    if (L > 0) {
      const ang = Math.atan2(v.y, v.x)
      const step = Math.PI / 4
      const snapped = Math.round(ang / step) * step
      if (Math.abs(snapped - ang) < (4 * Math.PI) / 180) {
        const l = Math.round(L / opts.grid) * opts.grid
        target = add(opts.from, { x: Math.cos(snapped) * l, y: Math.sin(snapped) * l })
        target = { x: Math.round(target.x), y: Math.round(target.y) }
      }
    }
  }
  if (target === p) target = { x: Math.round(p.x / opts.grid) * opts.grid, y: Math.round(p.y / opts.grid) * opts.grid }
  for (const w of walls) {
    const pr = projectToSegment(p, w.a, w.b)
    if (pr.distance < opts.radius / 2 && pr.t > 0 && pr.t < 1) {
      // Keep the grid/angle-snapped position if it is also on the wall, else project.
      const onWall = projectToSegment(target, w.a, w.b)
      return { point: onWall.distance <= EPS ? target : pr.point, kind: 'wall', wallId: w.id }
    }
  }
  return { point: target, kind: 'grid' }
}

/**
 * Pushes an item's back against the nearest wall face when it is dropped close to
 * one, turning it to face into the room (like wardrobes and kitchen units).
 */
export function snapItemToWall(item: Item, walls: Wall[], threshold = 250): Pick<Item, 'x' | 'y' | 'rotation'> | null {
  const c = { x: item.x, y: item.y }
  let best: { w: Wall; pr: ReturnType<typeof projectToSegment> } | null = null
  for (const w of walls) {
    const pr = projectToSegment(c, w.a, w.b)
    if (pr.t <= 0 || pr.t >= 1) continue
    if (!best || pr.distance < best.pr.distance) best = { w, pr }
  }
  if (!best) return null
  const { w, pr } = best
  const gap = pr.distance - w.thickness / 2 - item.depth / 2
  if (gap > threshold) return null
  const n = wallLeftNormal(w)
  const side = dot(sub(c, pr.point), n) >= 0 ? 1 : -1
  const out = scale(n, side) // from wall towards the item
  const pos = add(pr.point, scale(out, w.thickness / 2 + item.depth / 2))
  // Item front is plan +y at rotation 0; rotate so front points along `out`.
  const rotation = ((Math.atan2(out.y, out.x) * 180) / Math.PI - 90 + 360) % 360
  return { x: Math.round(pos.x), y: Math.round(pos.y), rotation: Math.round(rotation * 10) / 10 }
}

/** Corners of an item's footprint in plan space. */
export function itemFootprint(item: Pick<Item, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Vec2[] {
  const r = (item.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const hw = item.width / 2
  const hd = item.depth / 2
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => ({ x: item.x + p.x * cos - p.y * sin, y: item.y + p.x * sin + p.y * cos }))
}

export function planBounds(plan: Plan): { min: Vec2; max: Vec2 } | null {
  const pts = [...plan.walls.flatMap((w) => [w.a, w.b]), ...plan.items.flatMap((i) => itemFootprint(i))]
  if (!pts.length) return null
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  }
}

export function formatMm(mm: number) {
  return mm >= 1000 ? `${(mm / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} m` : `${Math.round(mm)} mm`
}
