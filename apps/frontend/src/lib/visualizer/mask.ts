import { srgbToLab } from './color'
import { morphU8 } from './filters'
import type { BBox, Mask, Point, RGBAImage } from './types'

export type MaskOp = 'add' | 'subtract'

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) }
}

export function cloneMask(m: Mask): Mask {
  return { width: m.width, height: m.height, data: m.data.slice() }
}

export function maskBBox(m: Mask): BBox | null {
  const { width: w, height: h, data } = m
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let first = -1
    let last = -1
    for (let x = 0; x < w; x++) {
      if (data[row + x]) {
        if (first < 0) first = x
        last = x
      }
    }
    if (first >= 0) {
      if (first < x0) x0 = first
      if (last > x1) x1 = last
      if (y < y0) y0 = y
      y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

export function maskArea(m: Mask): number {
  let n = 0
  for (let i = 0; i < m.data.length; i++) n += m.data[i]
  return n / 255
}

export function isMaskEmpty(m: Mask): boolean {
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) return false
  return true
}

/** Combine a coverage value into a mask pixel. Additive so polygons sharing an edge leave no seam. */
function combine(dst: Uint8Array, i: number, cov: number, op: MaskOp) {
  if (cov <= 0) return
  if (op === 'add') {
    const v = dst[i] + cov
    dst[i] = v > 255 ? 255 : v
  } else {
    const v = dst[i] - cov
    dst[i] = v < 0 ? 0 : v
  }
}

/**
 * Rasterises a polygon into the mask with anti-aliased edges: 5 sub-scanlines per
 * row, exact horizontal span coverage. Even–odd fill rule.
 */
export function fillPolygon(mask: Mask, pts: Point[], op: MaskOp): void {
  if (pts.length < 3) return
  const { width: w, height: h, data } = mask
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
  for (const p of pts) {
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
  }
  const y0 = Math.max(0, Math.floor(minY))
  const y1 = Math.min(h - 1, Math.ceil(maxY))
  const bx0 = Math.max(0, Math.floor(minX))
  const bx1 = Math.min(w, Math.ceil(maxX) + 1)
  if (y0 > y1 || bx0 >= bx1) return
  const SUB = 5
  const acc = new Float32Array(bx1 - bx0)
  const xs: number[] = []
  const n = pts.length
  for (let y = y0; y <= y1; y++) {
    acc.fill(0)
    let any = false
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB
      xs.length = 0
      for (let i = 0; i < n; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % n]
        if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) {
          xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x))
        }
      }
      if (xs.length < 2) continue
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(xs[k], bx0)
        const xb = Math.min(xs[k + 1], bx1)
        if (xb <= xa) continue
        any = true
        const ia = Math.floor(xa)
        const ib = Math.min(bx1 - 1, Math.ceil(xb) - 1)
        for (let px = ia; px <= ib; px++) {
          const cov = Math.min(xb, px + 1) - Math.max(xa, px)
          if (cov > 0) acc[px - bx0] += cov / SUB
        }
      }
    }
    if (!any) continue
    const row = y * w
    for (let px = bx0; px < bx1; px++) {
      const c = acc[px - bx0]
      if (c > 0) combine(data, row + px, Math.round(Math.min(1, c) * 255), op)
    }
  }
}

/**
 * Paints a soft round brush along the segment a→b. `hardness` (0..1) is the fraction
 * of the radius at full strength; edges are anti-aliased. Max/min combine so a
 * stroke never accumulates over itself.
 */
export function brushStroke(mask: Mask, a: Point, b: Point, radius: number, hardness: number, op: MaskOp): void {
  const { width: w, height: h, data } = mask
  const r = Math.max(0.5, radius)
  const inner = Math.max(0, Math.min(1, hardness)) * r
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r - 1))
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r + 1))
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r - 1))
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r + 1))
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5
      // distance from pixel centre to the segment
      let t = len2 > 0 ? ((cx - a.x) * dx + (cy - a.y) * dy) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const ex = cx - (a.x + t * dx)
      const ey = cy - (a.y + t * dy)
      const d = Math.sqrt(ex * ex + ey * ey)
      if (d >= r + 0.5) continue
      let v: number
      if (d <= inner) v = 1
      else if (r - inner < 1) v = Math.min(1, r + 0.5 - d) // hard brush: 1px AA edge
      else v = Math.max(0, Math.min(1, (r - d) / (r - inner)))
      const cov = Math.round(v * 255)
      const i = y * w + x
      if (op === 'add') {
        if (cov > data[i]) data[i] = cov
      } else if (255 - cov < data[i]) data[i] = 255 - cov
    }
  }
}

export interface SmartSelectOptions {
  /** Max colour distance (ΔE-like) from the seed colour. */
  tolerance: number
  /** Only grow through connected pixels (true) or select every matching pixel (false). */
  contiguous: boolean
  /**
   * Weight of lightness differences relative to chroma (0..1). Lower values let the
   * selection run across shading gradients on a single-colour surface.
   */
  lightnessWeight: number
}

/**
 * Colour-similarity region growing ("smart select") from a seed point, in CIELAB.
 * Scanline flood fill: memory O(stack), not O(pixels).
 */
export function smartSelect(img: RGBAImage, seed: Point, opts: SmartSelectOptions): Mask {
  const { width: w, height: h, data } = img
  const out = createMask(w, h)
  const sx = Math.floor(seed.x)
  const sy = Math.floor(seed.y)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out

  // Seed colour: mean Lab over a 5×5 window (robust to grain/noise).
  const lab = new Float32Array(3)
  let L = 0, A = 0, B = 0, cnt = 0
  for (let y = Math.max(0, sy - 2); y <= Math.min(h - 1, sy + 2); y++) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(w - 1, sx + 2); x++) {
      const i = (y * w + x) * 4
      srgbToLab(data[i], data[i + 1], data[i + 2], lab)
      L += lab[0]; A += lab[1]; B += lab[2]; cnt++
    }
  }
  L /= cnt; A /= cnt; B /= cnt
  const wl = Math.max(0, Math.min(1, opts.lightnessWeight))
  const tol2 = opts.tolerance * opts.tolerance
  const accept = (p: number) => {
    const i = p * 4
    srgbToLab(data[i], data[i + 1], data[i + 2], lab)
    const dl = (lab[0] - L) * wl
    const da = lab[1] - A
    const db = lab[2] - B
    return dl * dl + da * da + db * db <= tol2
  }

  const m = out.data
  if (!opts.contiguous) {
    for (let p = 0; p < w * h; p++) if (accept(p)) m[p] = 255
    return out
  }

  // test() caches rejections; accepted pixels are only marked once their span is filled,
  // and the m[] check drops seeds that an earlier span already covered.
  const rejected = new Uint8Array(w * h)
  const test = (p: number) => {
    if (m[p] || rejected[p]) return false
    if (accept(p)) return true
    rejected[p] = 1
    return false
  }
  const stack: number[] = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    const row = y * w
    if (!test(row + x)) continue
    let xl = x
    while (xl > 0 && test(row + xl - 1)) xl--
    let xr = x
    while (xr < w - 1 && test(row + xr + 1)) xr++
    for (let i = xl; i <= xr; i++) m[row + i] = 255
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue
      const nrow = ny * w
      let inSpan = false
      for (let i = xl; i <= xr; i++) {
        const ok = test(nrow + i)
        if (ok && !inSpan) {
          stack.push(i, ny)
          inSpan = true
        } else if (!ok) inSpan = false
      }
    }
  }
  return out
}

/** Morphological closing (fills pin-holes and thin cracks up to 2r px). */
export function closeMask(m: Mask, r: number): Mask {
  if (r < 1) return cloneMask(m)
  const d = morphU8(m.data, m.width, m.height, r, 'max')
  return { width: m.width, height: m.height, data: morphU8(d, m.width, m.height, r, 'min') }
}

export function growMask(m: Mask, r: number): Mask {
  const op = r >= 0 ? 'max' : 'min'
  return { width: m.width, height: m.height, data: morphU8(m.data, m.width, m.height, Math.abs(Math.round(r)), op) }
}

/** Removes connected islands smaller than minArea px (binarised at 128). */
export function removeSmallIslands(m: Mask, minArea: number): Mask {
  const { width: w, height: h, data } = m
  const out = cloneMask(m)
  const label = new Int32Array(w * h)
  let next = 1
  const queue: number[] = []
  for (let p = 0; p < w * h; p++) {
    if (data[p] < 128 || label[p]) continue
    queue.length = 0
    queue.push(p)
    label[p] = next
    let head = 0
    while (head < queue.length) {
      const q = queue[head++]
      const x = q % w
      const nbrs = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]
      for (const n of nbrs) {
        if (n < 0 || n >= w * h || label[n] || data[n] < 128) continue
        label[n] = next
        queue.push(n)
      }
    }
    if (queue.length < minArea) for (const q of queue) out.data[q] = 0
    next++
  }
  return out
}

export function applyMask(target: Mask, src: Mask, op: MaskOp | 'replace'): void {
  const t = target.data
  const s = src.data
  if (op === 'replace') t.set(s)
  else if (op === 'add') for (let i = 0; i < t.length; i++) t[i] = Math.max(t[i], s[i])
  else for (let i = 0; i < t.length; i++) t[i] = Math.min(t[i], 255 - s[i])
}

/** Effective edit alpha = edit × (1 − protect), both 0..255. */
export function subtractProtect(edit: Uint8Array, protect: Uint8Array | null): Uint8Array {
  if (!protect) return edit
  const out = new Uint8Array(edit.length)
  for (let i = 0; i < edit.length; i++) {
    const e = edit[i]
    if (!e) continue
    const p = protect[i]
    out[i] = p === 0 ? e : p === 255 ? 0 : Math.round((e * (255 - p)) / 255)
  }
  return out
}
