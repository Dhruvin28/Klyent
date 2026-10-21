import type { SamRequest, SamResponse } from './sam.worker'
import { downscaleImage } from './resample'
import type { RGBAImage } from './types'

export interface SamProgress {
  stage: 'download' | 'analyse'
  progress: number | null
}

// Distributive Omit so each union member keeps its own fields.
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

type Pending = { resolve: (r: SamResponse) => void; reject: (e: Error) => void; onProgress?: (p: SamProgress) => void }

const SAM_INPUT_SIDE = 1024 // the encoder's native resolution

/**
 * AI surface suggestions (Segment Anything). Loaded lazily on first use: the model
 * (~15MB) is downloaded once from the Hugging Face hub and cached by the browser.
 */
export class SamClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private key: string | null = null
  private scale = 1
  private size = { width: 0, height: 0 }

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

  /** Runs the image encoder once for this render (no-op if already done). */
  async analyse(key: string, img: RGBAImage, onProgress?: (p: SamProgress) => void) {
    if (this.key === key) return
    const s = Math.min(1, SAM_INPUT_SIDE / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * s))
    const h = Math.max(1, Math.round(img.height * s))
    const small = s < 1 ? downscaleImage(img, w, h) : { width: img.width, height: img.height, data: img.data.slice() }
    await this.call({ type: 'embed', key, width: small.width, height: small.height, pixels: small.data.buffer as ArrayBuffer }, [small.data.buffer as ArrayBuffer], onProgress)
    this.key = key
    this.scale = small.width / img.width
    this.size = { width: small.width, height: small.height }
  }

  /**
   * Predicts a mask for click prompts (label 1 = include, 0 = exclude) and/or a box,
   * all in full-resolution image coordinates. Returns logits at the analysed size.
   */
  async predict(points: { x: number; y: number; label: 0 | 1 }[], box: [number, number, number, number] | null) {
    if (!this.key) throw new Error('Image has not been analysed yet')
    const k = this.scale
    const r = await this.call({
      type: 'decode',
      key: this.key,
      points: points.map((p) => ({ x: p.x * k, y: p.y * k, label: p.label })),
      box: box ? (box.map((v) => v * k) as [number, number, number, number]) : null,
    })
    if (r.type !== 'mask') throw new Error('Unexpected response')
    return { logits: new Float32Array(r.logits), width: r.width, height: r.height, score: r.score }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    for (const p of this.pending.values()) p.reject(new Error('Disposed'))
    this.pending.clear()
    this.key = null
  }
}
