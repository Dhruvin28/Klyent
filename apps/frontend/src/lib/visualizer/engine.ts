import { featherU8 } from './filters'
import { invert3, planeToImage, quadFromTuples } from './homography'
import { maskBBox, smartSelect, subtractProtect, type SmartSelectOptions } from './mask'
import { buildMipmaps } from './material'
import { renderSurface, verifyComposite, type RenderMaterial } from './render'
import { estimateShading, type ShadingField } from './shading'
import type { BBox, Mask, Point, Quad, RGBAImage, VerificationReport, VizAssignment, VizSurface } from './types'

export type SpecMaterial =
  | { kind: 'paint'; colorHex: string }
  | { kind: 'texture'; materialId: string; widthMm: number; heightMm: number }

export interface SpecSurface {
  id: string
  quad: VizSurface['quad']
  widthMm: number
  heightMm: number
  feather: number
  assignment: VizAssignment
  material: SpecMaterial
}

export interface RenderSpec {
  surfaces: SpecSurface[]
}

export interface RenderOutput {
  result: Uint8ClampedArray<ArrayBuffer>
  /** 255 wherever any surface was allowed to modify the pixel, else 0. */
  editMask: Uint8Array
  report: VerificationReport
  skipped: { id: string; reason: string }[]
  ms: number
}

export const PROTECT_KEY = '__protect__'

/**
 * Holds the reference render plus per-surface caches. Runs inside a Web Worker in the
 * app, and directly in unit tests.
 */
export class VisualizerEngine {
  private masks = new Map<string, { version: number; data: Uint8Array }>()
  private textures = new Map<string, { version: string; levels: RGBAImage[] }>()
  private alphaCache = new Map<string, { key: string; alpha: Uint8Array; bbox: BBox | null }>()
  private shadingCache = new Map<string, { key: string; field: ShadingField }>()

  constructor(readonly original: RGBAImage) {}

  get width() {
    return this.original.width
  }
  get height() {
    return this.original.height
  }

  setMask(key: string, version: number, data: Uint8Array | null): void {
    if (!data) {
      this.masks.delete(key)
      return
    }
    if (data.length !== this.width * this.height) throw new Error('Mask size does not match the render')
    this.masks.set(key, { version, data })
  }

  hasTexture(materialId: string, version: string): boolean {
    return this.textures.get(materialId)?.version === version
  }

  setTexture(materialId: string, version: string, image: RGBAImage): RGBAImage[] {
    const levels = buildMipmaps(image)
    this.textures.set(materialId, { version, levels })
    return levels
  }

  /** Shares an already-built mip chain (e.g. between the preview and full engines). */
  setTextureLevels(materialId: string, version: string, levels: RGBAImage[]): void {
    this.textures.set(materialId, { version, levels })
  }

  smartSelect(seed: Point, opts: SmartSelectOptions): Mask {
    return smartSelect(this.original, seed, opts)
  }

  private effectiveAlpha(surfaceId: string, feather: number) {
    const m = this.masks.get(surfaceId)
    if (!m) return null
    const p = this.masks.get(PROTECT_KEY)
    const key = `${m.version}|${p ? p.version : 'none'}|${feather}`
    const hit = this.alphaCache.get(surfaceId)
    if (hit && hit.key === key) return hit
    const feathered = featherU8(m.data, this.width, this.height, feather)
    const alpha = subtractProtect(feathered, p ? p.data : null)
    const entry = { key, alpha, bbox: maskBBox({ width: this.width, height: this.height, data: alpha }) }
    this.alphaCache.set(surfaceId, entry)
    return entry
  }

  private shadingFor(surfaceId: string, alphaKey: string, alpha: Uint8Array, bbox: BBox, smoothing: number) {
    const key = `${alphaKey}|${smoothing.toFixed(3)}`
    const hit = this.shadingCache.get(surfaceId)
    if (hit && hit.key === key) return hit.field
    const field = estimateShading(this.original, alpha, bbox, smoothing)
    this.shadingCache.set(surfaceId, { key, field })
    return field
  }

  /** Drops caches for surfaces that no longer exist. */
  prune(liveSurfaceIds: string[]): void {
    const live = new Set([...liveSurfaceIds, PROTECT_KEY])
    for (const k of [...this.masks.keys()]) if (!live.has(k)) this.masks.delete(k)
    for (const k of [...this.alphaCache.keys()]) if (!live.has(k)) this.alphaCache.delete(k)
    for (const k of [...this.shadingCache.keys()]) if (!live.has(k)) this.shadingCache.delete(k)
  }

  pruneTextures(liveMaterialIds: string[]): void {
    const live = new Set(liveMaterialIds)
    for (const k of [...this.textures.keys()]) if (!live.has(k)) this.textures.delete(k)
  }

  render(spec: RenderSpec): RenderOutput {
    const t0 = performance.now()
    const result = new Uint8ClampedArray(this.original.data)
    const editMask = new Uint8Array(this.width * this.height)
    const skipped: { id: string; reason: string }[] = []

    for (const s of spec.surfaces) {
      const eff = this.effectiveAlpha(s.id, s.feather)
      if (!eff || !eff.bbox) {
        skipped.push({ id: s.id, reason: 'No selection painted for this surface' })
        continue
      }
      let material: RenderMaterial
      let imageToPlane = null
      if (s.material.kind === 'paint') {
        material = { kind: 'paint', colorHex: s.material.colorHex }
      } else {
        const tex = this.textures.get(s.material.materialId)
        if (!tex) {
          skipped.push({ id: s.id, reason: 'Material texture is still loading' })
          continue
        }
        material = { kind: 'texture', levels: tex.levels, widthMm: s.material.widthMm, heightMm: s.material.heightMm }
        const b = eff.bbox
        const quad: Quad = s.quad
          ? quadFromTuples(s.quad)
          : [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }]
        try {
          imageToPlane = invert3(planeToImage(quad, s.widthMm, s.heightMm))
        } catch {
          skipped.push({ id: s.id, reason: 'Perspective corners are degenerate' })
          continue
        }
      }
      const field = this.shadingFor(s.id, eff.key, eff.alpha, eff.bbox, s.assignment.smoothing)
      renderSurface(this.original, result, {
        alpha: eff.alpha,
        bbox: eff.bbox,
        shading: field,
        imageToPlane,
        material,
        params: s.assignment,
      })
      const a = eff.alpha
      const { x0, y0, x1, y1 } = eff.bbox
      for (let y = y0; y < y1; y++) {
        const row = y * this.width
        for (let x = x0; x < x1; x++) if (a[row + x]) editMask[row + x] = 255
      }
    }

    const report = verifyComposite(this.original, result, editMask)
    return { result, editMask, report, skipped, ms: performance.now() - t0 }
  }
}
