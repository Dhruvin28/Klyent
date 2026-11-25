import type { EngineRequest, EngineResponse } from './engine.worker'
import type { MeasureSurface, RenderSpec, SurfaceMeasurement } from './engine'
import type { SmartSelectOptions } from './mask'
import type { Quad, RGBAImage, VerificationReport } from './types'

type Pending = { resolve: (r: EngineResponse) => void; reject: (e: Error) => void }

// Distributive Omit so each union member keeps its own fields.
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

export interface Frame {
  quality: 'preview' | 'full'
  width: number
  height: number
  pixels: Uint8ClampedArray<ArrayBuffer>
  report: VerificationReport | null
  skipped: { id: string; reason: string }[]
  ms: number
}

/** Promise-based wrapper around the engine Web Worker. */
export class EngineClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, Pending>()
  private disposed = false

  constructor() {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.type === 'error') p.reject(new Error(e.data.message))
      else p.resolve(e.data)
    }
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Visualizer engine crashed')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    }
  }

  private call(msg: WithoutId<EngineRequest>, transfer: Transferable[] = []): Promise<EngineResponse> {
    if (this.disposed) return Promise.reject(new Error('Engine disposed'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...msg, id } as EngineRequest, transfer)
    })
  }

  async init(img: RGBAImage) {
    const copy = img.data.slice()
    await this.call({ type: 'init', width: img.width, height: img.height, pixels: copy.buffer }, [copy.buffer])
  }

  async setMask(key: string, version: number, data: Uint8Array | null) {
    const copy = data ? data.slice() : null
    await this.call({ type: 'setMask', key, version, data: copy ? copy.buffer : null }, copy ? [copy.buffer] : [])
  }

  async setTexture(materialId: string, version: string, img: RGBAImage) {
    const copy = img.data.slice()
    await this.call({ type: 'setTexture', materialId, version, width: img.width, height: img.height, pixels: copy.buffer }, [copy.buffer])
  }

  async prune(surfaceIds: string[], materialIds: string[]) {
    await this.call({ type: 'prune', surfaceIds, materialIds })
  }

  async render(spec: RenderSpec, preview: boolean): Promise<Frame> {
    const r = await this.call({ type: 'render', spec, preview })
    if (r.type !== 'frame') throw new Error('Unexpected engine response')
    return { quality: r.quality, width: r.width, height: r.height, pixels: new Uint8ClampedArray(r.pixels), report: r.report, skipped: r.skipped, ms: r.ms }
  }

  async exportPng(spec: RenderSpec) {
    const r = await this.call({ type: 'export', spec })
    if (r.type !== 'exported') throw new Error('Unexpected engine response')
    return r
  }

  async smartSelect(seed: { x: number; y: number }, opts: SmartSelectOptions): Promise<Uint8Array> {
    const r = await this.call({ type: 'smartSelect', seed, opts })
    if (r.type !== 'mask') throw new Error('Unexpected engine response')
    return new Uint8Array(r.data)
  }

  async measure(surfaces: MeasureSurface[]): Promise<SurfaceMeasurement[]> {
    const r = await this.call({ type: 'measure', surfaces })
    if (r.type !== 'measured') throw new Error('Unexpected engine response')
    return r.surfaces
  }

  /** Fits the perspective corners to a surface's selection (null when it is not four-sided). */
  async fitQuad(key: string): Promise<Quad | null> {
    const r = await this.call({ type: 'fitQuad', key })
    if (r.type !== 'quad') throw new Error('Unexpected engine response')
    return r.quad
  }

  async snapEdges(data: Uint8Array): Promise<Uint8Array> {
    const copy = data.slice()
    const r = await this.call({ type: 'snapEdges', data: copy.buffer }, [copy.buffer])
    if (r.type !== 'mask') throw new Error('Unexpected engine response')
    return new Uint8Array(r.data)
  }

  async encodeMask(width: number, height: number, data: Uint8Array): Promise<Blob> {
    const copy = data.slice()
    const r = await this.call({ type: 'encodeMask', width, height, data: copy.buffer }, [copy.buffer])
    if (r.type !== 'png') throw new Error('Unexpected engine response')
    return r.blob
  }

  async decodeMask(blob: Blob, width: number, height: number): Promise<Uint8Array> {
    const r = await this.call({ type: 'decodeMask', blob, width, height })
    if (r.type !== 'mask') throw new Error('Unexpected engine response')
    return new Uint8Array(r.data)
  }

  dispose() {
    this.disposed = true
    this.worker.terminate()
    for (const p of this.pending.values()) p.reject(new Error('Engine disposed'))
    this.pending.clear()
  }
}
