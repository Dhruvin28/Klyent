import { SRGB_TO_LINEAR, linearToSrgbExact } from './color'
import { boxBlurF32 } from './filters'
import { applyHomography, solveHomography } from './homography'
import type { Quad, RGBAImage } from './types'

export function createImage(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/**
 * Crops and straightens the region of a sample photo bounded by `quad`
 * (TL, TR, BR, BL) into an outW × outH image. Each output pixel is the average of
 * a 2×2 grid of bilinear samples to limit aliasing when the photo is downscaled.
 */
export function rectify(src: RGBAImage, quad: Quad, outW: number, outH: number): RGBAImage {
  const H = solveHomography(
    [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }],
    quad
  )
  const out = createImage(outW, outH)
  const acc = new Float32Array(3)
  const px = new Float32Array(3)
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      acc[0] = acc[1] = acc[2] = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const p = applyHomography(H, x + 0.25 + sx * 0.5, y + 0.25 + sy * 0.5)
          bilinearLinear(src, p.x - 0.5, p.y - 0.5, false, px)
          acc[0] += px[0]; acc[1] += px[1]; acc[2] += px[2]
        }
      }
      const o = (y * outW + x) * 4
      out.data[o] = linearToSrgbExact(acc[0] / 4)
      out.data[o + 1] = linearToSrgbExact(acc[1] / 4)
      out.data[o + 2] = linearToSrgbExact(acc[2] / 4)
      out.data[o + 3] = 255
    }
  }
  return out
}

/**
 * Removes the photographed lighting gradient (vignetting, a lamp hot-spot) from a
 * sample: divides by a heavily blurred luminance so large-scale brightness becomes
 * uniform while the material's own pattern and colour are kept.
 * `strength` 0..1 blends between untouched and fully flattened.
 */
export function flattenLighting(img: RGBAImage, strength: number): RGBAImage {
  const k = Math.max(0, Math.min(1, strength))
  const out = createImage(img.width, img.height)
  out.data.set(img.data)
  if (k === 0) return out
  const { width: w, height: h, data } = img
  const n = w * h
  const Y = new Float32Array(n)
  let mean = 0
  for (let p = 0; p < n; p++) {
    const i = p * 4
    Y[p] = 0.2126 * SRGB_TO_LINEAR[data[i]] + 0.7152 * SRGB_TO_LINEAR[data[i + 1]] + 0.0722 * SRGB_TO_LINEAR[data[i + 2]] + 1e-4
    mean += Y[p]
  }
  mean /= n
  const low = Y.slice()
  const r = Math.max(2, Math.round(Math.min(w, h) / 8))
  const tmp = new Float32Array(n)
  boxBlurF32(low, w, h, r, tmp)
  boxBlurF32(low, w, h, r, tmp)
  boxBlurF32(low, w, h, r, tmp)
  for (let p = 0; p < n; p++) {
    const gain = Math.pow(mean / low[p], k)
    const i = p * 4
    out.data[i] = linearToSrgbExact(SRGB_TO_LINEAR[data[i]] * gain)
    out.data[i + 1] = linearToSrgbExact(SRGB_TO_LINEAR[data[i + 1]] * gain)
    out.data[i + 2] = linearToSrgbExact(SRGB_TO_LINEAR[data[i + 2]] * gain)
    out.data[i + 3] = 255
  }
  return out
}

/**
 * Makes a texture tile seamlessly by cross-fading a band of `fraction` of each
 * dimension from the far edge into the near edge, then trimming that band. The
 * result is (w − bx) × (h − by); callers must scale the physical size by the same
 * ratio (see seamlessScale).
 */
export function makeSeamless(img: RGBAImage, fraction: number): RGBAImage {
  const f = Math.max(0, Math.min(0.45, fraction))
  if (f === 0) return { width: img.width, height: img.height, data: img.data.slice() }
  const bx = Math.max(1, Math.round(img.width * f))
  const by = Math.max(1, Math.round(img.height * f))
  // horizontal pass
  const w1 = img.width - bx
  const h0 = img.height
  const a = createImage(w1, h0)
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w1; x++) {
      const o = (y * w1 + x) * 4
      const near = (y * img.width + x) * 4
      if (x < bx) {
        const t = smooth((x + 0.5) / bx)
        const far = (y * img.width + x + w1) * 4
        for (let c = 0; c < 3; c++) a.data[o + c] = img.data[far + c] + (img.data[near + c] - img.data[far + c]) * t
      } else {
        for (let c = 0; c < 3; c++) a.data[o + c] = img.data[near + c]
      }
      a.data[o + 3] = 255
    }
  }
  // vertical pass
  const h1 = h0 - by
  const b = createImage(w1, h1)
  for (let y = 0; y < h1; y++) {
    for (let x = 0; x < w1; x++) {
      const o = (y * w1 + x) * 4
      const near = (y * w1 + x) * 4
      if (y < by) {
        const t = smooth((y + 0.5) / by)
        const far = ((y + h1) * w1 + x) * 4
        for (let c = 0; c < 3; c++) b.data[o + c] = a.data[far + c] + (a.data[near + c] - a.data[far + c]) * t
      } else {
        for (let c = 0; c < 3; c++) b.data[o + c] = a.data[near + c]
      }
      b.data[o + 3] = 255
    }
  }
  return b
}

/** Ratio the physical width/height shrink by when makeSeamless trims its blend band. */
export function seamlessScale(width: number, height: number, fraction: number): { sx: number; sy: number } {
  const f = Math.max(0, Math.min(0.45, fraction))
  if (f === 0) return { sx: 1, sy: 1 }
  const bx = Math.max(1, Math.round(width * f))
  const by = Math.max(1, Math.round(height * f))
  return { sx: (width - bx) / width, sy: (height - by) / height }
}

function smooth(t: number) {
  return t * t * (3 - 2 * t)
}

/** Downscales (area average in linear light) so neither side exceeds maxSide. */
export function limitSize(img: RGBAImage, maxSide: number): RGBAImage {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height))
  if (s >= 1) return img
  const w = Math.max(1, Math.round(img.width * s))
  const h = Math.max(1, Math.round(img.height * s))
  const out = createImage(w, h)
  const acc = new Float64Array(w * h * 3)
  const cnt = new Float64Array(w * h)
  for (let y = 0; y < img.height; y++) {
    const oy = Math.min(h - 1, Math.floor((y * h) / img.height))
    for (let x = 0; x < img.width; x++) {
      const ox = Math.min(w - 1, Math.floor((x * w) / img.width))
      const i = (y * img.width + x) * 4
      const o = oy * w + ox
      acc[o * 3] += SRGB_TO_LINEAR[img.data[i]]
      acc[o * 3 + 1] += SRGB_TO_LINEAR[img.data[i + 1]]
      acc[o * 3 + 2] += SRGB_TO_LINEAR[img.data[i + 2]]
      cnt[o]++
    }
  }
  for (let o = 0; o < w * h; o++) {
    for (let c = 0; c < 3; c++) out.data[o * 4 + c] = linearToSrgbExact(acc[o * 3 + c] / cnt[o])
    out.data[o * 4 + 3] = 255
  }
  return out
}

/** Full mip chain (each level a 2×2 linear-light average of the previous). */
export function buildMipmaps(base: RGBAImage): RGBAImage[] {
  const levels = [base]
  let cur = base
  while (cur.width > 1 || cur.height > 1) {
    const w = Math.max(1, cur.width >> 1)
    const h = Math.max(1, cur.height >> 1)
    const next = createImage(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xs = [Math.min(cur.width - 1, 2 * x), Math.min(cur.width - 1, 2 * x + 1)]
        const ys = [Math.min(cur.height - 1, 2 * y), Math.min(cur.height - 1, 2 * y + 1)]
        const o = (y * w + x) * 4
        for (let c = 0; c < 3; c++) {
          let s = 0
          for (const yy of ys) for (const xx of xs) s += SRGB_TO_LINEAR[cur.data[(yy * cur.width + xx) * 4 + c]]
          next.data[o + c] = linearToSrgbExact(s / 4)
        }
        next.data[o + 3] = 255
      }
    }
    levels.push(next)
    cur = next
  }
  return levels
}

/**
 * Bilinear sample in linear light at texel coordinates (u, v) where texel centres
 * sit at integer coordinates. `wrap` repeats the texture; otherwise edges clamp.
 */
export function bilinearLinear(img: RGBAImage, u: number, v: number, wrap: boolean, out: Float32Array): void {
  const { width: w, height: h, data } = img
  let x0 = Math.floor(u)
  let y0 = Math.floor(v)
  const tx = u - x0
  const ty = v - y0
  let x1 = x0 + 1
  let y1 = y0 + 1
  if (wrap) {
    x0 = ((x0 % w) + w) % w
    y0 = ((y0 % h) + h) % h
    x1 = x0 + 1 === w ? 0 : x0 + 1
    y1 = y0 + 1 === h ? 0 : y0 + 1
  } else {
    x0 = x0 < 0 ? 0 : x0 >= w ? w - 1 : x0
    x1 = x1 < 0 ? 0 : x1 >= w ? w - 1 : x1
    y0 = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0
    y1 = y1 < 0 ? 0 : y1 >= h ? h - 1 : y1
  }
  const i00 = (y0 * w + x0) * 4
  const i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4
  const i11 = (y1 * w + x1) * 4
  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty
  for (let c = 0; c < 3; c++) {
    out[c] =
      SRGB_TO_LINEAR[data[i00 + c]] * w00 +
      SRGB_TO_LINEAR[data[i10 + c]] * w10 +
      SRGB_TO_LINEAR[data[i01 + c]] * w01 +
      SRGB_TO_LINEAR[data[i11 + c]] * w11
  }
}

const tmpA = new Float32Array(3)
const tmpB = new Float32Array(3)

/**
 * Trilinear (mip-mapped) sample. (u, v) are normalised texture coordinates
 * (1 = one full texture), `texelsPerPixel` is the screen footprint at level 0.
 */
export function sampleTrilinear(levels: RGBAImage[], u: number, v: number, texelsPerPixel: number, wrap: boolean, out: Float32Array): void {
  const lod = texelsPerPixel > 1 ? Math.min(levels.length - 1, Math.log2(texelsPerPixel)) : 0
  const l0 = Math.floor(lod)
  const t = lod - l0
  const A = levels[l0]
  bilinearLinear(A, u * A.width - 0.5, v * A.height - 0.5, wrap, tmpA)
  if (t < 1e-3 || l0 + 1 >= levels.length) {
    out[0] = tmpA[0]; out[1] = tmpA[1]; out[2] = tmpA[2]
    return
  }
  const B = levels[l0 + 1]
  bilinearLinear(B, u * B.width - 0.5, v * B.height - 0.5, wrap, tmpB)
  out[0] = tmpA[0] + (tmpB[0] - tmpA[0]) * t
  out[1] = tmpA[1] + (tmpB[1] - tmpA[1]) * t
  out[2] = tmpA[2] + (tmpB[2] - tmpA[2]) * t
}

/**
 * Removes a colour cast from a sample photo (shot under warm or cool light) given the
 * mean sRGB of a neutral patch (white or grey card, or a known neutral area): each
 * channel is scaled in linear light so that patch becomes grey at the same luminance.
 */
export function whiteBalance(img: RGBAImage, neutral: [number, number, number]): RGBAImage {
  const lin = neutral.map((v) => SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(v)))])
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  const gain = lin.map((c) => Math.max(0.4, Math.min(2.5, Y / Math.max(c, 1e-4))))
  const out = createImage(img.width, img.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    out.data[i] = linearToSrgbExact(SRGB_TO_LINEAR[d[i]] * gain[0])
    out.data[i + 1] = linearToSrgbExact(SRGB_TO_LINEAR[d[i + 1]] * gain[1])
    out.data[i + 2] = linearToSrgbExact(SRGB_TO_LINEAR[d[i + 2]] * gain[2])
    out.data[i + 3] = 255
  }
  return out
}

/** Mean sRGB of a (2r+1)² patch, e.g. where the designer clicked a white card. */
export function samplePatch(img: RGBAImage, x: number, y: number, r = 4): [number, number, number] {
  let R = 0, G = 0, B = 0, n = 0
  for (let yy = Math.max(0, Math.floor(y) - r); yy <= Math.min(img.height - 1, Math.floor(y) + r); yy++) {
    for (let xx = Math.max(0, Math.floor(x) - r); xx <= Math.min(img.width - 1, Math.floor(x) + r); xx++) {
      const i = (yy * img.width + xx) * 4
      R += img.data[i]; G += img.data[i + 1]; B += img.data[i + 2]; n++
    }
  }
  return n ? [R / n, G / n, B / n] : [128, 128, 128]
}

/**
 * Minimum-error seam through an h × band cost field (dynamic programming; the seam
 * may move one column per row). Returns the cut column for every row.
 */
function minCutSeam(cost: Float32Array, band: number, h: number, interior = false): Int32Array {
  // interior: keep the cut off the band's first and last column, so the band's outer
  // edges are pure copies (needed where those edges must wrap seamlessly).
  if (interior && band >= 3) {
    cost = cost.slice()
    for (let y = 0; y < h; y++) {
      cost[y * band] = 1e30
      cost[y * band + band - 1] = 1e30
    }
  }
  const acc = new Float32Array(band * h)
  acc.set(cost.subarray(0, band))
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < band; x++) {
      let m = acc[(y - 1) * band + x]
      if (x > 0) m = Math.min(m, acc[(y - 1) * band + x - 1])
      if (x < band - 1) m = Math.min(m, acc[(y - 1) * band + x + 1])
      acc[y * band + x] = cost[y * band + x] + m
    }
  }
  const cut = new Int32Array(h)
  let best = 0
  for (let x = 1; x < band; x++) if (acc[(h - 1) * band + x] < acc[(h - 1) * band + best]) best = x
  cut[h - 1] = best
  for (let y = h - 2; y >= 0; y--) {
    const c = cut[y + 1]
    let b = c
    for (const x of [c - 1, c + 1]) if (x >= 0 && x < band && acc[y * band + x] < acc[y * band + b]) b = x
    cut[y] = b
  }
  return cut
}

/** One horizontal seam pass: trims `bx` columns, joining the far edge into the near edge along a seam. */
function seamPass(img: RGBAImage, bx: number): RGBAImage {
  const { width: w, height: h, data } = img
  const w1 = w - bx
  const cost = new Float32Array(bx * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < bx; x++) {
      const a = (y * w + x) * 4
      const b = (y * w + x + w1) * 4
      const dr = data[a] - data[b], dg = data[a + 1] - data[b + 1], db = data[a + 2] - data[b + 2]
      cost[y * bx + x] = dr * dr + dg * dg + db * db
    }
  }
  const cut = minCutSeam(cost, bx, h, true)
  const out = createImage(w1, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w1; x++) {
      const o = (y * w1 + x) * 4
      const near = (y * w + x) * 4
      if (x < bx) {
        // far copy (x + w1) left of the cut, near copy right of it; 2px blend across the cut
        const t = Math.max(0, Math.min(1, (x - cut[y] + 1) / 2))
        const far = (y * w + x + w1) * 4
        for (let c = 0; c < 3; c++) out.data[o + c] = data[far + c] + (data[near + c] - data[far + c]) * t
      } else {
        for (let c = 0; c < 3; c++) out.data[o + c] = data[near + c]
      }
      out.data[o + 3] = 255
    }
  }
  return out
}

function transpose(img: RGBAImage): RGBAImage {
  const out = createImage(img.height, img.width)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const o = (x * img.height + y) * 4
      out.data[o] = img.data[i]; out.data[o + 1] = img.data[i + 1]; out.data[o + 2] = img.data[i + 2]; out.data[o + 3] = 255
    }
  }
  return out
}

/** Seam passes trimming exactly `bx` columns and `by` rows. */
function seamBoth(img: RGBAImage, bx: number, by: number): RGBAImage {
  return transpose(seamPass(transpose(seamPass(img, bx)), by))
}

/**
 * Seamless tiling by a minimum-difference seam instead of a cross-fade: inside the
 * overlap band each row switches from the far edge to the near edge where the two
 * agree best, with a 2px blend. Wood grain and stone veins are joined rather than
 * ghosted (a cross-fade shows two half-transparent copies of the grain). Same output
 * size and physical scale as makeSeamless (see seamlessScale).
 */
export function makeSeamlessCut(img: RGBAImage, fraction: number): RGBAImage {
  const f = Math.max(0, Math.min(0.45, fraction))
  if (f === 0) return { width: img.width, height: img.height, data: img.data.slice() }
  return seamBoth(img, Math.max(1, Math.round(img.width * f)), Math.max(1, Math.round(img.height * f)))
}

/** Deterministic PRNG (mulberry32) so a material always synthesises the same texture. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pixErr(a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number) {
  const dr = a[i] - b[j], dg = a[i + 1] - b[j + 1], db = a[i + 2] - b[j + 2]
  return dr * dr + dg * dg + db * db
}

/**
 * Synthesises a larger tileable texture from a tileable swatch by image quilting
 * (Efros & Freeman 2001): blocks cut from random places of the swatch are laid with
 * overlaps that match, joined along minimum-error seams. A 300mm sample then covers a
 * 600mm repeat with no identical copies side by side. Output is factor·w × factor·h,
 * covering factor× the physical width and height.
 */
export function expandTexture(tile: RGBAImage, factor = 2, seed = 1): RGBAImage {
  const k = Math.max(1, Math.round(factor))
  if (k === 1) return { width: tile.width, height: tile.height, data: tile.data.slice() }
  const { width: tw, height: th, data: td } = tile
  const B = Math.max(8, Math.round(Math.min(tw, th) / 2)) // block size
  const O = Math.max(2, Math.round(B / 5)) // overlap
  const step = B - O
  const outW = k * tw
  const outH = k * th
  // Quilt a canvas O px larger, then make it tileable with a seam pass of width O.
  const qW = outW + O
  const qH = outH + O
  const nx = Math.ceil((qW - O) / step)
  const ny = Math.ceil((qH - O) / step)
  const cw = nx * step + O
  const ch = ny * step + O
  const q = new Uint8ClampedArray(cw * ch * 4)
  const rand = rng(seed)
  const texAt = (x: number, y: number) => ((((y % th) + th) % th) * tw + (((x % tw) + tw) % tw)) * 4

  const CANDIDATES = 24
  for (let by = 0; by < ny; by++) {
    for (let bx = 0; bx < nx; bx++) {
      const ox = bx * step
      const oy = by * step
      // Best of N random source positions by overlap error (any within 10% of the best).
      const errs: { sx: number; sy: number; e: number }[] = []
      for (let c = 0; c < (bx || by ? CANDIDATES : 1); c++) {
        const sx = Math.floor(rand() * tw)
        const sy = Math.floor(rand() * th)
        let e = 0
        if (bx) for (let y = 0; y < B; y += 2) for (let x = 0; x < O; x += 2) e += pixErr(q, ((oy + y) * cw + ox + x) * 4, td, texAt(sx + x, sy + y))
        if (by) for (let y = 0; y < O; y += 2) for (let x = 0; x < B; x += 2) e += pixErr(q, ((oy + y) * cw + ox + x) * 4, td, texAt(sx + x, sy + y))
        errs.push({ sx, sy, e })
      }
      const min = Math.min(...errs.map((x) => x.e))
      const ok = errs.filter((x) => x.e <= min * 1.1 + 1e-6)
      const pick = ok[Math.floor(rand() * ok.length)]
      // Minimum-error seams in the left and top overlaps decide which pixels the new block owns.
      let leftCut: Int32Array | null = null
      let topCut: Int32Array | null = null
      if (bx) {
        const cost = new Float32Array(O * B)
        for (let y = 0; y < B; y++) for (let x = 0; x < O; x++) cost[y * O + x] = pixErr(q, ((oy + y) * cw + ox + x) * 4, td, texAt(pick.sx + x, pick.sy + y))
        leftCut = minCutSeam(cost, O, B)
      }
      if (by) {
        const cost = new Float32Array(O * B) // transposed: row = x, column = y
        for (let x = 0; x < B; x++) for (let y = 0; y < O; y++) cost[x * O + y] = pixErr(q, ((oy + y) * cw + ox + x) * 4, td, texAt(pick.sx + x, pick.sy + y))
        topCut = minCutSeam(cost, O, B)
      }
      for (let y = 0; y < B; y++) {
        for (let x = 0; x < B; x++) {
          if (leftCut && x < O && x < leftCut[y]) continue
          if (topCut && y < O && y < topCut[x]) continue
          const o = ((oy + y) * cw + ox + x) * 4
          const s = texAt(pick.sx + x, pick.sy + y)
          q[o] = td[s]; q[o + 1] = td[s + 1]; q[o + 2] = td[s + 2]; q[o + 3] = 255
        }
      }
    }
  }
  const canvas = createImage(qW, qH)
  for (let y = 0; y < qH; y++) canvas.data.set(q.subarray(y * cw * 4, (y * cw + qW) * 4), y * qW * 4)
  return seamBoth(canvas, O, O)
}

export interface PrepareOptions {
  /** Corners of the sample region in the photo (TL, TR, BR, BL); null = whole photo. */
  corners: Quad | null
  /** Physical size of the region bounded by `corners` (mm). */
  widthMm: number
  heightMm: number
  delight: number
  seamless: number
  maxSide: number
  /** Mean sRGB of a neutral patch in the photo (white balance), if picked. */
  whiteBalance?: [number, number, number] | null
  seamlessMode?: 'blend' | 'cut'
  /** 2 = synthesise a texture twice as large per side (needs a seamless texture). */
  expand?: number
}

export interface PreparedMaterial {
  texture: RGBAImage
  /** Physical size covered by `texture` after seamless trimming and expansion (mm). */
  widthMm: number
  heightMm: number
}

/** Largest side of an expanded texture (keeps the engine's mip chain near 50MB). */
export const EXPANDED_MAX_SIDE = 3072

/** Full sample → texture pipeline: straighten, white-balance, de-light, make tileable, expand, size-limit. */
export function prepareMaterial(photo: RGBAImage, o: PrepareOptions): PreparedMaterial {
  const quad: Quad = o.corners ?? [
    { x: 0, y: 0 },
    { x: photo.width, y: 0 },
    { x: photo.width, y: photo.height },
    { x: 0, y: photo.height },
  ]
  // Expansion tiles blocks of the swatch, so it needs a seamless swatch.
  const expand = o.expand === 2 && o.seamless > 0 ? 2 : 1
  // Output resolution: preserve the photo's resolution along the quad's longer edges,
  // with pixel aspect matching the physical aspect so texels are square.
  const edge = (a: number, b: number) => Math.hypot(quad[a].x - quad[b].x, quad[a].y - quad[b].y)
  const pxW = Math.max(edge(0, 1), edge(3, 2))
  const pxH = Math.max(edge(0, 3), edge(1, 2))
  const density = Math.max(pxW / o.widthMm, pxH / o.heightMm) // px per mm
  let outW = Math.max(8, Math.round(o.widthMm * density))
  let outH = Math.max(8, Math.round(o.heightMm * density))
  const cap = Math.min(1, (o.maxSide * 1.25) / Math.max(outW, outH))
  outW = Math.max(8, Math.round(outW * cap))
  outH = Math.max(8, Math.round(outH * cap))

  let tex = rectify(photo, quad, outW, outH)
  if (o.whiteBalance) tex = whiteBalance(tex, o.whiteBalance)
  tex = flattenLighting(tex, o.delight)
  const { sx, sy } = seamlessScale(tex.width, tex.height, o.seamless)
  tex = o.seamlessMode === 'cut' ? makeSeamlessCut(tex, o.seamless) : makeSeamless(tex, o.seamless)
  // Expanded textures are capped so the result stays within EXPANDED_MAX_SIDE without a second resample.
  tex = limitSize(tex, expand > 1 ? Math.min(o.maxSide, EXPANDED_MAX_SIDE / expand) : o.maxSide)
  if (expand > 1) tex = expandTexture(tex, expand)
  return { texture: tex, widthMm: o.widthMm * sx * expand, heightMm: o.heightMm * sy * expand }
}
