import { SRGB_TO_LINEAR } from './color'
import { boxBlurF32 } from './filters'
import type { BBox, RGBAImage } from './types'

/**
 * Low-frequency illumination of a selected surface, estimated from the render.
 *
 * The original pixels are albedo × lighting already mixed together, so lighting
 * cannot be recovered exactly. We approximate it with an edge-preserving smooth of
 * log-luminance (a self-guided filter): broad shading and crisp shadow edges have
 * high local variance and survive, while the old material's fine texture (wood
 * grain, speckle) has low variance relative to `eps` and is flattened out.
 */
export interface ShadingField {
  bbox: BBox
  /** grid cells per image pixel (≤ 1) */
  scale: number
  gw: number
  gh: number
  /** log(lighting / reference) per grid cell; 0 = reference lighting. */
  logS: Float32Array
  /** log of the reference (median) surface luminance. */
  logRef: number
}

export const LOG_EPS = 1e-4
const MAX_CELLS = 1_500_000

export function logLuminanceAt(data: Uint8ClampedArray, i: number): number {
  return Math.log(0.2126 * SRGB_TO_LINEAR[data[i]] + 0.7152 * SRGB_TO_LINEAR[data[i + 1]] + 0.0722 * SRGB_TO_LINEAR[data[i + 2]] + LOG_EPS)
}

/**
 * @param alpha full-size effective alpha of the surface (0..255)
 * @param bbox  bounding box of non-zero alpha
 * @param smoothing 0..1 — higher removes more of the original texture (and softens shadow edges)
 */
export function estimateShading(img: RGBAImage, alpha: Uint8Array, bbox: BBox, smoothing: number): ShadingField {
  const { width: w, data } = img
  const bw = bbox.x1 - bbox.x0
  const bh = bbox.y1 - bbox.y0
  const scale = Math.min(1, Math.sqrt(MAX_CELLS / (bw * bh)))
  const gw = Math.max(1, Math.ceil(bw * scale))
  const gh = Math.max(1, Math.ceil(bh * scale))
  const n = gw * gh

  // 1. Area-average log-luminance and coverage into the grid.
  const I = new Float32Array(n)
  const M = new Float32Array(n)
  const count = new Float32Array(n)
  for (let y = bbox.y0; y < bbox.y1; y++) {
    const gy = Math.min(gh - 1, Math.floor((y - bbox.y0) * scale))
    for (let x = bbox.x0; x < bbox.x1; x++) {
      const gx = Math.min(gw - 1, Math.floor((x - bbox.x0) * scale))
      const c = gy * gw + gx
      count[c]++
      const a = alpha[y * w + x]
      if (!a) continue
      const wt = a / 255
      I[c] += logLuminanceAt(data, (y * w + x) * 4) * wt
      M[c] += wt
    }
  }
  let sumI = 0
  let sumW = 0
  for (let c = 0; c < n; c++) {
    if (M[c] > 0) {
      I[c] /= M[c]
      sumI += I[c] * M[c]
      sumW += M[c]
    }
    M[c] = count[c] > 0 ? M[c] / count[c] : 0
  }
  const globalMean = sumW > 0 ? sumI / sumW : Math.log(0.18)

  // 2. Masked (normalised-convolution) self-guided filter.
  const s = Math.max(0, Math.min(1, smoothing))
  const diag = Math.hypot(bw, bh)
  const radiusPx = Math.max(4, Math.min(96, diag * 0.02)) * (0.5 + 1.5 * s)
  const r = Math.max(1, Math.round(radiusPx * scale))
  const eps = 0.002 + 0.078 * s * s + 0.02 * s

  const tmp = new Float32Array(n)
  const N = M.slice()
  boxBlurF32(N, gw, gh, r, tmp)
  const meanI = new Float32Array(n)
  const corrI = new Float32Array(n)
  for (let c = 0; c < n; c++) {
    meanI[c] = I[c] * M[c]
    corrI[c] = I[c] * I[c] * M[c]
  }
  boxBlurF32(meanI, gw, gh, r, tmp)
  boxBlurF32(corrI, gw, gh, r, tmp)
  const A = new Float32Array(n)
  const B = new Float32Array(n)
  for (let c = 0; c < n; c++) {
    if (N[c] < 1e-6) {
      meanI[c] = globalMean
      continue
    }
    const mu = meanI[c] / N[c]
    const v = Math.max(0, corrI[c] / N[c] - mu * mu)
    const a = v / (v + eps)
    meanI[c] = mu
    A[c] = a * M[c]
    B[c] = (mu - a * mu) * M[c]
  }
  boxBlurF32(A, gw, gh, r, tmp)
  boxBlurF32(B, gw, gh, r, tmp)

  const q = new Float32Array(n)
  for (let c = 0; c < n; c++) {
    if (N[c] < 1e-6) {
      q[c] = globalMean
      continue
    }
    const ma = A[c] / N[c]
    const mb = B[c] / N[c]
    // Outside the mask the guide is undefined; extrapolate with the local mean.
    const guide = M[c] > 0 ? I[c] : meanI[c]
    q[c] = ma * guide + mb
  }

  // 3. Reference level = median smoothed log-luminance over well-covered cells,
  // so the chosen material/paint appears at its true colour under typical light.
  const samples: number[] = []
  const stride = Math.max(1, Math.floor(n / 200_000))
  for (let c = 0; c < n; c += stride) if (M[c] > 0.5) samples.push(q[c])
  if (!samples.length) for (let c = 0; c < n; c++) if (M[c] > 0) samples.push(q[c])
  samples.sort((p, k) => p - k)
  const logRef = samples.length ? samples[samples.length >> 1] : globalMean

  for (let c = 0; c < n; c++) q[c] -= logRef
  return { bbox, scale, gw, gh, logS: q, logRef }
}

/** Bilinear lookup of log-shading at image pixel (x, y) (integer pixel coords). */
export function sampleLogShading(f: ShadingField, x: number, y: number): number {
  const gx = (x + 0.5 - f.bbox.x0) * f.scale - 0.5
  const gy = (y + 0.5 - f.bbox.y0) * f.scale - 0.5
  const x0 = gx <= 0 ? 0 : Math.min(f.gw - 1, Math.floor(gx))
  const y0 = gy <= 0 ? 0 : Math.min(f.gh - 1, Math.floor(gy))
  const x1 = Math.min(f.gw - 1, x0 + 1)
  const y1 = Math.min(f.gh - 1, y0 + 1)
  const tx = Math.max(0, Math.min(1, gx - x0))
  const ty = Math.max(0, Math.min(1, gy - y0))
  const g = f.logS
  const a = g[y0 * f.gw + x0] + (g[y0 * f.gw + x1] - g[y0 * f.gw + x0]) * tx
  const b = g[y1 * f.gw + x0] + (g[y1 * f.gw + x1] - g[y1 * f.gw + x0]) * tx
  return a + (b - a) * ty
}
