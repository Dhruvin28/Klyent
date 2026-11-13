// 3D Designer plan document. Everything is in millimetres in plan space:
// x grows to the right, y grows downwards (SVG convention). In the 3D scene plan
// (x, y) maps to world (x, z) in metres with y up.

export interface Vec2 {
  x: number
  y: number
}

/** A surface finish: a plain colour, or a texture/paint from the Visualizer material library. */
export type MatRef =
  | { kind: 'color'; hex: string; roughness: number; metalness?: number }
  | { kind: 'library'; materialId: string; roughness: number; rotation?: number }

export interface Wall {
  id: string
  a: Vec2
  b: Vec2
  thickness: number
  /** null = plan.wallHeight */
  height: number | null
  /** Finish on the side to the left when walking from a to b (in plan coordinates). */
  left: MatRef | null
  right: MatRef | null
}

export const OPENING_TYPES = ['door', 'window', 'opening'] as const
export type OpeningType = (typeof OPENING_TYPES)[number]

export interface Opening {
  id: string
  wallId: string
  type: OpeningType
  /** Distance from wall.a to the opening's centre, along the wall. */
  offset: number
  width: number
  height: number
  /** Height of the bottom edge above the floor (0 for doors). */
  sill: number
  /** Door swing side / hinge mirror. */
  flip: boolean
}

export interface Room {
  id: string
  name: string
  points: Vec2[]
  floor: MatRef | null
  ceiling: MatRef | null
}

export const PARAMETRIC_TYPES = [
  'wardrobe',
  'base_cabinet',
  'wall_cabinet',
  'tall_unit',
  'shelf',
  'tv_unit',
  'bed',
  'sofa',
  'table',
  'chair',
  'box',
] as const
export type ParametricType = (typeof PARAMETRIC_TYPES)[number]

export type ItemSource = { kind: 'parametric'; type: ParametricType } | { kind: 'model'; modelId: string }

export interface Item {
  id: string
  name: string
  source: ItemSource
  /** Centre of the footprint in plan space. */
  x: number
  y: number
  /** Height of the bottom above the floor. */
  elevation: number
  /** Degrees, clockwise in plan view. */
  rotation: number
  width: number
  depth: number
  height: number
  /** Parametric options (shutter count, handle style, …). */
  params: Record<string, number | string | boolean>
  /** Finish per material slot (parametric: carcass/shutter/top/handle/…; models: 'tint'). */
  materials: Record<string, MatRef>
}

export const LIGHTING_PRESETS = ['morning', 'noon', 'evening', 'night'] as const
export type LightingPreset = (typeof LIGHTING_PRESETS)[number]

export interface Lighting {
  preset: LightingPreset
  /** Compass direction the sun shines from, degrees (0 = plan top / north). */
  sunAzimuth: number
  exposure: number
  ceilingLights: boolean
  /** Colour temperature of ceiling lights, kelvin. */
  lightTemp: number
}

export interface SavedCamera {
  id: string
  name: string
  /** World-space metres. */
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

/** A traced floor-plan image shown under the 2D editor. */
export interface Underlay {
  assetId: string
  /** Plan position of the image's top-left corner. */
  x: number
  y: number
  mmPerPx: number
  opacity: number
  visible: boolean
}

/** Dropped / POP ceiling: the area between `outer` and `inner` (or all of `outer`) sits at `level`. */
export interface CeilingZone {
  id: string
  name: string
  roomId: string | null
  outer: Vec2[]
  /** Raised tray left open inside the drop (null = flat drop over the whole outline). */
  inner: Vec2[] | null
  /** Finished underside of the dropped part, mm above the floor. */
  level: number
  cove: { width: number; kelvin: number } | null
  material: MatRef | null
}

/** Wall paneling on one face of a wall, in wall-local mm measured from wall.a. */
export interface WallPanel {
  id: string
  name: string
  wallId: string
  side: 'left' | 'right'
  start: number
  length: number
  bottom: number
  height: number
  depth: number
  divisions: number
  groove: number
  material: MatRef | null
}

export const FIXTURE_KINDS = ['downlight', 'spot', 'pendant', 'chandelier', 'wall_light', 'strip', 'fan'] as const
export type FixtureKind = (typeof FIXTURE_KINDS)[number]

export interface Fixture {
  id: string
  name: string
  kind: FixtureKind
  x: number
  y: number
  /** Height of the emitting face above the floor; null = flush with the ceiling above it. */
  mount: number | null
  size: number
  kelvin: number
  on: boolean
}

export interface Plan {
  version: 1
  wallHeight: number
  walls: Wall[]
  openings: Opening[]
  rooms: Room[]
  items: Item[]
  lighting: Lighting
  cameras: SavedCamera[]
  underlay: Underlay | null
  /** Interior 3D detail families (optional; created from drawings). */
  ceilings?: CeilingZone[]
  panels?: WallPanel[]
  fixtures?: Fixture[]
}

// ── API records ──────────────────────────────────────────────────────────

export interface DesignProjectSummary {
  id: string
  name: string
  clientId: string | null
  clientName: string | null
  thumbnailAssetId: string | null
  createdAt: string
  updatedAt: string
}

export interface DesignProject {
  id: string
  name: string
  clientId: string | null
  plan: Plan
  revision: number
  thumbnailAssetId: string | null
  createdAt: string
  updatedAt: string
}

export type DesignRenderKind = 'render' | 'panorama' | 'video'

export interface DesignRender {
  id: string
  projectId: string
  kind: DesignRenderKind
  name: string
  mimeType: string
  width: number | null
  height: number | null
  size: number
  meta: { camera?: string; samples?: number; preset?: string; durationSec?: number } | null
  createdAt: string
}

export interface DesignModel {
  id: string
  name: string
  category: string
  source: 'upload' | 'polyhaven'
  sourceRef: string | null
  glbAssetId: string
  thumbAssetId: string | null
  widthMm: number
  depthMm: number
  heightMm: number
  price: number | null
  brand: string | null
  license: string | null
  createdAt: string
}

export interface PolyHavenModel {
  id: string
  name: string
  categories: string[]
  /** [width, depth, height] mm as reported by Poly Haven. */
  dimensions: [number, number, number] | null
  thumbnailUrl: string
  imported: boolean
}

export interface DesignShare {
  id: string
  projectId: string
  token: string
  title: string
  message: string | null
  renderIds: string[]
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface PublicDesignShare {
  title: string
  message: string | null
  projectName: string
  company: { name: string | null; logoUrl: string | null; phone: string | null; website: string | null }
  items: { id: string; kind: DesignRenderKind; name: string; mimeType: string; width: number | null; height: number | null; path: string }[]
  createdAt: string
}
