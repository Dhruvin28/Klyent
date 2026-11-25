import type { BBox } from './types'

/**
 * Separate panels (e.g. wardrobe shutters split by gaps or protected trims) of one
 * surface, so a sheet material can start at a different place on each shutter or be
 * book-matched across neighbours — as it is fitted on site.
 */
export interface PanelMap {
  bbox: BBox
  /** bbox-sized; 0 = not part of the surface, 1..count = panel index. */
  labels: Int32Array
  count: number
  /** Centroid of each panel in image pixels (index = label − 1). */
  centroids: { x: number; y: number }[]
  /** Left-to-right rank of each panel (index = label − 1). */
  rank: number[]
}

/**
 * Labels the connected parts of a selection. `raw` (binarised at 128) defines the
 * panels; every other pixel with alpha > 0 (feathered or snapped edges) takes the
 * label of the nearest panel, so edges blend with the panel they belong to.
 */
export function labelPanels(raw: Uint8Array, alpha: Uint8Array, width: number, bbox: BBox): PanelMap {
  const bw = bbox.x1 - bbox.x0
  const bh = bbox.y1 - bbox.y0
  const n = bw * bh
  const labels = new Int32Array(n)
  const at = (k: number) => (Math.floor(k / bw) + bbox.y0) * width + (k % bw) + bbox.x0

  // 1. Connected components of the solid selection (4-connected).
  const queue = new Int32Array(n)
  const sizes: number[] = [0]
  let next = 1
  for (let k = 0; k < n; k++) {
    if (labels[k] || raw[at(k)] < 128) continue
    let head = 0
    let tail = 0
    queue[tail++] = k
    labels[k] = next
    while (head < tail) {
      const q = queue[head++]
      const x = q % bw
      const nb = [x > 0 ? q - 1 : -1, x < bw - 1 ? q + 1 : -1, q - bw, q + bw]
      for (const m of nb) {
        if (m < 0 || m >= n || labels[m] || raw[at(m)] < 128) continue
        labels[m] = next
        queue[tail++] = m
      }
    }
    sizes.push(tail)
    next++
  }

  // 2. Specks (stray brush dabs, noise) are not panels: clear them, they get absorbed below.
  let total = 0
  for (let i = 1; i < sizes.length; i++) total += sizes[i]
  const minArea = Math.max(64, total * 0.002)
  const remap = new Int32Array(sizes.length)
  let count = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] >= minArea) remap[i] = ++count
  if (count === 0 && sizes.length > 1) {
    // Only specks: treat the largest one as the single panel.
    let best = 1
    for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i
    remap[best] = count = 1
  }
  for (let k = 0; k < n; k++) labels[k] = remap[labels[k]]

  // 3. Grow labels into every remaining pixel the surface may touch (multi-source BFS).
  let head = 0
  let tail = 0
  for (let k = 0; k < n; k++) if (labels[k]) queue[tail++] = k
  while (head < tail) {
    const q = queue[head++]
    const x = q % bw
    const l = labels[q]
    const nb = [x > 0 ? q - 1 : -1, x < bw - 1 ? q + 1 : -1, q - bw, q + bw]
    for (const m of nb) {
      if (m < 0 || m >= n || labels[m] || !alpha[at(m)]) continue
      labels[m] = l
      queue[tail++] = m
    }
  }
  // Disconnected soft pixels (no path to a panel) join panel 1.
  if (count > 0) for (let k = 0; k < n; k++) if (!labels[k] && alpha[at(k)]) labels[k] = 1

  const sx = new Float64Array(count + 1)
  const sy = new Float64Array(count + 1)
  const sc = new Float64Array(count + 1)
  for (let k = 0; k < n; k++) {
    const l = labels[k]
    if (!l) continue
    sx[l] += (k % bw) + bbox.x0 + 0.5
    sy[l] += Math.floor(k / bw) + bbox.y0 + 0.5
    sc[l]++
  }
  const centroids = Array.from({ length: count }, (_, i) => ({ x: sx[i + 1] / (sc[i + 1] || 1), y: sy[i + 1] / (sc[i + 1] || 1) }))
  const order = centroids.map((c, i) => ({ c, i })).sort((a, b) => a.c.x - b.c.x || a.c.y - b.c.y)
  const rank = new Array<number>(count)
  order.forEach((o, r) => (rank[o.i] = r))
  return { bbox, labels, count, centroids, rank }
}

/** Deterministic hash of (seed, panel) → [0, 1). */
export function panelHash(seed: number, panel: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(panel | 0, 0x85ebca77)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
