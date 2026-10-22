/// <reference lib="webworker" />
// Runs the visualizer engine off the main thread. Keeps a full-resolution engine
// (exact, used for the final preview and export) and, for large renders, a reduced
// "preview" engine so slider drags get feedback in a fraction of the time.

import { VisualizerEngine, type MeasureSurface, type RenderSpec, type SurfaceMeasurement } from './engine'
import { downscaleImage, downscaleMask } from './resample'
import type { Quad, RGBAImage, VerificationReport } from './types'
import type { SmartSelectOptions } from './mask'

declare const self: DedicatedWorkerGlobalScope

export type EngineRequest =
  | { type: 'init'; id: number; width: number; height: number; pixels: ArrayBuffer }
  | { type: 'setMask'; id: number; key: string; version: number; data: ArrayBuffer | null }
  | { type: 'setTexture'; id: number; materialId: string; version: string; width: number; height: number; pixels: ArrayBuffer }
  | { type: 'prune'; id: number; surfaceIds: string[]; materialIds: string[] }
  | { type: 'render'; id: number; spec: RenderSpec; preview: boolean }
  | { type: 'export'; id: number; spec: RenderSpec }
  | { type: 'smartSelect'; id: number; seed: { x: number; y: number }; opts: SmartSelectOptions }
  | { type: 'encodeMask'; id: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'decodeMask'; id: number; blob: Blob; width: number; height: number }
  | { type: 'measure'; id: number; surfaces: MeasureSurface[] }
  | { type: 'fitQuad'; id: number; key: string }
  | { type: 'snapEdges'; id: number; data: ArrayBuffer }

export type EngineResponse =
  | { type: 'ok'; id: number }
  | { type: 'error'; id: number; message: string }
  | {
      type: 'frame'
      id: number
      quality: 'preview' | 'full'
      width: number
      height: number
      pixels: ArrayBuffer
      report: VerificationReport | null
      skipped: { id: string; reason: string }[]
      ms: number
    }
  | { type: 'exported'; id: number; image: Blob; mask: Blob; report: VerificationReport; skipped: { id: string; reason: string }[] }
  | { type: 'mask'; id: number; data: ArrayBuffer }
  | { type: 'png'; id: number; blob: Blob }
  | { type: 'measured'; id: number; surfaces: SurfaceMeasurement[] }
  | { type: 'quad'; id: number; quad: Quad | null }

const PREVIEW_MAX_PIXELS = 2_000_000

let full: VisualizerEngine | null = null
let preview: VisualizerEngine | null = null
let pScale = 1

function post(msg: EngineResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer)
}

function scaledSpec(spec: RenderSpec, k: number): RenderSpec {
  return {
    ...spec,
    surfaces: spec.surfaces.map((s) => ({
      ...s,
      quad: s.quad ? (s.quad.map(([x, y]) => [x * k, y * k]) as typeof s.quad) : null,
      feather: s.feather * k,
    })),
  }
}

async function toPng(width: number, height: number, rgba: Uint8ClampedArray<ArrayBuffer>): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

function maskToRgba(mask: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(mask.length * 4)
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    rgba[i] = rgba[i + 1] = rgba[i + 2] = mask[p]
    rgba[i + 3] = 255
  }
  return rgba
}

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'init': {
        const original: RGBAImage = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.pixels) }
        full = new VisualizerEngine(original)
        preview = null
        pScale = 1
        const px = msg.width * msg.height
        if (px > PREVIEW_MAX_PIXELS * 1.25) {
          pScale = Math.sqrt(PREVIEW_MAX_PIXELS / px)
          const pw = Math.max(1, Math.round(msg.width * pScale))
          const ph = Math.max(1, Math.round(msg.height * pScale))
          pScale = pw / msg.width
          preview = new VisualizerEngine(downscaleImage(original, pw, ph))
        }
        post({ type: 'ok', id: msg.id })
        break
      }
      case 'setMask': {
        if (!full) throw new Error('Engine not initialised')
        const data = msg.data ? new Uint8Array(msg.data) : null
        full.setMask(msg.key, msg.version, data)
        if (preview) {
          preview.setMask(msg.key, msg.version, data ? downscaleMask(data, full.width, full.height, preview.width, preview.height) : null)
        }
        post({ type: 'ok', id: msg.id })
        break
      }
      case 'setTexture': {
        if (!full) throw new Error('Engine not initialised')
        const levels = full.setTexture(msg.materialId, msg.version, {
          width: msg.width,
          height: msg.height,
          data: new Uint8ClampedArray(msg.pixels),
        })
        preview?.setTextureLevels(msg.materialId, msg.version, levels)
        post({ type: 'ok', id: msg.id })
        break
      }
      case 'prune': {
        full?.prune(msg.surfaceIds)
        preview?.prune(msg.surfaceIds)
        full?.pruneTextures(msg.materialIds)
        preview?.pruneTextures(msg.materialIds)
        post({ type: 'ok', id: msg.id })
        break
      }
      case 'render': {
        if (!full) throw new Error('Engine not initialised')
        const engine = msg.preview && preview ? preview : full
        const out = engine.render(engine === preview ? scaledSpec(msg.spec, pScale) : msg.spec)
        post(
          {
            type: 'frame',
            id: msg.id,
            quality: engine === preview ? 'preview' : 'full',
            width: engine.width,
            height: engine.height,
            pixels: out.result.buffer as ArrayBuffer,
            report: engine === full ? out.report : null,
            skipped: out.skipped,
            ms: out.ms,
          },
          [out.result.buffer as ArrayBuffer]
        )
        break
      }
      case 'export': {
        if (!full) throw new Error('Engine not initialised')
        const out = full.render(msg.spec)
        if (!out.report.ok) throw new Error(`Verification failed: ${out.report.changedOutsideMask} pixels outside the mask changed`)
        const image = await toPng(full.width, full.height, out.result)
        const mask = await toPng(full.width, full.height, maskToRgba(out.editMask))
        post({ type: 'exported', id: msg.id, image, mask, report: out.report, skipped: out.skipped })
        break
      }
      case 'smartSelect': {
        if (!full) throw new Error('Engine not initialised')
        const m = full.smartSelect(msg.seed, msg.opts)
        post({ type: 'mask', id: msg.id, data: m.data.buffer as ArrayBuffer }, [m.data.buffer as ArrayBuffer])
        break
      }
      case 'measure': {
        if (!full) throw new Error('Engine not initialised')
        post({ type: 'measured', id: msg.id, surfaces: full.measure(msg.surfaces) })
        break
      }
      case 'fitQuad': {
        if (!full) throw new Error('Engine not initialised')
        post({ type: 'quad', id: msg.id, quad: full.fitQuad(msg.key) })
        break
      }
      case 'snapEdges': {
        if (!full) throw new Error('Engine not initialised')
        const m = full.snapToEdges(new Uint8Array(msg.data))
        post({ type: 'mask', id: msg.id, data: m.buffer as ArrayBuffer }, [m.buffer as ArrayBuffer])
        break
      }
      case 'encodeMask': {
        const blob = await toPng(msg.width, msg.height, maskToRgba(new Uint8Array(msg.data)))
        post({ type: 'png', id: msg.id, blob })
        break
      }
      case 'decodeMask': {
        const bmp = await createImageBitmap(msg.blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
        if (bmp.width !== msg.width || bmp.height !== msg.height) throw new Error('Saved mask does not match the render size')
        const canvas = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(bmp, 0, 0)
        bmp.close()
        const rgba = ctx.getImageData(0, 0, msg.width, msg.height).data
        const m = new Uint8Array(msg.width * msg.height)
        for (let p = 0; p < m.length; p++) m[p] = rgba[p * 4]
        post({ type: 'mask', id: msg.id, data: m.buffer }, [m.buffer])
        break
      }
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}
