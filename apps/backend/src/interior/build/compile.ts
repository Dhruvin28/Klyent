import { clampOpeningOffset, findEnclosures, interiorPoint, pointInPolygon, projectToSegment, wallDir, wallLeftNormal, wallLength } from '../../designer/geometry'
import { defaultPlan, PARAMETRIC_TYPES, planSchema, type ParametricType, type Plan, type Wall } from '../../designer/plan'
import { parseDimension } from '../dimensions'
import type {
  Assumption,
  CalibrationOverride,
  Constraint,
  ElevationAssignment,
  Evidence,
  PageExtraction,
  PageInterpretation,
  PageRole,
  Pt,
  RegistrationOverride,
  SceneDoc,
  SourcePage,
} from '../contracts'
import { PLAN_VIEW_ROLES } from '../contracts'
import { calibratePage } from '../geometry/calibrate'
import { registerPage } from '../geometry/register'
import { decodeGray, refineWalls, SegmentIndex } from '../geometry/refine'

export interface CompilePage {
  pageId: string
  documentId: string
  documentName: string
  pageIndex: number
  role: PageRole
  title: string | null
  extraction: PageExtraction
  interpretation: PageInterpretation | null
  interpretationMeta: { model: string; promptVersion: string } | null
  calibrationOverride: CalibrationOverride | null
  assignment: ElevationAssignment | null
  registrationOverride: RegistrationOverride | null
  vectors: Float32Array | null
  loadImage: () => Promise<Buffer>
}

export interface CompileInput {
  referencePageId: string | null
  pages: CompilePage[]
}

const round = (n: number) => Math.round(n * 1000) / 1000
const objectId = (pageId: string, local: string) => `${pageId}:${local}`
const sourceRegion = (pts: Pt[]): [number, number, number, number] => [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))]

function itemType(category: string): ParametricType {
  if ((PARAMETRIC_TYPES as readonly string[]).includes(category)) return category as ParametricType
  if (category === 'armchair') return 'chair'
  if (category === 'dining_table' || category === 'coffee_table' || category === 'side_table' || category === 'desk') return 'table'
  if (category === 'dresser' || category === 'kitchen_counter') return 'base_cabinet'
  return 'box'
}

function defaultItemHeight(category: string) {
  if (category === 'wardrobe' || category === 'tall_unit') return 2400
  if (category === 'wall_cabinet') return 750
  if (category === 'base_cabinet' || category === 'kitchen_counter' || category === 'dresser') return 850
  if (category === 'bed' || category === 'sofa' || category === 'armchair') return 750
  if (category.includes('table') || category === 'desk') return 750
  if (category === 'chair') return 900
  return 1000
}

function nearestFaceAnchor(walls: Wall[], p: Pt, dir: Pt) {
  const target = p.x * dir.x + p.y * dir.y
  let best: { wallId: string; offset: number; error: number } | null = null
  for (const wall of walls) {
    const wd = wallDir(wall)
    if (Math.abs(wd.x * dir.x + wd.y * dir.y) > 0.2) continue
    const n = wallLeftNormal(wall)
    for (const offset of [-wall.thickness / 2, wall.thickness / 2]) {
      const coord = (wall.a.x + n.x * offset) * dir.x + (wall.a.y + n.y * offset) * dir.y
      const error = Math.abs(coord - target)
      if (!best || error < best.error) best = { wallId: wall.id, offset, error }
    }
  }
  return best && best.error <= 75 ? { kind: 'wall_face' as const, wallId: best.wallId, offset: best.offset } : null
}

function addEvidence(scene: SceneDoc, id: string, property: string, evidence: Evidence) {
  const byProperty = (scene.evidence[id] ??= {})
  ;(byProperty[property] ??= []).push(evidence)
}

/** Compiles calibrated drawing interpretations into the designer's canonical plan. */
export async function compileScene(input: CompileInput): Promise<SceneDoc> {
  const plan = defaultPlan()
  plan.ceilings = []
  plan.panels = []
  plan.fixtures = []
  const scene: SceneDoc = {
    schemaVersion: 'interior-scene/1', referencePageId: input.referencePageId, plan,
    evidence: {}, objectSources: {}, constraints: [], assumptions: [], registrations: [], unsupported: [], sources: [], aiIssues: [], acceptances: [], review: [], buildLog: [],
  }
  const calibrated = input.pages.map((page) => ({ page, calibration: calibratePage(page.extraction, page.interpretation, page.calibrationOverride) }))
  scene.sources = calibrated.map(({ page, calibration }): SourcePage => ({
    pageId: page.pageId, documentId: page.documentId, documentName: page.documentName, pageIndex: page.pageIndex,
    role: page.role, title: page.title, calibration, interpretation: page.interpretationMeta,
  }))
  const ref = calibrated.find((x) => x.page.pageId === input.referencePageId && x.page.interpretation && x.calibration.mmPerPx)
    ?? calibrated.find((x) => x.page.role === 'floor_plan' && x.page.interpretation && x.calibration.mmPerPx)
  const offsets = new Map<string, Pt>()
  for (const { page, calibration } of calibrated) {
    if (!page.interpretation || !calibration.mmPerPx || !PLAN_VIEW_ROLES.has(page.role)) continue
    if (!ref || page.pageId === ref.page.pageId) {
      offsets.set(page.pageId, { x: 0, y: 0 })
      scene.registrations.push({ pageId: page.pageId, role: page.role, offsetMm: { x: 0, y: 0 }, method: 'reference', anchors: 0, residualMm: 0, status: 'verified' })
    } else if (ref.page.interpretation && ref.calibration.mmPerPx) {
      const registration = registerPage({ it: ref.page.interpretation, mmPerPx: ref.calibration.mmPerPx }, { pageId: page.pageId, role: page.role, it: page.interpretation, mmPerPx: calibration.mmPerPx }, page.registrationOverride)
      offsets.set(page.pageId, registration.offsetMm)
      scene.registrations.push(registration)
    }
  }

  // Geometry comes from the reference floor plan. Other plan sheets contribute details.
  const base = ref
  if (base?.page.interpretation && base.calibration.mmPerPx) {
    const page = base.page, it = base.page.interpretation!, mm = base.calibration.mmPerPx
    const off = offsets.get(page.pageId) ?? { x: 0, y: 0 }
    let gray = null
    if (!page.vectors) {
      try { gray = decodeGray(await page.loadImage()) } catch { scene.buildLog.push(`Could not decode ${page.documentName} p${page.pageIndex + 1} for raster refinement.`) }
    }
    const refined = refineWalls(it.walls, { index: page.vectors ? new SegmentIndex(page.vectors) : null, gray })
    const localWalls = new Map<string, Wall>()
    for (const w of refined) {
      const id = objectId(page.pageId, w.id)
      const wall: Wall = { id, a: { x: round(w.a.x * mm + off.x), y: round(w.a.y * mm + off.y) }, b: { x: round(w.b.x * mm + off.x), y: round(w.b.y * mm + off.y) }, thickness: round(w.thicknessPx * mm), height: null, left: null, right: null }
      if (wallLength(wall) < 10 || wall.thickness < 1) continue
      plan.walls.push(wall); localWalls.set(w.id, wall)
      scene.objectSources[id] = [{ pageId: page.pageId, region: sourceRegion([w.a, w.b]) }]
      addEvidence(scene, id, 'geometry', { kind: w.method === 'ai' ? 'ai_interpreted' : 'derived', pageId: page.pageId, region: sourceRegion([w.a, w.b]), note: `${w.method} wall refinement` })
      if (w.confidence < 0.7) scene.review.push({ objectId: id, confidence: w.confidence })
    }
    const enclosures = findEnclosures(plan.walls)
    for (let i = 0; i < enclosures.length; i++) {
      const enclosure = enclosures[i]
      const inside = interiorPoint(enclosure.points)
      const label = it.rooms.find((r) => pointInPolygon({ x: (inside.x - off.x) / mm, y: (inside.y - off.y) / mm }, r.polygon))
        ?? it.rooms.find((r) => pointInPolygon({ x: r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length * mm + off.x, y: r.polygon.reduce((s, p) => s + p.y, 0) / r.polygon.length * mm + off.y }, enclosure.points))
      const id = objectId(page.pageId, `room-${i + 1}`)
      plan.rooms.push({ id, name: label?.label || `Room ${i + 1}`, points: enclosure.points.map((p) => ({ x: round(p.x), y: round(p.y) })), floor: null, ceiling: null })
      if (label) scene.objectSources[id] = [{ pageId: page.pageId, region: sourceRegion(label.polygon) }]
    }
    for (let i = 0; i < it.openings.length; i++) {
      const o = it.openings[i], wall = o.wallRef ? localWalls.get(o.wallRef) : undefined
      const nearest = wall ?? plan.walls.map((w) => ({ w, d: projectToSegment({ x: o.center.x * mm + off.x, y: o.center.y * mm + off.y }, w.a, w.b).distance })).sort((a, b) => a.d - b.d)[0]?.w
      if (!nearest) continue
      const center = { x: o.center.x * mm + off.x, y: o.center.y * mm + off.y }
      const projected = projectToSegment(center, nearest.a, nearest.b)
      const width = round(o.widthPx * mm), id = objectId(page.pageId, `opening-${i + 1}`)
      plan.openings.push({ id, wallId: nearest.id, type: o.type === 'window' ? 'window' : o.type === 'opening' ? 'opening' : 'door', offset: round(clampOpeningOffset(projected.t * wallLength(nearest), width, wallLength(nearest))), width, height: o.type === 'window' ? 1200 : 2100, sill: o.type === 'window' ? 900 : 0, flip: o.swing === 'right' })
      scene.objectSources[id] = [{ pageId: page.pageId, region: [o.center.x - o.widthPx / 2, o.center.y - 10, o.center.x + o.widthPx / 2, o.center.y + 10] }]
      scene.assumptions.push({ id: `assumption:${id}:height`, group: o.type === 'window' ? 'window_height' : o.type === 'opening' ? 'opening_height' : 'door_height', objectIds: [id], property: 'height', value: o.type === 'window' ? 1200 : 2100, unit: 'mm', reason: 'Opening height is not shown on the floor plan.', blockingInStrict: true })
      if (o.type === 'window') scene.assumptions.push({ id: `assumption:${id}:sill`, group: 'window_sill', objectIds: [id], property: 'sill', value: 900, unit: 'mm', reason: 'Window sill is not shown on the floor plan.', blockingInStrict: true })
      if (o.confidence < 0.7) scene.review.push({ objectId: id, confidence: o.confidence })
    }
    for (let i = 0; i < it.furniture.length; i++) {
      const f = it.furniture[i], id = objectId(page.pageId, `item-${i + 1}`), height = defaultItemHeight(f.category)
      plan.items.push({ id, name: f.label || f.category, source: { kind: 'parametric', type: itemType(f.category) }, x: round(f.center.x * mm + off.x), y: round(f.center.y * mm + off.y), elevation: 0, rotation: f.rotationDeg, width: round(f.widthPx * mm), depth: round(f.depthPx * mm), height, params: {}, materials: {} })
      scene.objectSources[id] = [{ pageId: page.pageId, region: [f.center.x - f.widthPx / 2, f.center.y - f.depthPx / 2, f.center.x + f.widthPx / 2, f.center.y + f.depthPx / 2] }]
      scene.assumptions.push({ id: `assumption:${id}:height`, group: ['wardrobe', 'dresser', 'base_cabinet', 'wall_cabinet', 'tall_unit', 'kitchen_counter', 'shelf', 'tv_unit'].includes(f.category) ? 'joinery_height' : 'furniture_height', objectIds: [id], property: 'height', value: height, unit: 'mm', reason: 'Item height is not shown in plan.', blockingInStrict: true })
      if (f.confidence < 0.7) scene.review.push({ objectId: id, confidence: f.confidence })
    }
    // Written dimensions become constraints between the closest reconstructed wall faces.
    for (let i = 0; i < it.dimensions.length; i++) {
      const d = it.dimensions[i]
      const parsed = parseDimension(page.extraction.texts.find((t) => t.id === d.textId)?.text ?? d.readText, base.calibration.units)
      if (!parsed.ok || parsed.kind !== 'length') continue
      const dx = d.p2.x - d.p1.x, dy = d.p2.y - d.p1.y, l = Math.hypot(dx, dy)
      if (l < 1) continue
      const dir = { x: dx / l, y: dy / l }
      const p1 = { x: d.p1.x * mm + off.x, y: d.p1.y * mm + off.y }, p2 = { x: d.p2.x * mm + off.x, y: d.p2.y * mm + off.y }
      const a = nearestFaceAnchor(plan.walls, p1, dir), b = nearestFaceAnchor(plan.walls, p2, dir)
      if (!a || !b || a.wallId === b.wallId) continue
      const c: Constraint = { id: objectId(page.pageId, `dimension-${i + 1}`), label: d.readText || `${parsed.value} mm`, refs: { kind: 'distance', dir, a, b }, expected: parsed.value, unit: 'mm', tolerance: Math.max(2, parsed.value * 0.002), authority: d.textId ? 'dimension_text' : 'annotation', source: { pageId: page.pageId, textId: d.textId ?? undefined, text: d.readText, region: sourceRegion([d.p1, d.p2]) } }
      scene.constraints.push(c)
    }
  }

  plan.wallHeight = 2700
  scene.assumptions.push({ id: 'assumption:plan:wallHeight', group: 'ceiling_height', objectIds: ['plan'], property: 'wallHeight', value: 2700, unit: 'mm', reason: 'No authoritative ceiling height was found.', blockingInStrict: true })
  for (const { page } of calibrated) {
    for (const [i, issue] of (page.interpretation?.issues ?? []).entries()) scene.aiIssues.push({ pageId: page.pageId, kind: issue.kind, message: issue.message, region: issue.at ? [issue.at.x, issue.at.y, issue.at.x, issue.at.y] : null })
    for (const [i, kind] of (page.extraction.dxf ? Object.keys(page.extraction.dxf.unsupported) : []).entries()) scene.unsupported.push({ id: objectId(page.pageId, `unsupported-${i + 1}`), pageId: page.pageId, kind, message: `${kind} entities are not reconstructed.` })
  }
  scene.plan = planSchema.parse(plan)
  scene.buildLog.push(`Compiled ${plan.walls.length} walls, ${plan.rooms.length} rooms, ${plan.openings.length} openings and ${plan.items.length} items from ${input.pages.length} page(s).`)
  return scene
}
