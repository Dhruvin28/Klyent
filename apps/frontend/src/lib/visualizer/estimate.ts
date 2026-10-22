import type { EstimateUnit, MaterialEstimate, VizMaterial } from './types'

export const SQFT_PER_SQM = 10.763910417

export const UNIT_LABELS: Record<EstimateUnit, { one: string; many: string; short: string }> = {
  sheet: { one: 'sheet', many: 'sheets', short: 'sheet' },
  box: { one: 'box', many: 'boxes', short: 'box' },
  litre: { one: 'litre', many: 'litres', short: 'L' },
  roll: { one: 'roll', many: 'rolls', short: 'roll' },
  sqft: { one: 'sq ft', many: 'sq ft', short: 'sq ft' },
  sqm: { one: 'm²', many: 'm²', short: 'm²' },
}

type MaterialLike = Pick<VizMaterial, 'kind' | 'category' | 'widthMm' | 'heightMm' | 'settings'>

/** Tile/plank face size: the cornered sample region (before seamless trimming) when known. */
export function pieceSizeMm(m: MaterialLike): [number, number] | null {
  const w = m.settings?.prep?.regionWidthMm ?? m.widthMm
  const h = m.settings?.prep?.regionHeightMm ?? m.heightMm
  return w && h ? [w, h] : null
}

/** Sensible ordering defaults by category (all editable per material). */
export function defaultEstimate(m: MaterialLike): MaterialEstimate {
  if (m.kind === 'paint' || m.category === 'paint') return { unit: 'litre', coverageSqmPerLitre: 10, coats: 2, wastagePct: 5, rate: null }
  switch (m.category) {
    case 'laminate':
    case 'veneer':
      return { unit: 'sheet', sheetWidthMm: 2440, sheetHeightMm: 1220, wastagePct: 15, rate: null }
    case 'wallpaper':
      return { unit: 'roll', sheetWidthMm: 530, sheetHeightMm: 10050, wastagePct: 15, rate: null }
    case 'tile':
    case 'stone': {
      const size = pieceSizeMm(m)
      const pieceSqm = size ? (size[0] * size[1]) / 1e6 : 0.36
      return { unit: 'box', piecesPerBox: Math.max(1, Math.round(1.44 / pieceSqm)), wastagePct: 10, rate: null }
    }
    default:
      return { unit: 'sqft', wastagePct: 10, rate: null }
  }
}

export function effectiveEstimate(m: MaterialLike): MaterialEstimate {
  return { ...defaultEstimate(m), ...(m.settings?.estimate ?? {}) }
}

export interface QuantityResult {
  unit: EstimateUnit
  /** Units to order (whole units for discrete items). */
  quantity: number
  /** Unrounded requirement including wastage. */
  exact: number
  /** Extra detail, e.g. pieces for boxed tiles. */
  pieces: number | null
  rate: number | null
  cost: number | null
  /** Human-readable basis of the calculation. */
  basis: string
}

const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-IN')

/** Converts a net surface area into an order quantity for one material. */
export function quantityFor(areaSqm: number, m: MaterialLike): QuantityResult {
  const e = effectiveEstimate(m)
  const waste = 1 + Math.max(0, e.wastagePct) / 100
  const need = Math.max(0, areaSqm) * waste
  const rate = e.rate != null && Number.isFinite(e.rate) && e.rate >= 0 ? e.rate : null
  let quantity: number
  let exact: number
  let pieces: number | null = null
  let basis: string
  const wasteNote = e.wastagePct ? ` + ${fmt(e.wastagePct, 0)}% wastage` : ''
  // Guard against float noise turning 4.0000001 into 5 units.
  const up = (v: number) => Math.ceil(v - 1e-9)
  switch (e.unit) {
    case 'sheet':
    case 'roll': {
      const w = e.sheetWidthMm ?? (e.unit === 'sheet' ? 2440 : 530)
      const h = e.sheetHeightMm ?? (e.unit === 'sheet' ? 1220 : 10050)
      exact = need / ((w * h) / 1e6)
      quantity = need > 0 ? up(exact) : 0
      basis = `${fmt(areaSqm * SQFT_PER_SQM)} sq ft${wasteNote} ÷ ${w}×${h} mm ${e.unit}`
      break
    }
    case 'box': {
      const size = pieceSizeMm(m)
      const pieceSqm = size ? (size[0] * size[1]) / 1e6 : 0.36
      const perBox = Math.max(1, Math.round(e.piecesPerBox ?? 1))
      pieces = need > 0 ? up(need / pieceSqm) : 0
      exact = pieces / perBox
      quantity = up(exact)
      basis = `${pieces} pcs of ${size ? `${Math.round(size[0])}×${Math.round(size[1])} mm` : 'tile'}${wasteNote}, ${perBox} per box`
      break
    }
    case 'litre': {
      const cov = Math.max(0.1, e.coverageSqmPerLitre ?? 10)
      const coats = Math.max(1, Math.round(e.coats ?? 2))
      exact = (need * coats) / cov
      quantity = need > 0 ? up(exact) : 0
      basis = `${fmt(areaSqm * SQFT_PER_SQM)} sq ft × ${coats} coat${coats > 1 ? 's' : ''}${wasteNote} at ${fmt(cov)} m²/L`
      break
    }
    case 'sqm':
      exact = need
      quantity = Math.round(need * 100) / 100
      basis = `${fmt(areaSqm, 2)} m²${wasteNote}`
      break
    case 'sqft':
    default:
      exact = need * SQFT_PER_SQM
      quantity = Math.round(exact * 10) / 10
      basis = `${fmt(areaSqm * SQFT_PER_SQM)} sq ft${wasteNote}`
      break
  }
  return { unit: e.unit, quantity, exact, pieces, rate, cost: rate != null ? Math.round(quantity * rate * 100) / 100 : null, basis }
}

export interface SurfaceArea {
  surfaceId: string
  surfaceName: string
  materialId: string
  areaSqm: number
}

export interface MaterialLine extends QuantityResult {
  materialId: string
  material: VizMaterial
  surfaces: string[]
  areaSqm: number
}

export interface OptionEstimate {
  lines: MaterialLine[]
  areaSqm: number
  /** Sum of priced lines. */
  total: number
  /** Lines without a rate. */
  unpriced: number
}

/**
 * Quantities per material for one option. Surfaces sharing a material are ordered
 * together (one sheet can serve two small shutters).
 */
export function estimateOption(areas: SurfaceArea[], materials: Map<string, VizMaterial>): OptionEstimate {
  const byMaterial = new Map<string, { surfaces: string[]; area: number }>()
  for (const a of areas) {
    if (!materials.has(a.materialId)) continue
    const g = byMaterial.get(a.materialId) ?? { surfaces: [], area: 0 }
    g.surfaces.push(a.surfaceName)
    g.area += a.areaSqm
    byMaterial.set(a.materialId, g)
  }
  const lines: MaterialLine[] = []
  for (const [id, g] of byMaterial) {
    const material = materials.get(id)!
    lines.push({ materialId: id, material, surfaces: g.surfaces, areaSqm: g.area, ...quantityFor(g.area, material) })
  }
  return {
    lines,
    areaSqm: lines.reduce((s, l) => s + l.areaSqm, 0),
    total: lines.reduce((s, l) => s + (l.cost ?? 0), 0),
    unpriced: lines.filter((l) => l.cost == null).length,
  }
}

export function formatQuantity(q: QuantityResult): string {
  const l = UNIT_LABELS[q.unit]
  const n = q.unit === 'sqft' || q.unit === 'sqm' ? fmt(q.quantity, q.unit === 'sqm' ? 2 : 1) : q.quantity.toLocaleString('en-IN')
  return `${n} ${q.quantity === 1 ? l.one : l.many}`
}
