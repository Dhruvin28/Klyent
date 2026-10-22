import { snapAlphaToEdges } from './edges'
import { boxBlurF32, featherU8 } from './filters'
import { applyHomography, invert3, planeToImage, quadFromTuples } from './homography'
import { maskBBox, smartSelect, subtractProtect, type SmartSelectOptions } from './mask'
import { buildMipmaps } from './material'
import { labelPanels, panelHash, type PanelMap } from './panels'
import { fitQuadToMask } from './quadfit'
import { renderSurface, verifyComposite, type PanelPlacement, type ReflectionInput, type RenderMaterial } from './render'
import { estimateShading, type ShadingField } from './shading'
import type { BBox, Mask, Mat3, Point, Quad, RGBAImage, SceneCalibration, VerificationReport, VizAssignment, VizSurface } from './types'

export type SpecMaterial =
  | { kind: 'paint'; colorHex: string }
  | { kind: 'texture'; materialId: string; widthMm: number; heightMm: number }

export interface SpecSurface {
  id: string
  quad: VizSurface['quad']
  widthMm: number
  heightMm: number
  feather: number
  edgeSnap?: boolean
  assignment: VizAssignment
  material: SpecMaterial
}

export interface RenderSpec {
  surfaces: SpecSurface[]
  calibration?: SceneCalibration | null
}

export interface RenderOutput {
  result: Uint8ClampedArray<ArrayBuffer>
  /** 255 wherever any surface was allowed to modify the pixel, else 0. */
  editMask: Uint8Array
  report: VerificationReport
  skipped: { id: string; reason: string }[]
  ms: number
}

/** Geometry of one surface, independent of the material on it. */
export interface MeasureSurface {
  id: string
  quad: VizSurface['quad']
  widthMm: number
  heightMm: number
  feather: number
  edgeSnap?: boolean
}

export interface SurfaceMeasurement {
  id: string
  /** Net visible area on the real plane (protected details excluded), m². */
  areaSqm: number
  pixels: number
}

export const PROTECT_KEY = '__protect__'

/** Linear RGB gain from a scene calibration: the reference's measured colour over its assumed reflectance. */
export function calibrationGain(c: SceneCalibration | null | undefined): [number, number, number] | null {
  if (!c || !c.enabled) return null
  const albedo = Math.max(0.05, Math.min(1, c.albedo))
  return c.white.map((v) => Math.max(0.03, Math.min(3, v / albedo))) as [number, number, number]
}

/**
 * Holds the reference render plus per-surface caches. Runs inside a Web Worker in the
 * app, and directly in unit tests.
 */
export class VisualizerEngine {
  private masks = new Map<string, { version: number; data: Uint8Array }>()
  private textures = new Map<string, { version: string; levels: RGBAImage[] }>()
  private alphaCache = new Map<string, { key: string; alpha: Uint8Array; bbox: BBox | null }>()
  private shadingCache = new Map<string, { key: string; field: ShadingField }>()
  private panelCache = new Map<string, { key: string; map: PanelMap }>()
  private reflectionCache = new Map<string, { key: string; value: Omit<ReflectionInput, 'strength'> }>()

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

  /** Snaps an arbitrary selection (e.g. an AI proposal) to the render's edges. */
  snapToEdges(data: Uint8Array): Uint8Array {
    return snapAlphaToEdges(this.original, data, data)
  }

  /** Fits the perspective quad of a surface to its saved selection. */
  fitQuad(key: string): Quad | null {
    const m = this.masks.get(key)
    return m ? fitQuadToMask({ width: this.width, height: this.height, data: m.data }) : null
  }

  private effectiveAlpha(surfaceId: string, feather: number, edgeSnap: boolean) {
    const m = this.masks.get(surfaceId)
    if (!m) return null
    const p = this.masks.get(PROTECT_KEY)
    const key = `${m.version}|${p ? p.version : 'none'}|${feather}|${edgeSnap ? 1 : 0}`
    const hit = this.alphaCache.get(surfaceId)
    if (hit && hit.key === key) return hit
    let soft = featherU8(m.data, this.width, this.height, feather)
    if (edgeSnap) soft = snapAlphaToEdges(this.original, soft, m.data)
    const alpha = subtractProtect(soft, p ? p.data : null)
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

  private panelsFor(surfaceId: string, alphaKey: string, alpha: Uint8Array, bbox: BBox): PanelMap | null {
    const m = this.masks.get(surfaceId)
    if (!m) return null
    const hit = this.panelCache.get(surfaceId)
    if (hit && hit.key === alphaKey) return hit.map
    const map = labelPanels(m.data, alpha, this.width, bbox)
    this.panelCache.set(surfaceId, { key: alphaKey, map })
    return map
  }

  /**
   * Reflection inputs for a surface: the contact line of each vertical run of the
   * selection, and a blurred copy of the render above it (blur grows as the finish
   * gets less glossy).
   */
  private reflectionFor(surfaceId: string, alphaKey: string, alpha: Uint8Array, bbox: BBox, finish: string) {
    const key = `${alphaKey}|${finish}`
    const hit = this.reflectionCache.get(surfaceId)
    if (hit && hit.key === key) return hit.value
    const w = this.width
    const bw = bbox.x1 - bbox.x0
    const bh = bbox.y1 - bbox.y0
    const axis = new Int16Array(bw * bh)
    for (let x = bbox.x0; x < bbox.x1; x++) {
      let start = -1
      for (let y = bbox.y0; y < bbox.y1; y++) {
        if (!alpha[y * w + x]) start = -1
        else if (start < 0) start = y
        axis[(y - bbox.y0) * bw + x - bbox.x0] = start < 0 ? y : start
      }
    }
    const fadePx = Math.max(24, Math.round(bh * 0.35))
    const sy0 = Math.max(0, bbox.y0 - fadePx)
    const sh = bbox.y1 - sy0
    const diag = Math.hypot(this.width, this.height)
    const r = Math.max(1, Math.round(diag / (finish === 'gloss' ? 1800 : finish === 'satin' ? 500 : 220)))
    const src = this.original.data
    const source = new Uint8ClampedArray(bw * sh * 4)
    const ch = new Float32Array(bw * sh)
    const tmp = new Float32Array(bw * sh)
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < sh; y++) for (let x = 0; x < bw; x++) ch[y * bw + x] = src[((y + sy0) * w + x + bbox.x0) * 4 + c]
      boxBlurF32(ch, bw, sh, r, tmp)
      boxBlurF32(ch, bw, sh, r, tmp)
      for (let k = 0; k < bw * sh; k++) source[k * 4 + c] = ch[k]
    }
    const value = { axis, source, sx0: bbox.x0, sy0, sw: bw, sh, fadePx }
    this.reflectionCache.set(surfaceId, { key, value })
    return value
  }

  /** Image → plane (mm) homography of a surface; the selection's bounding box stands in for a missing quad. */
  private imageToPlane(s: { quad: VizSurface['quad']; widthMm: number; heightMm: number }, b: BBox): Mat3 {
    const quad: Quad = s.quad
      ? quadFromTuples(s.quad)
      : [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }]
    return invert3(planeToImage(quad, s.widthMm, s.heightMm))
  }

  private panelPlacement(map: PanelMap, imageToPlane: Mat3, s: SpecSurface): PanelPlacement | null {
    const a = s.assignment
    const mode = a.panelMode ?? 'continuous'
    if (mode === 'continuous' || map.count < 2 || s.material.kind !== 'texture') return null
    const { widthMm: tw, heightMm: th } = s.material
    const theta = (a.rotationDeg * Math.PI) / 180
    const cr = Math.cos(theta) / a.scale
    const sr = Math.sin(theta) / a.scale
    // Material coordinates (u, v) of each panel centre, as the renderer computes them.
    const centres = map.centroids.map((c) => {
      const p = applyHomography(imageToPlane, c.x, c.y)
      const ea = p.x - a.offsetXMm
      const eb = p.y - a.offsetYMm
      return { u: ea * cr + eb * sr, v: -ea * sr + eb * cr }
    })
    const params = new Float64Array(map.count * 4)
    const seed = a.panelSeed ?? 1
    if (mode === 'random') {
      // A different part of the sheet per panel (golden-ratio steps from a random start keep
      // neighbours far apart on the sheet); some panels are turned 180° (grain direction unchanged).
      const u0 = panelHash(seed, 1)
      const v0 = panelHash(seed, 2)
      for (let i = 0; i < map.count; i++) {
        const turn = panelHash(seed + 7919, i + 1) < 0.5 ? -1 : 1
        params[i * 4] = turn
        params[i * 4 + 1] = ((u0 + i * 0.6180339887) % 1) * tw
        params[i * 4 + 2] = turn
        params[i * 4 + 3] = ((v0 + i * 0.7548776662) % 1) * th
      }
      return { labels: map.labels, params }
    }
    // Book-match: each panel mirrors its left neighbour across the seam between them, along
    // whichever material axis runs across the panels (u for upright grain, v when turned 90°).
    const acrossU = Math.abs(cr) >= Math.abs(sr)
    const order = map.rank.map((r, i) => ({ r, i })).sort((x, y) => x.r - y.r).map((x) => x.i)
    let sign = 1
    let t = 0
    for (let k = 0; k < order.length; k++) {
      const i = order[k]
      if (k > 0) {
        const prev = centres[order[k - 1]]
        const cur = centres[i]
        const seam = acrossU ? (prev.u + cur.u) / 2 : (prev.v + cur.v) / 2
        t = sign * 2 * seam + t
        sign = -sign
      }
      params[i * 4] = acrossU ? sign : 1
      params[i * 4 + 1] = acrossU ? t : 0
      params[i * 4 + 2] = acrossU ? 1 : sign
      params[i * 4 + 3] = acrossU ? 0 : t
    }
    return { labels: map.labels, params }
  }

  /** Drops caches for surfaces that no longer exist. */
  prune(liveSurfaceIds: string[]): void {
    const live = new Set([...liveSurfaceIds, PROTECT_KEY])
    for (const cache of [this.masks, this.alphaCache, this.shadingCache, this.panelCache, this.reflectionCache] as Map<string, unknown>[]) {
      for (const k of [...cache.keys()]) if (!live.has(k)) cache.delete(k)
    }
  }

  pruneTextures(liveMaterialIds: string[]): void {
    const live = new Set(liveMaterialIds)
    for (const k of [...this.textures.keys()]) if (!live.has(k)) this.textures.delete(k)
  }

  /**
   * Real-world area of each surface's visible selection: every selected pixel weighted
   * by its coverage and by the area it spans on the surface plane (|det J| of the
   * image→plane homography, which is |det H| / w³). Protected details are excluded.
   */
  measure(surfaces: MeasureSurface[]): SurfaceMeasurement[] {
    const out: SurfaceMeasurement[] = []
    const w = this.width
    for (const s of surfaces) {
      const eff = this.effectiveAlpha(s.id, s.feather, !!s.edgeSnap)
      if (!eff || !eff.bbox) {
        out.push({ id: s.id, areaSqm: 0, pixels: 0 })
        continue
      }
      let H: Mat3
      try {
        H = this.imageToPlane(s, eff.bbox)
      } catch {
        out.push({ id: s.id, areaSqm: 0, pixels: 0 })
        continue
      }
      const det = Math.abs(
        H[0] * (H[4] * H[8] - H[5] * H[7]) - H[1] * (H[3] * H[8] - H[5] * H[6]) + H[2] * (H[3] * H[7] - H[4] * H[6])
      )
      const { x0, y0, x1, y1 } = eff.bbox
      let area = 0
      let pixels = 0
      for (let y = y0; y < y1; y++) {
        const cy = y + 0.5
        for (let x = x0; x < x1; x++) {
          const a = eff.alpha[y * w + x]
          if (!a) continue
          const wv = H[6] * (x + 0.5) + H[7] * cy + H[8]
          area += (a / 255) * (det / Math.abs(wv * wv * wv))
          pixels += a / 255
        }
      }
      out.push({ id: s.id, areaSqm: area / 1e6, pixels: Math.round(pixels) })
    }
    return out
  }

  render(spec: RenderSpec): RenderOutput {
    const t0 = performance.now()
    const result = new Uint8ClampedArray(this.original.data)
    const editMask = new Uint8Array(this.width * this.height)
    const skipped: { id: string; reason: string }[] = []
    const gain = calibrationGain(spec.calibration)

    for (const s of spec.surfaces) {
      const eff = this.effectiveAlpha(s.id, s.feather, !!s.edgeSnap)
      if (!eff || !eff.bbox) {
        skipped.push({ id: s.id, reason: 'No selection painted for this surface' })
        continue
      }
      let material: RenderMaterial
      let imageToPlane: Mat3 | null = null
      let panels: PanelPlacement | null = null
      if (s.material.kind === 'paint') {
        material = { kind: 'paint', colorHex: s.material.colorHex }
      } else {
        const tex = this.textures.get(s.material.materialId)
        if (!tex) {
          skipped.push({ id: s.id, reason: 'Material texture is still loading' })
          continue
        }
        material = { kind: 'texture', levels: tex.levels, widthMm: s.material.widthMm, heightMm: s.material.heightMm }
        try {
          imageToPlane = this.imageToPlane(s, eff.bbox)
        } catch {
          skipped.push({ id: s.id, reason: 'Perspective corners are degenerate' })
          continue
        }
        if (s.assignment.panelMode && s.assignment.panelMode !== 'continuous') {
          const map = this.panelsFor(s.id, eff.key, eff.alpha, eff.bbox)
          if (map) panels = this.panelPlacement(map, imageToPlane, s)
        }
      }
      const field = this.shadingFor(s.id, eff.key, eff.alpha, eff.bbox, s.assignment.smoothing)
      const reflStrength = Math.max(0, Math.min(1, s.assignment.reflection ?? 0))
      const reflection =
        reflStrength > 0 ? { strength: reflStrength, ...this.reflectionFor(s.id, eff.key, eff.alpha, eff.bbox, s.assignment.finish) } : null
      renderSurface(this.original, result, {
        alpha: eff.alpha,
        bbox: eff.bbox,
        shading: field,
        imageToPlane,
        material,
        params: s.assignment,
        panels,
        reflection,
        gain,
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
