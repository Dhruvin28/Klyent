import { SQFT_PER_SQM, estimateOption, formatQuantity, type OptionEstimate, type SurfaceArea } from '@/lib/visualizer/estimate'
import type { ProposalPrefill } from '@/lib/visualizer/proposalPrefill'
import type { VizMaterial } from '@/lib/visualizer/types'
import { PARAMETRIC } from './defaults'
import { add, pointInPolygon, roomAreaSqm, scale, wallLeftNormal, wallLength } from './geometry'
import { frontAreaSqm } from './parametric'
import type { DesignModel, MatRef, Plan, Vec2 } from './types'

export interface ColorArea {
  hex: string
  surfaces: string[]
  areaSqm: number
}

export interface FurnitureLine {
  name: string
  detail: string
  count: number
  unitPrice: number | null
  amount: number | null
}

export interface DesignBom {
  rooms: { name: string; areaSqm: number }[]
  materials: OptionEstimate
  /** Finishes picked as plain colours (not in the library, so not priced). */
  colors: ColorArea[]
  furniture: FurnitureLine[]
  total: number
}

/** Surface areas per finish, priced through the Visualizer material library. */
export function computeBom(plan: Plan, library: Map<string, VizMaterial>, models: Map<string, DesignModel>): DesignBom {
  const areas: SurfaceArea[] = []
  const colors = new Map<string, ColorArea>()
  const record = (ref: MatRef | null, surfaceId: string, surfaceName: string, areaSqm: number) => {
    if (!ref || areaSqm <= 0) return
    if (ref.kind === 'library') {
      areas.push({ surfaceId, surfaceName, materialId: ref.materialId, areaSqm })
    } else {
      const c = colors.get(ref.hex) ?? { hex: ref.hex, surfaces: [], areaSqm: 0 }
      c.surfaces.push(surfaceName)
      c.areaSqm += areaSqm
      colors.set(ref.hex, c)
    }
  }

  const roomAt = (p: Vec2) => plan.rooms.find((r) => pointInPolygon(p, r.points))?.name ?? null

  const rooms = plan.rooms.map((r) => {
    const a = roomAreaSqm(r, plan.walls)
    record(r.floor, `${r.id}:floor`, `${r.name} floor`, a)
    record(r.ceiling, `${r.id}:ceiling`, `${r.name} ceiling`, a)
    return { name: r.name, areaSqm: a }
  })

  for (const w of plan.walls) {
    const L = wallLength(w)
    const H = w.height ?? plan.wallHeight
    const holes = plan.openings
      .filter((o) => o.wallId === w.id)
      .reduce((s, o) => s + Math.min(o.width, L - 20) * Math.min(o.height, H - o.sill), 0)
    const net = Math.max(0, L * H - holes) / 1e6
    const mid = scale(add(w.a, w.b), 0.5)
    const n = wallLeftNormal(w)
    for (const side of ['left', 'right'] as const) {
      const s = side === 'left' ? 1 : -1
      const room = roomAt(add(mid, scale(n, s * (w.thickness / 2 + 60))))
      record(w[side], `${w.id}:${side}`, room ? `${room} wall` : 'Exterior wall', net)
    }
  }

  const furniture = new Map<string, FurnitureLine>()
  for (const it of plan.items) {
    const dims = `${Math.round(it.width)}×${Math.round(it.depth)}×${Math.round(it.height)} mm`
    if (it.source.kind === 'parametric') {
      const type = it.source.type
      const front = frontAreaSqm(type, it)
      if (front > 0) record(it.materials.shutter ?? PARAMETRIC[type].slots.shutter?.default ?? null, `${it.id}:shutter`, `${it.name} shutters`, front)
      if (type === 'base_cabinet') record(it.materials.top ?? null, `${it.id}:top`, `${it.name} countertop`, (it.width * (it.depth + 20)) / 1e6)
      const key = `p:${it.name}:${dims}`
      const line = furniture.get(key) ?? { name: it.name, detail: `${dims} (made to order)`, count: 0, unitPrice: null, amount: null }
      line.count++
      furniture.set(key, line)
    } else {
      const m = models.get(it.source.modelId)
      const key = `m:${it.source.modelId}`
      const price = m?.price ?? null
      const line = furniture.get(key) ?? { name: m?.name ?? it.name, detail: [m?.brand, dims].filter(Boolean).join(' · '), count: 0, unitPrice: price, amount: null }
      line.count++
      line.amount = price != null ? price * line.count : null
      furniture.set(key, line)
    }
  }

  const materials = estimateOption(areas, library)
  const furnitureLines = [...furniture.values()]
  return {
    rooms,
    materials,
    colors: [...colors.values()],
    furniture: furnitureLines,
    total: materials.total + furnitureLines.reduce((s, l) => s + (l.amount ?? 0), 0),
  }
}

const money = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const sqft = (sqm: number) => `${(sqm * SQFT_PER_SQM).toLocaleString('en-IN', { maximumFractionDigits: 1 })} sq ft`

/** Cost-breakup proposal draft (same hand-off the Material Visualizer uses). */
export function bomToProposal(projectName: string, clientId: string | null, bom: DesignBom): ProposalPrefill {
  const items: { srNo: number; description: string; rate: string }[] = []
  for (const l of bom.materials.lines) {
    const m = l.material
    const ref = [m.brand, m.code].filter(Boolean).join(' ')
    items.push({
      srNo: items.length + 1,
      description: `${l.surfaces.join(', ')} — ${m.name}${ref ? ` (${ref})` : ''}: ${sqft(l.areaSqm)}, ${formatQuantity(l)}`.slice(0, 500),
      rate: l.rate != null ? `${money(l.rate)} / ${l.unit === 'sqft' ? 'sq ft' : l.unit === 'sqm' ? 'm²' : l.unit}`.slice(0, 100) : '',
    })
  }
  for (const c of bom.colors) {
    items.push({ srNo: items.length + 1, description: `${c.surfaces.join(', ')} — colour ${c.hex.toUpperCase()}: ${sqft(c.areaSqm)}`.slice(0, 500), rate: '' })
  }
  for (const f of bom.furniture) {
    items.push({
      srNo: items.length + 1,
      description: `${f.name} × ${f.count} — ${f.detail}`.slice(0, 500),
      rate: f.unitPrice != null ? `${money(f.unitPrice)} each` : '',
    })
  }
  return {
    source: { projectName, optionName: '3D design', clientId },
    materialSection: { title: `Materials & furniture — ${projectName}`.slice(0, 100), rateLabel: 'Rate', items },
    costBreakupItems: [
      ...bom.materials.lines
        .filter((l) => l.cost != null)
        .map((l) => ({ item: l.material.name.slice(0, 200), description: `${l.surfaces.join(', ')}: ${formatQuantity(l)} (${l.basis})`.slice(0, 1000), amount: l.cost! })),
      ...bom.furniture
        .filter((f) => f.amount != null)
        .map((f) => ({ item: f.name.slice(0, 200), description: `${f.count} × ${money(f.unitPrice!)} — ${f.detail}`.slice(0, 1000), amount: f.amount! })),
    ],
  }
}
