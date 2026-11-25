/// <reference lib="webworker" />
// Semantic segmentation of the room (SegFormer-B2 trained on ADE20K, ~29MB, runs in
// the browser). Used to propose walls, floor, ceiling, wardrobes, cabinets, doors and
// countertops as ready-made surfaces.

import { AutoModelForSemanticSegmentation, AutoProcessor, RawImage, env } from '@huggingface/transformers'
import { closeMask, removeSmallIslands } from './mask'
import type { SurfaceType } from './types'

declare const self: DedicatedWorkerGlobalScope

export const SEG_MODEL_ID = 'Xenova/segformer-b2-finetuned-ade-512-512'

/** ADE20K classes worth proposing as surfaces, mapped to the visualizer's surface types. */
export const ROOM_CLASSES: Record<string, SurfaceType> = {
  wall: 'wall',
  floor: 'floor',
  ceiling: 'ceiling',
  wardrobe: 'wardrobe',
  cabinet: 'cabinet',
  'chest of drawers': 'cabinet',
  door: 'door',
  'screen door': 'door',
  countertop: 'countertop',
  counter: 'countertop',
  'kitchen island': 'countertop',
}

export type SegRequest = {
  type: 'segment'
  id: number
  /** Downscaled render fed to the model. */
  width: number
  height: number
  pixels: ArrayBuffer
  /** Size of the full render the masks are returned at. */
  outWidth: number
  outHeight: number
}

export interface Detection {
  type: SurfaceType
  label: string
  /** outWidth × outHeight, 0/255 */
  mask: ArrayBuffer
  area: number
}

export type SegResponse =
  | { type: 'progress'; id: number; stage: 'download' | 'analyse'; progress: number | null }
  | { type: 'segmented'; id: number; detections: Detection[] }
  | { type: 'error'; id: number; message: string }

env.allowLocalModels = false

/* eslint-disable @typescript-eslint/no-explicit-any */
let loading: Promise<{ model: any; processor: any }> | null = null

function load(id: number) {
  if (!loading) {
    const files = new Map<string, { loaded: number; total: number }>()
    const progress_callback = (ev: any) => {
      if (ev?.status === 'progress' && ev.file) {
        files.set(ev.file, { loaded: ev.loaded ?? 0, total: ev.total ?? 0 })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        self.postMessage({ type: 'progress', id, stage: 'download', progress: total ? loaded / total : null } satisfies SegResponse)
      }
    }
    loading = Promise.all([
      AutoModelForSemanticSegmentation.from_pretrained(SEG_MODEL_ID, { dtype: 'q8', progress_callback }),
      AutoProcessor.from_pretrained(SEG_MODEL_ID, { progress_callback }),
    ]).then(([model, processor]) => ({ model, processor }))
    loading.catch(() => (loading = null))
  }
  return loading
}

self.onmessage = async (e: MessageEvent<SegRequest>) => {
  const msg = e.data
  try {
    const { model, processor } = await load(msg.id)
    self.postMessage({ type: 'progress', id: msg.id, stage: 'analyse', progress: null } satisfies SegResponse)
    const image = new RawImage(new Uint8ClampedArray(msg.pixels), msg.width, msg.height, 4).rgb()
    const inputs = await processor(image)
    const { logits } = await model(inputs) // [1, C, h, w] at 1/4 of the processed size
    const [, C, h, w] = logits.dims as number[]
    const data = logits.data as Float32Array
    const plane = h * w
    const id2label = model.config.id2label as Record<string, string>
    // Arg-max class per logit cell.
    const cls = new Uint8Array(plane)
    for (let i = 0; i < plane; i++) {
      let best = 0
      let bestV = -Infinity
      for (let c = 0; c < C; c++) {
        const v = data[c * plane + i]
        if (v > bestV) {
          bestV = v
          best = c
        }
      }
      cls[i] = best
    }
    const W = msg.outWidth
    const H = msg.outHeight
    const total = W * H
    const detections: Detection[] = []
    const present = new Set(cls)
    for (const c of present) {
      const label = (id2label[String(c)] ?? '').trim()
      const type = ROOM_CLASSES[label]
      if (!type) continue
      // Bilinear upsample of the class indicator, thresholded at ½: smooth outlines at full size.
      let m: Uint8Array = new Uint8Array(total)
      for (let y = 0; y < H; y++) {
        const fy = Math.max(0, Math.min(h - 1, ((y + 0.5) * h) / H - 0.5))
        const y0 = Math.floor(fy)
        const y1 = Math.min(h - 1, y0 + 1)
        const ty = fy - y0
        for (let x = 0; x < W; x++) {
          const fx = Math.max(0, Math.min(w - 1, ((x + 0.5) * w) / W - 0.5))
          const x0 = Math.floor(fx)
          const x1 = Math.min(w - 1, x0 + 1)
          const tx = fx - x0
          const v =
            (cls[y0 * w + x0] === c ? (1 - tx) * (1 - ty) : 0) +
            (cls[y0 * w + x1] === c ? tx * (1 - ty) : 0) +
            (cls[y1 * w + x0] === c ? (1 - tx) * ty : 0) +
            (cls[y1 * w + x1] === c ? tx * ty : 0)
          if (v >= 0.5) m[y * W + x] = 255
        }
      }
      const minArea = Math.round(total * 0.004)
      m = removeSmallIslands(closeMask({ width: W, height: H, data: m }, 2), minArea).data
      // Separate parts (e.g. two walls either side of a wardrobe) become separate surfaces.
      for (const part of splitComponents(m, W, H, Math.round(total * 0.01))) {
        detections.push({ type, label, mask: part.mask.buffer as ArrayBuffer, area: part.area })
      }
    }
    detections.sort((a, b) => b.area - a.area)
    self.postMessage({ type: 'segmented', id: msg.id, detections } satisfies SegResponse, detections.map((d) => d.mask))
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies SegResponse)
  }
}

/** Connected parts of a binary mask with at least minArea pixels (4-connected). */
function splitComponents(m: Uint8Array, W: number, H: number, minArea: number): { mask: Uint8Array; area: number }[] {
  const label = new Int32Array(W * H)
  const queue = new Int32Array(W * H)
  const parts: { mask: Uint8Array; area: number }[] = []
  let next = 1
  for (let p = 0; p < W * H; p++) {
    if (!m[p] || label[p]) continue
    let head = 0
    let tail = 0
    queue[tail++] = p
    label[p] = next
    while (head < tail) {
      const q = queue[head++]
      const x = q % W
      const nb = [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]
      for (const n of nb) {
        if (n < 0 || n >= W * H || label[n] || !m[n]) continue
        label[n] = next
        queue[tail++] = n
      }
    }
    if (tail >= minArea) {
      const mask = new Uint8Array(W * H)
      for (let i = 0; i < tail; i++) mask[queue[i]] = 255
      parts.push({ mask, area: tail })
    }
    next++
  }
  return parts
}
