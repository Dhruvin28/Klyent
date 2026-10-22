import { boxBlurF32, morphU8 } from './filters'
import type { RGBAImage } from './types'

/**
 * Maximum distance (px) an edge may move when snapping. The server accepts edit
 * masks up to 3·max(1, round(feather)) + 1 ≥ 4px beyond the saved selection, so
 * snapping stays verifiable for every feather setting.
 */
export const EDGE_SNAP_RADIUS = 3

/**
 * Snaps the soft edge of a selection to edges in the render. Selections drawn at a
 * lower resolution (AI masks are predicted at 1024px) or with a loose brush end up on
 * the true outline of the wardrobe, handle or trim instead of a few pixels off it.
 *
 * Every pixel within `radius` of the selection boundary is re-estimated from a local
 * two-colour model: the mean colour of the surely-selected pixels nearby (Cin) and of
 * the surely-unselected ones (Cout). Its coverage is the projection of its colour onto
 * Cout→Cin, which also gives anti-aliased edge pixels their fractional value. Where the
 * two sides are hard to tell apart (low contrast, or busy grain inside) the estimate
 * is trusted less and the original alpha is kept.
 *
 * Only pixels within `radius` of the boundary change, so the result never reaches
 * further than `radius` px beyond `raw`.
 *
 * @param alpha the selection to refine (e.g. feathered), full image size, 0..255
 * @param raw   the unfeathered selection; its boundary defines the band that may change
 */
export function snapAlphaToEdges(img: RGBAImage, alpha: Uint8Array, raw: Uint8Array, radius = EDGE_SNAP_RADIUS): Uint8Array {
  const { width: w, height: h, data } = img
  const out = alpha.slice()
  const r = Math.max(1, Math.round(radius))
  const R = Math.max(6, 3 * r) // neighbourhood for the colour models

  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (raw[row + x] || alpha[row + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  if (x1 < 0) return out
  const pad = R + r + 1
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad)
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad)
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const n = bw * bh

  const bin = new Uint8Array(n)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) bin[y * bw + x] = raw[(y + y0) * w + x + x0] >= 128 ? 255 : 0
  const grown = morphU8(bin, bw, bh, r, 'max')
  const shrunk = morphU8(bin, bw, bh, r, 'min')

  // Box sums of colour (and colour²) over surely-in and surely-out pixels.
  const tmp = new Float32Array(n)
  const field = () => new Float32Array(n)
  const inN = field(), outN = field()
  const inC = [field(), field(), field()]
  const outC = [field(), field(), field()]
  const inSq = field(), outSq = field()
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const k = y * bw + x
      const i = ((y + y0) * w + x + x0) * 4
      const c0 = data[i] / 255, c1 = data[i + 1] / 255, c2 = data[i + 2] / 255
      const sq = c0 * c0 + c1 * c1 + c2 * c2
      if (shrunk[k]) {
        inN[k] = 1; inC[0][k] = c0; inC[1][k] = c1; inC[2][k] = c2; inSq[k] = sq
      } else if (!grown[k]) {
        outN[k] = 1; outC[0][k] = c0; outC[1][k] = c1; outC[2][k] = c2; outSq[k] = sq
      }
    }
  }
  for (const f of [inN, outN, ...inC, ...outC, inSq, outSq]) boxBlurF32(f, bw, bh, R, tmp)

  const MIN_SUPPORT = 2 / ((2 * R + 1) * (2 * R + 1))
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const k = y * bw + x
      if (!grown[k] || shrunk[k]) continue // outside the boundary band: keep as is
      const ni = inN[k], no = outN[k]
      if (ni < MIN_SUPPORT || no < MIN_SUPPORT) continue
      const p = (y + y0) * w + x + x0
      const i = p * 4
      const ci = [inC[0][k] / ni, inC[1][k] / ni, inC[2][k] / ni]
      const co = [outC[0][k] / no, outC[1][k] / no, outC[2][k] / no]
      const d0 = ci[0] - co[0], d1 = ci[1] - co[1], d2 = ci[2] - co[2]
      const den = d0 * d0 + d1 * d1 + d2 * d2
      if (den < 1e-4) continue // sides indistinguishable
      const varIn = Math.max(0, inSq[k] / ni - (ci[0] * ci[0] + ci[1] * ci[1] + ci[2] * ci[2]))
      const varOut = Math.max(0, outSq[k] / no - (co[0] * co[0] + co[1] * co[1] + co[2] * co[2]))
      const t = ((data[i] / 255 - co[0]) * d0 + (data[i + 1] / 255 - co[1]) * d1 + (data[i + 2] / 255 - co[2]) * d2) / den
      const tc = t < 0 ? 0 : t > 1 ? 1 : t
      // Confidence: separation of the two colours relative to their spread.
      const conf = den / (den + 2 * (varIn + varOut))
      const v = conf * tc * 255 + (1 - conf) * alpha[p]
      out[p] = v < 3 ? 0 : v > 252 ? 255 : Math.round(v)
    }
  }
  return out
}
