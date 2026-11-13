import { z } from 'zod'

// Server-side mirror of apps/frontend/src/lib/designer/types.ts (Plan). All lengths are
// millimetres in plan space; bounds keep a hostile or corrupted document small and sane.

const id = z.string().min(1).max(128)
const coord = z.number().finite().min(-1_000_000).max(1_000_000)
const length = (min: number, max: number) => z.number().finite().min(min).max(max)
const hex = z.string().regex(/^#[0-9a-f]{6}$/i)
const unit = z.number().finite().min(0).max(1)

const vec2 = z.object({ x: coord, y: coord })

const matRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), hex, roughness: unit, metalness: unit.optional() }),
  z.object({ kind: z.literal('library'), materialId: id, roughness: unit, rotation: z.number().finite().min(-360).max(360).optional() }),
])

const wall = z.object({
  id,
  a: vec2,
  b: vec2,
  thickness: length(1, 2000),
  height: length(1, 20_000).nullable(),
  left: matRef.nullable(),
  right: matRef.nullable(),
})

const opening = z.object({
  id,
  wallId: id,
  type: z.enum(['door', 'window', 'opening']),
  offset: length(0, 1_000_000),
  width: length(1, 20_000),
  height: length(1, 20_000),
  sill: length(0, 20_000),
  flip: z.boolean(),
})

const room = z.object({
  id,
  name: z.string().max(200),
  points: z.array(vec2).min(3).max(500),
  floor: matRef.nullable(),
  ceiling: matRef.nullable(),
})

const PARAMETRIC_TYPES = ['wardrobe', 'base_cabinet', 'wall_cabinet', 'tall_unit', 'shelf', 'tv_unit', 'bed', 'sofa', 'table', 'chair', 'box'] as const

const boundedRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.record(z.string().max(64), value).refine((r) => Object.keys(r).length <= 40, 'at most 40 keys')

const item = z.object({
  id,
  name: z.string().max(255),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('parametric'), type: z.enum(PARAMETRIC_TYPES) }),
    z.object({ kind: z.literal('model'), modelId: id }),
  ]),
  x: coord,
  y: coord,
  elevation: length(-10_000, 20_000),
  rotation: z.number().finite().min(-3600).max(3600),
  width: length(1, 50_000),
  depth: length(1, 50_000),
  height: length(1, 50_000),
  params: boundedRecord(z.union([z.string().max(200), z.number().finite(), z.boolean()])),
  materials: boundedRecord(matRef),
})

const lighting = z.object({
  preset: z.enum(['morning', 'noon', 'evening', 'night']),
  sunAzimuth: z.number().finite().min(-360).max(360),
  exposure: z.number().finite().min(0.05).max(10),
  ceilingLights: z.boolean(),
  lightTemp: z.number().finite().min(1000).max(12_000),
})

const vec3 = z.tuple([coord, coord, coord])

const camera = z.object({
  id,
  name: z.string().max(200),
  position: vec3,
  target: vec3,
  fov: z.number().finite().min(5).max(170),
})

const underlay = z.object({
  assetId: id,
  x: coord,
  y: coord,
  mmPerPx: z.number().finite().positive().max(10_000),
  opacity: unit,
  visible: z.boolean(),
})

// Interior detail families (optional so existing designs stay valid).

/** Dropped / POP ceiling: the area between `outer` and `inner` (or all of `outer`) sits at `level`. */
const ceilingZone = z.object({
  id,
  name: z.string().max(200),
  roomId: id.nullable(),
  outer: z.array(vec2).min(3).max(500),
  /** Raised tray left open inside the drop (null = flat drop over the whole outer outline). */
  inner: z.array(vec2).min(3).max(500).nullable(),
  /** Finished underside of the dropped part, mm above finished floor. */
  level: length(100, 20_000),
  cove: z.object({ width: length(10, 2000), kelvin: z.number().finite().min(1000).max(12_000) }).nullable(),
  material: matRef.nullable(),
})

/** Wall paneling on one face of a wall, in wall-local coordinates (from wall.a). */
const wallPanel = z.object({
  id,
  name: z.string().max(200),
  wallId: id,
  side: z.enum(['left', 'right']),
  start: length(0, 1_000_000),
  length: length(1, 1_000_000),
  bottom: length(0, 20_000),
  height: length(1, 20_000),
  depth: length(1, 500),
  divisions: z.number().int().min(1).max(200),
  groove: length(0, 200),
  material: matRef.nullable(),
})

export const FIXTURE_KINDS = ['downlight', 'spot', 'pendant', 'chandelier', 'wall_light', 'strip', 'fan'] as const

const fixture = z.object({
  id,
  name: z.string().max(200),
  kind: z.enum(FIXTURE_KINDS),
  x: coord,
  y: coord,
  /** Height of the fixture's emitting face above the floor; null = flush with the ceiling above it. */
  mount: length(0, 20_000).nullable(),
  size: length(10, 5000),
  kelvin: z.number().finite().min(1000).max(12_000),
  on: z.boolean(),
})

export const planSchema = z.object({
  version: z.literal(1),
  wallHeight: length(100, 20_000),
  walls: z.array(wall).max(2000),
  openings: z.array(opening).max(2000),
  rooms: z.array(room).max(500),
  items: z.array(item).max(2000),
  lighting,
  cameras: z.array(camera).max(100),
  underlay: underlay.nullable(),
  ceilings: z.array(ceilingZone).max(500).optional(),
  panels: z.array(wallPanel).max(2000).optional(),
  fixtures: z.array(fixture).max(2000).optional(),
})

export type Wall = z.infer<typeof wall>
export type Opening = z.infer<typeof opening>
export type Room = z.infer<typeof room>
export type Item = z.infer<typeof item>
export type MatRef = z.infer<typeof matRef>
export type SavedCamera = z.infer<typeof camera>
export type CeilingZone = z.infer<typeof ceilingZone>
export type WallPanel = z.infer<typeof wallPanel>
export type Fixture = z.infer<typeof fixture>
export type ParametricType = (typeof PARAMETRIC_TYPES)[number]
export { PARAMETRIC_TYPES }

export type Plan = z.infer<typeof planSchema>

export function defaultPlan(): Plan {
  return {
    version: 1,
    wallHeight: 2700,
    walls: [],
    openings: [],
    rooms: [],
    items: [],
    lighting: { preset: 'noon', sunAzimuth: 135, exposure: 1, ceilingLights: true, lightTemp: 3500 },
    cameras: [],
    underlay: null,
  }
}

