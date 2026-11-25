// Shared types for the Material Replacement Visualizer engine.
// VizState mirrors apps/backend/src/visualizer/state.ts — keep the two in sync.

export interface RGBAImage {
  width: number
  height: number
  /** Row-major RGBA, 8 bits per channel, straight (non-premultiplied) alpha. */
  data: Uint8ClampedArray<ArrayBuffer>
}

/** Per-pixel coverage 0..255 (0 = untouched, 255 = fully selected). */
export interface Mask {
  width: number
  height: number
  data: Uint8Array
}

export interface Point {
  x: number
  y: number
}

/** Corners in image pixels, ordered top-left, top-right, bottom-right, bottom-left of the real-world rectangle. */
export type Quad = [Point, Point, Point, Point]

export interface BBox {
  x0: number
  y0: number
  /** exclusive */
  x1: number
  /** exclusive */
  y1: number
}

export type Mat3 = Float64Array // row-major 3×3

export const SURFACE_TYPES = ['wardrobe', 'cabinet', 'wall', 'floor', 'ceiling', 'panel', 'countertop', 'backsplash', 'door', 'other'] as const
export type SurfaceType = (typeof SURFACE_TYPES)[number]

export const FINISHES = ['matte', 'satin', 'gloss'] as const
export type Finish = (typeof FINISHES)[number]

export const TILE_LAYOUTS = ['grid', 'brick50', 'brick33', 'stack90'] as const
export type TileLayout = (typeof TILE_LAYOUTS)[number]

export const MATERIAL_CATEGORIES = ['laminate', 'veneer', 'tile', 'stone', 'wood', 'fabric', 'wallpaper', 'metal', 'paint', 'other'] as const
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

export const PANEL_MODES = ['continuous', 'random', 'bookmatch'] as const
/** How a sheet material runs across separate panels (shutters) of one surface. */
export type PanelMode = (typeof PANEL_MODES)[number]

export const ESTIMATE_UNITS = ['sheet', 'box', 'litre', 'roll', 'sqft', 'sqm'] as const
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number]

export interface TileSettings {
  layout: TileLayout
  groutMm: number
  groutColor: string
  /** Shift the texture per tile/plank so repeats are less obvious. */
  variation: boolean
}

export interface VizSurface {
  id: string
  name: string
  type: SurfaceType
  maskAssetId: string | null
  /** [x, y] tuples in image pixels: TL, TR, BR, BL of the real-world rectangle. */
  quad: [[number, number], [number, number], [number, number], [number, number]] | null
  widthMm: number
  heightMm: number
  /** false → height is estimated from the perspective of the quad. */
  heightManual: boolean
  /** Edge softening of the mask in pixels. */
  feather: number
  /** Snap the soft edge to edges in the render (guided filter, ±3px). */
  edgeSnap?: boolean
}

export interface VizAssignment {
  materialId: string
  pattern: 'continuous' | 'tiles'
  rotationDeg: number
  offsetXMm: number
  offsetYMm: number
  /** Multiplier on the material's physical size (1 = true scale). */
  scale: number
  finish: Finish
  /** How strongly the original render's light and shadow is applied (1 = as rendered). */
  shading: number
  /** How much of the original surface's fine detail (grooves, old grain) is kept. */
  detail: number
  /** How aggressively the original texture is removed from the shading estimate. */
  smoothing: number
  exposure: number
  tile: TileSettings
  /** paint only: 'recolor' keeps the original surface's texture and only changes its colour. */
  mode?: 'replace' | 'recolor'
  /** textures only: grain continuity across separate panels of the surface. */
  panelMode?: PanelMode
  panelSeed?: number
  /** Approximate planar reflection of the scene above (floors), 0..1. */
  reflection?: number
  /** How much of the render's local light colour (warm lamps, daylight) tints the new material, 0..1. */
  lightColor?: number
}

export interface VizOption {
  id: string
  name: string
  notes: string
  assignments: Record<string, VizAssignment>
}

/** Scene exposure / white balance measured from a neutral white surface in the render. */
export interface SceneCalibration {
  enabled: boolean
  /** Mean linear RGB of the reference patch. */
  white: [number, number, number]
  /** Assumed reflectance of the reference surface (white paint ≈ 0.85). */
  albedo: number
  point: [number, number]
}

export interface VizState {
  version: 1
  surfaces: VizSurface[]
  protectMaskAssetId: string | null
  options: VizOption[]
  activeOptionId: string
  approvedOptionId: string | null
  calibration?: SceneCalibration | null
}

export interface MaterialPrepSettings {
  corners: [[number, number], [number, number], [number, number], [number, number]] | null
  delight: number
  seamless: number
  /** Physical size of the cornered region before seamless trimming. */
  regionWidthMm?: number
  regionHeightMm?: number
  /** Mean sRGB of a neutral (white/grey card) patch in the sample photo, for white balance. */
  whiteBalance?: [number, number, number] | null
  /** 'cut' joins the repeat along a minimum-difference seam (no ghosted grain); 'blend' cross-fades. */
  seamlessMode?: 'blend' | 'cut'
  /** Synthesise a larger texture (×2 per side) so big surfaces show less repetition. */
  expand?: 1 | 2
}

/** Ordering assumptions for the quantity estimate of a material. */
export interface MaterialEstimate {
  unit: EstimateUnit
  /** sheet / roll size (sheet: 2440×1220; roll: width × length). */
  sheetWidthMm?: number
  sheetHeightMm?: number
  piecesPerBox?: number
  /** paint: m² per litre per coat. */
  coverageSqmPerLitre?: number
  coats?: number
  wastagePct: number
  /** Price per unit (sheet, box, litre, roll, sq ft or m²); null = not priced. */
  rate: number | null
}

export interface VizMaterial {
  id: string
  name: string
  kind: 'texture' | 'paint'
  category: MaterialCategory
  colorHex: string | null
  sourceAssetId: string | null
  textureAssetId: string | null
  textureWidth: number | null
  textureHeight: number | null
  widthMm: number | null
  heightMm: number | null
  brand: string | null
  code: string | null
  notes: string | null
  settings: {
    prep?: MaterialPrepSettings
    defaultPattern?: 'continuous' | 'tiles'
    tile?: TileSettings
    defaultFinish?: Finish
    estimate?: MaterialEstimate
  } | null
  createdAt: string
  updatedAt: string
}

export interface VerificationReport {
  ok: boolean
  width: number
  height: number
  totalPixels: number
  editablePixels: number
  protectedPixels: number
  changedOutsideMask: number
  changedInsideMask: number
  firstViolation: { x: number; y: number } | null
  verifiedBy: 'client' | 'server'
  referenceSha256?: string
  resultSha256?: string
  verifiedAt?: string
}
