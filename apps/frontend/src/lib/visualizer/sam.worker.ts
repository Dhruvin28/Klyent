/// <reference lib="webworker" />
// Segment Anything (SlimSAM, quantised) running in the browser via transformers.js.
// The image encoder runs once per render; each click/box prompt then only runs the
// light mask decoder (~50ms), so suggestions feel instant after the first analysis.

import { AutoProcessor, RawImage, SamModel, Tensor, env } from '@huggingface/transformers'

declare const self: DedicatedWorkerGlobalScope

export const SAM_MODEL_ID = 'Xenova/slimsam-77-uniform'

export type SamRequest =
  | { type: 'embed'; id: number; key: string; width: number; height: number; pixels: ArrayBuffer }
  | {
      type: 'decode'
      id: number
      key: string
      points: { x: number; y: number; label: 0 | 1 }[]
      box: [number, number, number, number] | null
    }

export type SamResponse =
  | { type: 'progress'; id: number; stage: 'download' | 'analyse'; progress: number | null }
  | { type: 'embedded'; id: number }
  | { type: 'mask'; id: number; width: number; height: number; logits: ArrayBuffer; score: number }
  | { type: 'error'; id: number; message: string }

env.allowLocalModels = false

/* eslint-disable @typescript-eslint/no-explicit-any */
let modelPromise: Promise<{ model: any; processor: any }> | null = null
let current: { key: string; inputs: any; embeddings: any; width: number; height: number } | null = null

function load(id: number) {
  if (!modelPromise) {
    const files = new Map<string, { loaded: number; total: number }>()
    const progress_callback = (p: any) => {
      if (p?.status === 'progress' && p.file) {
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        self.postMessage({ type: 'progress', id, stage: 'download', progress: total ? loaded / total : null } satisfies SamResponse)
      }
    }
    modelPromise = Promise.all([
      SamModel.from_pretrained(SAM_MODEL_ID, { dtype: 'q8', progress_callback }),
      AutoProcessor.from_pretrained(SAM_MODEL_ID, { progress_callback }),
    ]).then(([model, processor]) => ({ model, processor }))
    modelPromise.catch(() => {
      modelPromise = null
    })
  }
  return modelPromise
}

self.onmessage = async (e: MessageEvent<SamRequest>) => {
  const msg = e.data
  try {
    const { model, processor } = await load(msg.id)
    if (msg.type === 'embed') {
      if (current?.key === msg.key) {
        self.postMessage({ type: 'embedded', id: msg.id } satisfies SamResponse)
        return
      }
      self.postMessage({ type: 'progress', id: msg.id, stage: 'analyse', progress: null } satisfies SamResponse)
      const image = new RawImage(new Uint8ClampedArray(msg.pixels), msg.width, msg.height, 4).rgb()
      const inputs = await processor(image)
      const embeddings = await model.get_image_embeddings(inputs)
      current = { key: msg.key, inputs, embeddings, width: msg.width, height: msg.height }
      self.postMessage({ type: 'embedded', id: msg.id } satisfies SamResponse)
      return
    }

    if (!current || current.key !== msg.key) throw new Error('Image has not been analysed yet')
    const { inputs, embeddings } = current
    const [rh, rw] = inputs.reshaped_input_sizes[0] as [number, number]
    const sx = rw / current.width
    const sy = rh / current.height
    const prompts = [...msg.points]
    const feeds: Record<string, unknown> = { ...embeddings }
    if (msg.box) {
      const [x0, y0, x1, y1] = msg.box
      feeds.input_boxes = new Tensor('float32', Float32Array.from([x0 * sx, y0 * sy, x1 * sx, y1 * sy]), [1, 1, 4])
      // The exported decoder needs at least one real point alongside a box (a padding
      // point yields an empty mask), so seed the box centre when there are no clicks.
      if (!prompts.some((p) => p.label === 1)) prompts.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, label: 1 })
    }
    if (!prompts.length) throw new Error('Click the surface or drag a box around it')
    const pts = prompts.map((p) => [p.x * sx, p.y * sy])
    feeds.input_points = new Tensor('float32', Float32Array.from(pts.flat()), [1, 1, pts.length, 2])
    feeds.input_labels = new Tensor('int64', BigInt64Array.from(prompts.map((p) => BigInt(p.label))), [1, 1, prompts.length])

    const out = await model(feeds)
    const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes, { binarize: false })
    const scores = out.iou_scores.data as Float32Array
    let best = 0
    for (let k = 1; k < scores.length; k++) if (scores[k] > scores[best]) best = k
    const m = masks[0] // [1, 3, H, W]
    const [, , H, W] = m.dims as number[]
    const logits = new Float32Array((m.data as Float32Array).subarray(best * H * W, (best + 1) * H * W))
    self.postMessage({ type: 'mask', id: msg.id, width: W, height: H, logits: logits.buffer, score: scores[best] } satisfies SamResponse, [logits.buffer])
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies SamResponse)
  }
}
