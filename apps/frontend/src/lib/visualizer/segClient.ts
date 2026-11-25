import type { SegRequest, SegResponse } from './seg.worker'
import { downscaleImage } from './resample'
import type { RGBAImage, SurfaceType } from './types'

export interface RoomDetection {
  type: SurfaceType
  label: string
  /** Full render size, 0/255. */
  mask: Uint8Array
  area: number
}

// The model works at 512px; 1024px keeps thin trims while bounding the work.
const SEG_INPUT_SIDE = 1024

/** Room surface detection (walls, floor, ceiling, wardrobes…) in a worker, loaded on first use. */
export class SegClient {
  private worker: Worker | null = null
  private nextId = 1

  async detect(img: RGBAImage, onProgress?: (p: { stage: 'download' | 'analyse'; progress: number | null }) => void): Promise<RoomDetection[]> {
    if (!this.worker) this.worker = new Worker(new URL('./seg.worker.ts', import.meta.url), { type: 'module' })
    const worker = this.worker
    const s = Math.min(1, SEG_INPUT_SIDE / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * s))
    const h = Math.max(1, Math.round(img.height * s))
    const small = s < 1 ? downscaleImage(img, w, h) : { width: img.width, height: img.height, data: img.data.slice() }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<SegResponse>) => {
        if (e.data.id !== id) return
        if (e.data.type === 'progress') return onProgress?.({ stage: e.data.stage, progress: e.data.progress })
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        if (e.data.type === 'error') reject(new Error(e.data.message))
        else resolve(e.data.detections.map((d) => ({ type: d.type, label: d.label, mask: new Uint8Array(d.mask), area: d.area })))
      }
      const onError = (e: ErrorEvent) => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        this.dispose()
        reject(new Error(e.message || 'Room detection failed to load'))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      const msg: SegRequest = { type: 'segment', id, width: small.width, height: small.height, pixels: small.data.buffer as ArrayBuffer, outWidth: img.width, outHeight: img.height }
      worker.postMessage(msg, [msg.pixels])
    })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
  }
}
