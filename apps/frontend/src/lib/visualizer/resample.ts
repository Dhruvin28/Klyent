import type { RGBAImage } from './types'

/** Area-average downscale of an RGBA image to exactly outW × outH. */
export function downscaleImage(src: RGBAImage, outW: number, outH: number): RGBAImage {
  const out = new Uint8ClampedArray(outW * outH * 4)
  const acc = new Float32Array(outW * 4)
  const cnt = new Float32Array(outW)
  const xs = new Int32Array(src.width)
  for (let x = 0; x < src.width; x++) xs[x] = Math.min(outW - 1, Math.floor((x * outW) / src.width))
  let oy = 0
  for (let y = 0; y <= src.height; y++) {
    const ny = y < src.height ? Math.min(outH - 1, Math.floor((y * outH) / src.height)) : -1
    if (ny !== oy) {
      for (let x = 0; x < outW; x++) {
        const c = cnt[x] || 1
        for (let k = 0; k < 4; k++) out[(oy * outW + x) * 4 + k] = Math.round(acc[x * 4 + k] / c)
      }
      acc.fill(0)
      cnt.fill(0)
      oy = ny
    }
    if (y === src.height) break
    const row = y * src.width * 4
    for (let x = 0; x < src.width; x++) {
      const o = xs[x]
      const i = row + x * 4
      acc[o * 4] += src.data[i]
      acc[o * 4 + 1] += src.data[i + 1]
      acc[o * 4 + 2] += src.data[i + 2]
      acc[o * 4 + 3] += src.data[i + 3]
      cnt[o]++
    }
  }
  return { width: outW, height: outH, data: out }
}

/** Area-average downscale of a single-channel mask. */
export function downscaleMask(src: Uint8Array, w: number, h: number, outW: number, outH: number): Uint8Array {
  const out = new Uint8Array(outW * outH)
  const acc = new Float32Array(outW)
  const cnt = new Float32Array(outW)
  const xs = new Int32Array(w)
  for (let x = 0; x < w; x++) xs[x] = Math.min(outW - 1, Math.floor((x * outW) / w))
  let oy = 0
  for (let y = 0; y <= h; y++) {
    const ny = y < h ? Math.min(outH - 1, Math.floor((y * outH) / h)) : -1
    if (ny !== oy) {
      for (let x = 0; x < outW; x++) out[oy * outW + x] = Math.round(acc[x] / (cnt[x] || 1))
      acc.fill(0)
      cnt.fill(0)
      oy = ny
    }
    if (y === h) break
    const row = y * w
    for (let x = 0; x < w; x++) {
      acc[xs[x]] += src[row + x]
      cnt[xs[x]]++
    }
  }
  return out
}

/**
 * Bilinear upscale of a logit map followed by a threshold at 0: the boundary is
 * placed with sub-pixel accuracy at full resolution (no blocky staircase).
 */
export function upscaleLogitsToMask(logits: Float32Array, sw: number, sh: number, outW: number, outH: number): Uint8Array {
  const out = new Uint8Array(outW * outH)
  const sx = sw / outW
  const sy = sh / outH
  for (let y = 0; y < outH; y++) {
    const fy = Math.max(0, Math.min(sh - 1, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < outW; x++) {
      const fx = Math.max(0, Math.min(sw - 1, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      const a = logits[y0 * sw + x0] + (logits[y0 * sw + x1] - logits[y0 * sw + x0]) * tx
      const b = logits[y1 * sw + x0] + (logits[y1 * sw + x1] - logits[y1 * sw + x0]) * tx
      if (a + (b - a) * ty > 0) out[y * outW + x] = 255
    }
  }
  return out
}
