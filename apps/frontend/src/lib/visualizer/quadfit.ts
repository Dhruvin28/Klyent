import { isConvexQuad } from './homography'
import type { Mask, Point, Quad } from './types'

type V = { x: number; y: number }

const cross = (o: V, a: V, b: V) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** Andrew's monotone chain; returns the hull counter-clockwise in image coordinates (y down = clockwise on screen). */
export function convexHull(points: V[]): V[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const lower: V[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: V[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

function lineIntersect(a: V, b: V, c: V, d: V): V | null {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x)
  if (Math.abs(den) < 1e-9) return null
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

/**
 * Reduces a convex polygon to k vertices by repeatedly collapsing the edge whose
 * removal (extending its two neighbours to meet) adds the least area — the classic
 * approximation of the minimum-area enclosing k-gon.
 */
export function reducePolygon(hull: V[], k: number): V[] | null {
  let poly = hull.slice()
  while (poly.length > k) {
    let best = -1
    let bestArea = Infinity
    let bestPt: V | null = null
    const n = poly.length
    for (let i = 0; i < n; i++) {
      const a = poly[(i - 1 + n) % n]
      const b = poly[i]
      const c = poly[(i + 1) % n]
      const d = poly[(i + 2) % n]
      const p = lineIntersect(a, b, c, d)
      if (!p) continue
      // The meeting point must lie beyond b (along a→b) and before c (along d→c), i.e. outside the polygon.
      if ((p.x - b.x) * (b.x - a.x) + (p.y - b.y) * (b.y - a.y) < -1e-6) continue
      if ((p.x - c.x) * (c.x - d.x) + (p.y - c.y) * (c.y - d.y) < -1e-6) continue
      const area = Math.abs(cross(b, p, c)) / 2
      if (area < bestArea) {
        bestArea = area
        best = i
        bestPt = p
      }
    }
    if (best < 0 || !bestPt) return null
    // Replace b with the meeting point and drop c.
    const next = (best + 1) % n
    const out: V[] = []
    for (let i = 0; i < n; i++) {
      if (i === best) out.push(bestPt)
      else if (i !== next) out.push(poly[i])
    }
    poly = out
  }
  return poly
}

/** Orders four corners TL, TR, BR, BL (screen orientation). */
export function orderQuad(pts: V[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  // Clockwise on screen (y down) starting from the top-left-most corner.
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i
  return [0, 1, 2, 3].map((i) => ({ x: sorted[(start + i) % 4].x, y: sorted[(start + i) % 4].y })) as Quad
}

/** Total-least-squares line through points: returns a point and unit direction. */
function fitLine(pts: V[]): { p: V; d: V } | null {
  if (pts.length < 2) return null
  let mx = 0, my = 0
  for (const p of pts) { mx += p.x; my += p.y }
  mx /= pts.length; my /= pts.length
  let sxx = 0, sxy = 0, syy = 0
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } }
}

/**
 * Fits the perspective quad of a planar surface to its selection: the convex hull
 * of the selection's outline reduced to four corners, then each side refined by a
 * line fit through the outline pixels along it (so a rounded corner or a notch for a
 * handle does not pull the side off the true edge).
 *
 * Returns null when the selection is empty or not plausibly four-sided.
 */
export function fitQuadToMask(mask: Mask): Quad | null {
  const { width: w, height: h, data } = mask
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= 128
  const boundary: V[] = []
  const hullPts: V[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      if (on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)) continue
      boundary.push({ x: x + 0.5, y: y + 0.5 })
      // Pixel corners make the hull enclose whole pixels.
      if (!on(x - 1, y) || !on(x, y - 1)) hullPts.push({ x, y })
      if (!on(x + 1, y) || !on(x, y - 1)) hullPts.push({ x: x + 1, y })
      if (!on(x + 1, y) || !on(x, y + 1)) hullPts.push({ x: x + 1, y: y + 1 })
      if (!on(x - 1, y) || !on(x, y + 1)) hullPts.push({ x, y: y + 1 })
    }
  }
  if (boundary.length < 8) return null
  const hull = convexHull(hullPts)
  if (hull.length < 4) return null
  const reduced = hull.length === 4 ? hull : reducePolygon(hull, 4)
  if (!reduced || reduced.length !== 4) return null
  let quad = orderQuad(reduced)
  if (!isConvexQuad(quad)) return null

  // Refine each side with a line fit through nearby outline pixels.
  const diag = Math.hypot(w, h)
  const tol = Math.max(2.5, diag * 0.004)
  const lines: ({ p: V; d: V } | null)[] = []
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1) return quad
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    const near: V[] = []
    for (const p of boundary) {
      const t = (p.x - a.x) * ux + (p.y - a.y) * uy
      // Ignore the ends of each side, where the outline turns the corner.
      if (t < len * 0.08 || t > len * 0.92) continue
      if (Math.abs(-(p.x - a.x) * uy + (p.y - a.y) * ux) <= tol) near.push(p)
    }
    lines.push(near.length >= Math.max(10, len * 0.2) ? fitLine(near) : null)
  }
  const refined: Point[] = []
  for (let i = 0; i < 4; i++) {
    const L1 = lines[(i + 3) % 4] // side ending at corner i
    const L2 = lines[i] // side starting at corner i
    let c: V | null = null
    if (L1 && L2) {
      c = lineIntersect(L1.p, { x: L1.p.x + L1.d.x, y: L1.p.y + L1.d.y }, L2.p, { x: L2.p.x + L2.d.x, y: L2.p.y + L2.d.y })
    }
    // Keep the hull corner if the fit is missing or implausible.
    refined.push(c && Math.hypot(c.x - quad[i].x, c.y - quad[i].y) < diag * 0.05 ? c : quad[i])
  }
  const rq = refined as Quad
  if (isConvexQuad(rq)) quad = rq
  return quad
}
