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
})

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

