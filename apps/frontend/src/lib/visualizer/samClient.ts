import type { SamModelKey, SamRequest, SamResponse } from './sam.worker'
import { downscaleImage, upscaleLogitsToMask } from './resample'
import type { RGBAImage } from './types'

export type { SamModelKey }

export interface SamProgress {
  stage: 'download' | 'analyse'
  progress: number | null
}

/** One suggested selection, at full render resolution. */
export interface SamCandidate {
  mask: Uint8Array
  score: number
  /** Selected pixels (for ordering candidates small → large). */
  area: number
}

// Distributive Omit so each union member keeps its own fields.
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

type Pending = { resolve: (r: SamResponse) => void; reject: (e: Error) => void; onProgress?: (p: SamProgress) => void }

const SAM_INPUT_SIDE = 1024 // the encoder's native resolution

export interface CropRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * AI surface suggestions (Segment Anything). Loaded lazily on first use: the model is
 * downloaded once from the Hugging Face hub and cached by the browser.
 */
export class SamClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private key: string | null = null
  private scale = 1
  private model: SamModelKey = 'fast'

  private ensureWorker() {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./sam.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<SamResponse>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      if (e.data.type === 'progress') {
        p.onProgress?.({ stage: e.data.stage, progress: e.data.progress })
        return
      }
      this.pending.delete(e.data.id)
      if (e.data.type === 'error') p.reject(new Error(e.data.message))
      else p.resolve(e.data)
    }
    w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'AI selection failed to load'))
      this.pending.clear()
      this.worker?.terminate()
      this.worker = null
      this.key = null
    }
    this.worker = w
    return w
  }

  private call(msg: WithoutId<SamRequest>, transfer: Transferable[] = [], onProgress?: (p: SamProgress) => void) {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise<SamResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
      worker.postMessage({ ...msg, id } as SamRequest, transfer)
    })
  }

  get readyFor() {
    return this.key
  }

  private async embed(key: string, img: RGBAImage, model: SamModelKey, onProgress?: (p: SamProgress) => void) {
    const s = Math.min(1, SAM_INPUT_SIDE / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * s))
    const h = Math.max(1, Math.round(img.height * s))
    const small = s < 1 ? downscaleImage(img, w, h) : { width: img.width, height: img.height, data: img.data.slice() }
    await this.call(
      { type: 'embed', key, model, width: small.width, height: small.height, pixels: small.data.buffer as ArrayBuffer },
      [small.data.buffer as ArrayBuffer],
      onProgress
    )
    return small.width / img.width
  }

  /** Runs the image encoder once for this render and model (no-op if already done). */
  async analyse(key: string, img: RGBAImage, model: SamModelKey, onProgress?: (p: SamProgress) => void) {
    const k = `${key}|${model}`
    if (this.key === k) return
    // The worker keeps recent embeddings, so switching back is cheap.
    this.scale = await this.embed(k, img, model, onProgress)
    this.key = k
    this.model = model
  }

  private toCandidates(r: SamResponse, outW: number, outH: number): SamCandidate[] {
    if (r.type !== 'mask') throw new Error('Unexpected response')
    const all = new Float32Array(r.logits)
    const size = r.width * r.height
    return r.scores.map((score, k) => {
      const mask = upscaleLogitsToMask(all.subarray(k * size, (k + 1) * size), r.width, r.height, outW, outH)
      let area = 0
      for (let i = 0; i < mask.length; i++) if (mask[i]) area++
      return { mask, score, area }
    })
  }

  /**
   * Predicts SAM's candidate masks (typically part / object / whole group) for click
   * prompts (label 1 = include, 0 = exclude) and/or a box, in full-resolution image
   * coordinates. Masks are returned at full resolution, ordered small → large.
   */
  async predict(points: { x: number; y: number; label: 0 | 1 }[], box: [number, number, number, number] | null, outW: number, outH: number) {
    if (!this.key) throw new Error('Image has not been analysed yet')
    const k = this.scale
    const r = await this.call({
      type: 'decode',
      key: this.key,
      points: points.map((p) => ({ x: p.x * k, y: p.y * k, label: p.label })),
      box: box ? (box.map((v) => v * k) as [number, number, number, number]) : null,
    })
    return this.toCandidates(r, outW, outH)
      .filter((c) => c.area > 0)
      .sort((a, b) => a.area - b.area)
  }

  /**
   * HD pass: analyses only the region around a suggestion at the encoder's full
   * resolution (a 4K render is otherwise seen at 1024px, so outlines can be 3–4px off)
   * and predicts again there. Returns full-resolution candidates (zero outside the crop).
   */
  async predictCrop(
    img: RGBAImage,
    crop: CropRect,
    points: { x: number; y: number; label: 0 | 1 }[],
    box: [number, number, number, number] | null,
    onProgress?: (p: SamProgress) => void
  ): Promise<SamCandidate[]> {
    const cw = crop.x1 - crop.x0
    const ch = crop.y1 - crop.y0
    const sub: RGBAImage = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }
    for (let y = 0; y < ch; y++) sub.data.set(img.data.subarray(((y + crop.y0) * img.width + crop.x0) * 4, ((y + crop.y0) * img.width + crop.x1) * 4), y * cw * 4)
    const key = `crop|${this.model}|${crop.x0},${crop.y0},${crop.x1},${crop.y1}`
    const k = await this.embed(key, sub, this.model, onProgress)
    const inside = points.filter((p) => p.x >= crop.x0 && p.x < crop.x1 && p.y >= crop.y0 && p.y < crop.y1)
    const cbox: [number, number, number, number] | null = box
      ? [Math.max(box[0], crop.x0) - crop.x0, Math.max(box[1], crop.y0) - crop.y0, Math.min(box[2], crop.x1) - crop.x0, Math.min(box[3], crop.y1) - crop.y0]
      : null
    const r = await this.call({
      type: 'decode',
      key,
      points: inside.map((p) => ({ x: (p.x - crop.x0) * k, y: (p.y - crop.y0) * k, label: p.label })),
      box: cbox ? (cbox.map((v) => v * k) as [number, number, number, number]) : null,
    })
    return this.toCandidates(r, cw, ch)
      .map((c) => {
        const mask = new Uint8Array(img.width * img.height)
        for (let y = 0; y < ch; y++) mask.set(c.mask.subarray(y * cw, (y + 1) * cw), (y + crop.y0) * img.width + crop.x0)
        return { ...c, mask }
      })
      .filter((c) => c.area > 0)
      .sort((a, b) => a.area - b.area)
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    for (const p of this.pending.values()) p.reject(new Error('Disposed'))
    this.pending.clear()
    this.key = null
  }
}
