import { z } from 'zod'

// Mirrors apps/frontend/src/lib/visualizer/types.ts (VizState). Bounds keep a
// malicious or buggy client from persisting absurd values the renderer would choke on.

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const finite = (min: number, max: number) => z.number().finite().min(min).max(max)
const point = z.tuple([finite(-1e5, 1e5), finite(-1e5, 1e5)])

export const SURFACE_TYPES = ['wardrobe', 'wall', 'floor', 'ceiling', 'panel', 'countertop', 'backsplash', 'door', 'other'] as const
export const FINISHES = ['matte', 'satin', 'gloss'] as const
export const TILE_LAYOUTS = ['grid', 'brick50', 'brick33', 'stack90'] as const

const surfaceSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  type: z.enum(SURFACE_TYPES),
  maskAssetId: id.nullable(),
  quad: z.tuple([point, point, point, point]).nullable(),
  widthMm: finite(1, 100_000),
  heightMm: finite(1, 100_000),
  heightManual: z.boolean(),
  feather: finite(0, 20),
})

const assignmentSchema = z.object({
  materialId: id,
  pattern: z.enum(['continuous', 'tiles']),
  rotationDeg: finite(-360, 360),
  offsetXMm: finite(-100_000, 100_000),
  offsetYMm: finite(-100_000, 100_000),
  scale: finite(0.05, 20),
  finish: z.enum(FINISHES),
  shading: finite(0, 1.5),
  detail: finite(0, 1),
  smoothing: finite(0, 1),
  exposure: finite(0.25, 3),
  tile: z.object({
    layout: z.enum(TILE_LAYOUTS),
    groutMm: finite(0, 50),
    groutColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    variation: z.boolean(),
  }),
})

const optionSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  notes: z.string().max(2000).default(''),
  assignments: z.record(id, assignmentSchema).refine((r) => Object.keys(r).length <= 50, 'Too many assignments'),
})

export const vizStateSchema = z
  .object({
    version: z.literal(1),
    surfaces: z.array(surfaceSchema).max(30),
    protectMaskAssetId: id.nullable(),
    options: z.array(optionSchema).min(1).max(20),
    activeOptionId: id,
    approvedOptionId: id.nullable(),
  })
  .superRefine((s, ctx) => {
    const surfaceIds = new Set(s.surfaces.map((x) => x.id))
    if (surfaceIds.size !== s.surfaces.length) ctx.addIssue({ code: 'custom', message: 'Duplicate surface id' })
    const optionIds = new Set(s.options.map((o) => o.id))
    if (optionIds.size !== s.options.length) ctx.addIssue({ code: 'custom', message: 'Duplicate option id' })
    if (!optionIds.has(s.activeOptionId)) ctx.addIssue({ code: 'custom', message: 'activeOptionId must reference an option' })
    if (s.approvedOptionId && !optionIds.has(s.approvedOptionId)) {
      ctx.addIssue({ code: 'custom', message: 'approvedOptionId must reference an option' })
    }
    for (const o of s.options) {
      for (const sid of Object.keys(o.assignments)) {
        if (!surfaceIds.has(sid)) ctx.addIssue({ code: 'custom', message: `Option "${o.name}" references unknown surface ${sid}` })
      }
    }
  })

export type VizState = z.infer<typeof vizStateSchema>

export function initialState(): VizState {
  const optionId = crypto.randomUUID()
  return {
    version: 1,
    surfaces: [],
    protectMaskAssetId: null,
    options: [{ id: optionId, name: 'Option A', notes: '', assignments: {} }],
    activeOptionId: optionId,
    approvedOptionId: null,
  }
}

/** Every asset id a state document points at (for orphan cleanup). */
export function referencedMaskIds(state: VizState): Set<string> {
  const ids = new Set<string>()
  for (const s of state.surfaces) if (s.maskAssetId) ids.add(s.maskAssetId)
  if (state.protectMaskAssetId) ids.add(state.protectMaskAssetId)
  return ids
}

export function referencedMaterialIds(state: VizState): Set<string> {
  const ids = new Set<string>()
  for (const o of state.options) for (const a of Object.values(o.assignments)) ids.add(a.materialId)
  return ids
}

export const MATERIAL_CATEGORIES = ['laminate', 'veneer', 'tile', 'stone', 'wood', 'fabric', 'wallpaper', 'metal', 'paint', 'other'] as const

export const materialSettingsSchema = z
  .object({
    prep: z
      .object({
        corners: z.tuple([point, point, point, point]).nullable(),
        delight: finite(0, 1),
        seamless: finite(0, 0.45),
        // Physical size of the cornered region before seamless trimming.
        regionWidthMm: finite(1, 100_000).optional(),
        regionHeightMm: finite(1, 100_000).optional(),
      })
      .optional(),
    defaultPattern: z.enum(['continuous', 'tiles']).optional(),
    tile: z
      .object({
        layout: z.enum(TILE_LAYOUTS),
        groutMm: finite(0, 50),
        groutColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        variation: z.boolean(),
      })
      .optional(),
    defaultFinish: z.enum(FINISHES).optional(),
  })
  .strict()

export const materialFieldsSchema = z.object({
  name: z.string().trim().min(1).max(255),
  kind: z.enum(['texture', 'paint']),
  category: z.enum(MATERIAL_CATEGORIES),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  widthMm: finite(1, 100_000).nullable().optional(),
  heightMm: finite(1, 100_000).nullable().optional(),
  brand: z.string().trim().max(255).nullable().optional(),
  code: z.string().trim().max(255).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  settings: materialSettingsSchema.nullable().optional(),
})
