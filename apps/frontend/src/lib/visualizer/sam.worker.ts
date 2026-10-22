/// <reference lib="webworker" />
// Segment Anything running in the browser via transformers.js. The image encoder runs
// once per image (or HD crop); each click/box prompt then only runs the light mask
// decoder (~50ms), so suggestions feel instant after the first analysis.

import { AutoProcessor, RawImage, SamModel, Tensor, env } from '@huggingface/transformers'

declare const self: DedicatedWorkerGlobalScope

export const SAM_MODELS = {
  /** SlimSAM-77 (pruned, ~14MB download). */
  fast: 'Xenova/slimsam-77-uniform',
  /** SAM ViT-B (~106MB download): noticeably tighter outlines on thin trims and handles. */
  accurate: 'Xenova/sam-vit-base',
} as const
export type SamModelKey = keyof typeof SAM_MODELS

export type SamRequest =
  | { type: 'embed'; id: number; key: string; model: SamModelKey; width: number; height: number; pixels: ArrayBuffer }
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
  /** All candidate masks (SAM's multimask output), logits concatenated, each width × height. */
  | { type: 'mask'; id: number; width: number; height: number; logits: ArrayBuffer; scores: number[] }
  | { type: 'error'; id: number; message: string }

env.allowLocalModels = false

/* eslint-disable @typescript-eslint/no-explicit-any */
const models = new Map<SamModelKey, Promise<{ model: any; processor: any }>>()
// Two embeddings: the full render and the most recent HD crop, so refining edges does
// not force the whole render to be analysed again for the next click.
const embeddings = new Map<string, { inputs: any; embeddings: any; width: number; height: number; model: SamModelKey }>()
const MAX_EMBEDDINGS = 2

function load(key: SamModelKey, id: number) {
  let p = models.get(key)
  if (!p) {
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
        self.postMessage({ type: 'progress', id, stage: 'download', progress: total ? loaded / total : null } satisfies SamResponse)
      }
    }
    p = Promise.all([
      SamModel.from_pretrained(SAM_MODELS[key], { dtype: 'q8', progress_callback }),
      AutoProcessor.from_pretrained(SAM_MODELS[key], { progress_callback }),
    ]).then(([model, processor]) => ({ model, processor }))
    p.catch(() => models.delete(key))
    models.set(key, p)
  }
  return p
}

self.onmessage = async (e: MessageEvent<SamRequest>) => {
  const msg = e.data
  try {
    if (msg.type === 'embed') {
      const hit = embeddings.get(msg.key)
      if (hit && hit.model === msg.model) {
        // refresh LRU order
        embeddings.delete(msg.key)
        embeddings.set(msg.key, hit)
        self.postMessage({ type: 'embedded', id: msg.id } satisfies SamResponse)
        return
      }
      const { model, processor } = await load(msg.model, msg.id)
      self.postMessage({ type: 'progress', id: msg.id, stage: 'analyse', progress: null } satisfies SamResponse)
      const image = new RawImage(new Uint8ClampedArray(msg.pixels), msg.width, msg.height, 4).rgb()
      const inputs = await processor(image)
      const emb = await model.get_image_embeddings(inputs)
      embeddings.set(msg.key, { inputs, embeddings: emb, width: msg.width, height: msg.height, model: msg.model })
      while (embeddings.size > MAX_EMBEDDINGS) embeddings.delete(embeddings.keys().next().value!)
      self.postMessage({ type: 'embedded', id: msg.id } satisfies SamResponse)
      return
    }

    const current = embeddings.get(msg.key)
    if (!current) throw new Error('Image has not been analysed yet')
    const { model, processor } = await load(current.model, msg.id)
    const { inputs } = current
    const [rh, rw] = inputs.reshaped_input_sizes[0] as [number, number]
    const sx = rw / current.width
    const sy = rh / current.height
    const prompts = [...msg.points]
    const feeds: Record<string, unknown> = { ...current.embeddings }
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
    const scores = Array.from(out.iou_scores.data as Float32Array)
    const m = masks[0] // [1, K, H, W]
    const [, K, H, W] = m.dims as number[]
    const logits = new Float32Array((m.data as Float32Array).subarray(0, K * H * W))
    self.postMessage({ type: 'mask', id: msg.id, width: W, height: H, logits: logits.buffer, scores: scores.slice(0, K) } satisfies SamResponse, [logits.buffer])
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies SamResponse)
  }
}
