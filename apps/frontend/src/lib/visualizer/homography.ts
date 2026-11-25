import type { Mat3, Point, Quad } from './types'

/**
 * Solves the 3×3 projective transform H (h33 = 1) mapping src[i] → dst[i] for four
 * point pairs, using Gaussian elimination with partial pivoting on the 8×8 DLT system.
 * Throws if the configuration is degenerate (three collinear points, repeated points).
 */
export function solveHomography(src: Point[], dst: Point[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error('Homography needs exactly 4 point pairs')
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  const n = 8
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-12) throw new Error('Degenerate quad: corners must not be collinear or repeated')
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c]
    }
  }
  const h = new Float64Array(9)
  for (let i = 0; i < n; i++) h[i] = A[i][n] / A[i][i]
  h[8] = 1
  if (!h.every(Number.isFinite)) throw new Error('Degenerate quad')
  return h
}

export function applyHomography(H: Mat3, x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-18) throw new Error('Matrix is not invertible')
  const inv = new Float64Array([
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ])
  for (let k = 0; k < 9; k++) inv[k] /= det
  return inv
}

/** True when the quad is a simple convex polygon (any winding). */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = q[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) return false
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Homography from the plane's physical coordinates (millimetres, origin at the
 * rectangle's top-left, +x along TL→TR, +y along TL→BL) to image pixels.
 */
export function planeToImage(quad: Quad, widthMm: number, heightMm: number): Mat3 {
  return solveHomography(
    [{ x: 0, y: 0 }, { x: widthMm, y: 0 }, { x: widthMm, y: heightMm }, { x: 0, y: heightMm }],
    quad
  )
}

/**
 * Estimates the real width/height ratio of the planar rectangle imaged as `quad`,
 * assuming square pixels and a principal point at the image centre (true for
 * virtually all architectural renders). Based on Zhang & He, "Whiteboard scanning
 * and image enhancement" (2007). Falls back to the affine estimate when the quad
 * has no measurable perspective (focal length unobservable).
 */
export function estimateAspectRatio(quad: Quad, imageWidth: number, imageHeight: number): number {
  const u0 = imageWidth / 2
  const v0 = imageHeight / 2
  // Paper ordering: m1 = TL, m2 = TR, m3 = BL, m4 = BR; coordinates relative to principal point.
  const m1 = [quad[0].x - u0, quad[0].y - v0, 1]
  const m2 = [quad[1].x - u0, quad[1].y - v0, 1]
  const m4 = [quad[2].x - u0, quad[2].y - v0, 1]
  const m3 = [quad[3].x - u0, quad[3].y - v0, 1]
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const m14 = cross(m1, m4)
  const k2 = dot(m14, m3) / dot(cross(m2, m4), m3)
  const k3 = dot(m14, m2) / dot(cross(m3, m4), m2)
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]]
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]]

  const affine = Math.sqrt((n2[0] ** 2 + n2[1] ** 2) / (n3[0] ** 2 + n3[1] ** 2))
  const diag = Math.hypot(imageWidth, imageHeight)
  // The focal length is observable only with two finite vanishing points (both n2 and
  // n3 carry a z term). For one-point perspective (e.g. a floor trapezoid) assume a
  // typical architectural render lens (~60° horizontal FOV); the designer can override.
  let f2 = (imageWidth / (2 * Math.tan(Math.PI / 6))) ** 2
  // A direction's vanishing point lies at distance |n_xy| / |n_z| from the principal point.
  const vpFinite = (n: number[]) => (Math.abs(n[2]) * diag) / Math.hypot(n[0], n[1]) > 1e-3
  if (vpFinite(n2) && vpFinite(n3)) {
    const observed = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2])
    // Accept only focal lengths in a sane lens range (≈ 8mm–600mm full-frame equivalent).
    if (observed > 0 && Math.sqrt(observed) > diag * 0.2 && Math.sqrt(observed) < diag * 20) f2 = observed
  }
  const ratio = Math.sqrt((n2[0] ** 2 + n2[1] ** 2 + f2 * n2[2] ** 2) / (n3[0] ** 2 + n3[1] ** 2 + f2 * n3[2] ** 2))
  return Number.isFinite(ratio) && ratio > 0 ? ratio : affine
}

export function quadFromTuples(q: [[number, number], [number, number], [number, number], [number, number]]): Quad {
  return q.map(([x, y]) => ({ x, y })) as Quad
}

export function quadToTuples(q: Quad): [[number, number], [number, number], [number, number], [number, number]] {
  return q.map((p) => [p.x, p.y]) as [[number, number], [number, number], [number, number], [number, number]]
}
