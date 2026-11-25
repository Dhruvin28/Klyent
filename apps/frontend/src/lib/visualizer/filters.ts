// O(N) separable filters (cost independent of radius) so they stay fast on
// full-resolution renders.

/** In-place box blur of a float field with clamped (edge-replicating) borders. */
export function boxBlurF32(src: Float32Array, w: number, h: number, r: number, tmp?: Float32Array): Float32Array {
  if (r < 1) return src
  const t = tmp && tmp.length >= w * h ? tmp : new Float32Array(w * h)
  const inv = 1 / (2 * r + 1)
  // horizontal: src → t
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[row + clampI(k, 0, w - 1)]
    for (let x = 0; x < w; x++) {
      t[row + x] = acc * inv
      acc += src[row + clampI(x + r + 1, 0, w - 1)] - src[row + clampI(x - r, 0, w - 1)]
    }
  }
  // vertical: t → src
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += t[clampI(k, 0, h - 1) * w + x]
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc * inv
      acc += t[clampI(y + r + 1, 0, h - 1) * w + x] - t[clampI(y - r, 0, h - 1) * w + x]
    }
  }
  return src
}

/**
 * Gaussian-like blur (three box passes) of an 8-bit mask, computed only inside the
 * mask's padded bounding box with edge-replicating borders — a mask that touches the
 * image edge stays fully opaque there. `radius` ≈ sigma in pixels; radii below 1
 * blend toward the input for sub-pixel softening.
 */
export function featherU8(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = mask.slice()
  if (radius <= 0) return out
  const r = Math.max(1, Math.round(radius))
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  if (x1 < 0) return out
  const pad = 3 * r + 1
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad)
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad)
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const f = new Float32Array(bw * bh)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) f[y * bw + x] = mask[(y + y0) * w + x + x0]
  const tmp = new Float32Array(bw * bh)
  boxBlurF32(f, bw, bh, r, tmp)
  boxBlurF32(f, bw, bh, r, tmp)
  boxBlurF32(f, bw, bh, r, tmp)
  const k = radius < 1 ? radius : 1
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * w + x + x0
      const v = mask[i] + (f[y * bw + x] - mask[i]) * k
      out[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)
    }
  }
  return out
}

/**
 * Morphological max (dilate) or min (erode) with a square window of side 2r+1,
 * using the van Herk / Gil–Werman algorithm (3 comparisons per pixel, any r).
 */
export function morphU8(src: Uint8Array, w: number, h: number, r: number, op: 'max' | 'min'): Uint8Array {
  if (r < 1) return src.slice()
  const out = new Uint8Array(w * h)
  const tmp = new Uint8Array(w * h)
  const pad = op === 'max' ? 0 : 255
  const pick = op === 'max' ? (a: number, b: number) => (a > b ? a : b) : (a: number, b: number) => (a < b ? a : b)
  const size = 2 * r + 1
  const line = new Uint8Array(Math.max(w, h) + 2 * size)
  const g = new Uint8Array(line.length)
  const hh = new Uint8Array(line.length)

  const run = (n: number, read: (i: number) => number, write: (i: number, v: number) => void) => {
    const len = n + 2 * r
    const padded = Math.ceil(len / size) * size
    for (let i = 0; i < padded; i++) {
      const j = i - r
      line[i] = j >= 0 && j < n ? read(j) : pad
    }
    for (let b = 0; b < padded; b += size) {
      g[b] = line[b]
      for (let i = 1; i < size; i++) g[b + i] = pick(g[b + i - 1], line[b + i])
      hh[b + size - 1] = line[b + size - 1]
      for (let i = size - 2; i >= 0; i--) hh[b + i] = pick(hh[b + i + 1], line[b + i])
    }
    for (let j = 0; j < n; j++) write(j, pick(hh[j], g[j + 2 * r]))
  }

  for (let y = 0; y < h; y++) {
    const row = y * w
    run(w, (i) => src[row + i], (i, v) => (tmp[row + i] = v))
  }
  for (let x = 0; x < w; x++) {
    run(h, (i) => tmp[i * w + x], (i, v) => (out[i * w + x] = v))
  }
  return out
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
