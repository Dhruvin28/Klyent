// Interior 3D contracts: page extraction, AI interpretation, canonical scene,
// validation. Coordinates:
//  - page px: the stored page raster, origin top-left, y down.
//  - plan mm: the designer Plan space (x right, y down, millimetres). This is the
//    canonical design space for this repository (plan §8.1 is adapted to the existing
//    designer convention). Conversions to other spaces:
//      Three.js/glTF metres: (x, y) plan, z height → (x/1000, z/1000, y/1000)
//      Right-handed Z-up (plan §8.1 canonical): (x, y, z) → (x, -y, z)
import type { Plan } from '../designer/plan'
import type { DrawingUnits } from './dimensions'

export const PAGE_ROLES = [
  'floor_plan',
  'furniture_layout',
  'reflected_ceiling_plan',
  'electrical_plan',
  'elevation',
  'section',
  'detail',
  'schedule',
  'other',
] as const
export type PageRole = (typeof PAGE_ROLES)[number]

/** Roles drawn in plan view that share the floor-plan coordinate system after registration. */
export const PLAN_VIEW_ROLES: ReadonlySet<PageRole> = new Set(['floor_plan', 'furniture_layout', 'reflected_ceiling_plan', 'electrical_plan'])

export type Box = [number, number, number, number] // x0, y0, x1, y1
export interface Pt {
  x: number
  y: number
}

// ── Extraction ──────────────────────────────────────────────────────────

export interface TextToken {
  id: string
  text: string
  /** page px */
  bbox: Box
  source: 'pdf' | 'ocr' | 'dxf'
  /** OCR confidence 0..1 (pdf/dxf text is exact). */
  confidence: number
  vertical: boolean
}

/** A CAD DIMENSION entity: exact measured value and definition points (page px). */
export interface CadDimension {
  id: string
  /** Measured value in drawing units (exact). */
  measured: number
  /** Measured value in mm when the drawing declares its units. */
  measuredMm: number | null
  /** Text shown on the drawing when it overrides the measurement. */
  displayText: string | null
  p1: Pt
  p2: Pt
  layer: string | null
}

export interface PageExtraction {
  version: 1
  source: 'pdf_vector' | 'pdf_raster' | 'image' | 'dxf'
  width: number
  height: number
  /** preview px = page px × previewScale */
  previewScale: number
  pdf: { widthPt: number; heightPt: number; pxPerPt: number } | null
  dxf: {
    insUnits: number
    mmPerUnit: number | null
    pxPerUnit: number
    mmPerPx: number | null
    layers: string[]
    unsupported: Record<string, number>
  } | null
  texts: TextToken[]
  cadDimensions: CadDimension[]
  vectorCount: number
  unitsFromNotes: DrawingUnits
  warnings: string[]
}

// ── AI interpretation (stored in page px after mapping from preview px) ──

export const FURNITURE_CATEGORIES = [
  'sofa',
  'armchair',
  'bed',
  'wardrobe',
  'dresser',
  'dining_table',
  'coffee_table',
  'side_table',
  'desk',
  'table',
  'chair',
  'tv_unit',
  'base_cabinet',
  'wall_cabinet',
  'tall_unit',
  'kitchen_counter',
  'shelf',
  'appliance',
  'sanitary',
  'plant',
  'rug',
  'other',
] as const
export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number]

export const LIGHT_KINDS = ['downlight', 'spot', 'pendant', 'chandelier', 'wall_light', 'strip', 'fan', 'other'] as const
export const CEILING_KINDS = ['flat_drop', 'tray_perimeter', 'bulkhead', 'cove', 'other'] as const
export const ELEVATION_FEATURE_KINDS = [
  'panel',
  'wardrobe',
  'tv_unit',
  'base_cabinet',
  'wall_cabinet',
  'tall_unit',
  'shelf',
  'headboard',
  'mirror',
  'door',
  'window',
  'opening',
  'other',
] as const
export const SECTION_LEVEL_KINDS = ['finished_floor', 'false_ceiling', 'slab_soffit', 'drop_underside', 'cove', 'other'] as const

export interface AiWall {
  id: string
  a: Pt
  b: Pt
  thicknessPx: number
  kind: 'exterior' | 'interior' | 'partition'
  confidence: number
}
export interface AiOpening {
  wallRef: string | null
  type: 'door' | 'sliding_door' | 'window' | 'opening'
  center: Pt
  widthPx: number
  swing: 'left' | 'right' | 'none' | 'unknown'
  labelTextId: string | null
  confidence: number
}
export interface AiRoom {
  label: string
  polygon: Pt[]
  labelTextId: string | null
  ceilingHeightTextId: string | null
}
export interface AiFurniture {
  label: string
  category: FurnitureCategory
  center: Pt
  widthPx: number
  depthPx: number
  /** Clockwise degrees in the drawing; 0 = the item's front faces down the page. */
  rotationDeg: number
  sizeTextId: string | null
  confidence: number
}
export interface AiDimension {
  textId: string | null
  readText: string
  p1: Pt
  p2: Pt
  confidence: number
}
export interface AiCeilingZone {
  label: string
  kind: (typeof CEILING_KINDS)[number]
  polygon: Pt[]
  levelTextId: string | null
  levelText: string | null
  hasCoveLight: boolean
}
export interface AiLight {
  kind: (typeof LIGHT_KINDS)[number]
  at: Pt
  labelTextId: string | null
}
export interface AiElevationFeature {
  kind: (typeof ELEVATION_FEATURE_KINDS)[number]
  x0: number
  x1: number
  /** top / bottom in page px (top < bottom). */
  yTop: number
  yBottom: number
  divisions: number | null
  label: string
}
export interface AiElevation {
  title: string
  wallHint: string | null
  leftX: number
  rightX: number
  floorY: number
  ceilingY: number
  features: AiElevationFeature[]
  heightDimensions: AiDimension[]
}
export interface AiSectionLevel {
  kind: (typeof SECTION_LEVEL_KINDS)[number]
  textId: string | null
  readText: string
}
export interface AiIssue {
  kind: 'unreadable' | 'ambiguous' | 'conflict' | 'missing' | 'unsupported'
  message: string
  at: Pt | null
}

export interface PageInterpretation {
  sheet: {
    kind: PageRole
    title: string | null
    scaleNote: string | null
    unitsHint: DrawingUnits
    notes: string[]
  }
  walls: AiWall[]
  openings: AiOpening[]
  rooms: AiRoom[]
  furniture: AiFurniture[]
  dimensions: AiDimension[]
  ceilingZones: AiCeilingZone[]
  lights: AiLight[]
  elevation: AiElevation | null
  sectionLevels: AiSectionLevel[]
  issues: AiIssue[]
  /** Evidence ids the model returned that were not in the supplied input (rejected). */
  rejectedRefs: string[]
}

export interface InterpretationMeta {
  model: string
  reasoningEffort: string
  promptVersion: string
  responseId: string | null
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number } | null
  latencyMs: number
  cached: boolean
  at: string
}

// ── Page-level designer decisions ───────────────────────────────────────

export interface CalibrationOverride {
  units?: DrawingUnits
  /** Manual two-point calibration in page px. */
  manual?: { p1: Pt; p2: Pt; distanceMm: number } | null
}

export interface ElevationAssignment {
  roomLabel: string
  /** Wall the viewer faces, as plan compass (N = plan top). */
  side: 'N' | 'E' | 'S' | 'W'
}

export interface RegistrationOverride {
  dxMm: number
  dyMm: number
}

export interface Calibration {
  mmPerPx: number | null
  method: 'cad_units' | 'dimensions' | 'scale_note' | 'manual' | 'none'
  status: 'verified' | 'provisional' | 'missing'
  units: DrawingUnits
  unitsSource: 'manual' | 'notes' | 'ai' | 'inferred' | 'cad' | 'unknown'
  samples: { textId: string | null; text: string; mm: number; px: number; ratio: number; inlier: boolean; authority: 'cad' | 'text' | 'vision' }[]
  /** Max relative deviation of inlier ratios from the fit. */
  spread: number | null
  scaleNoteRatio: number | null
  notes: string[]
}

export interface Registration {
  pageId: string
  role: PageRole
  offsetMm: Pt
  method: 'reference' | 'room_labels' | 'extents' | 'manual' | 'none'
  anchors: number
  residualMm: number | null
  status: 'verified' | 'unverified' | 'failed'
}

// ── Canonical scene ────────────────────────────────────────────────────

export type EvidenceKind = 'extracted' | 'ai_interpreted' | 'designer_decision' | 'default_assumption' | 'derived' | 'designer_edit'

export interface Evidence {
  kind: EvidenceKind
  pageId?: string
  region?: Box
  textId?: string
  text?: string
  value?: unknown
  note?: string
  decisionId?: string
}

export type Anchor = { kind: 'wall_face'; wallId: string; offset: number } | { kind: 'opening_edge'; openingId: string; edge: 'start' | 'end' }

export type ConstraintRefs =
  | { kind: 'distance'; dir: Pt; a: Anchor; b: Anchor }
  | { kind: 'opening_width'; openingId: string }
  | { kind: 'item_size'; itemId: string; dim: 'width' | 'depth' | 'height' }
  | { kind: 'ceiling_height' }
  | { kind: 'ceiling_level'; ceilingId: string }
  | { kind: 'fixture_count'; region: Pt[] | null; pageId: string }
  | { kind: 'elevation_width'; roomId: string; side: 'N' | 'E' | 'S' | 'W' }

export interface Constraint {
  id: string
  label: string
  refs: ConstraintRefs
  expected: number
  unit: 'mm' | 'count'
  /** Absolute tolerance in `unit`. */
  tolerance: number
  authority: 'cad_dimension' | 'dimension_text' | 'annotation' | 'elevation' | 'designer_decision'
  source: { pageId: string; textId?: string; text?: string; region?: Box }
}

export interface Assumption {
  id: string
  group: string
  objectIds: string[]
  property: string
  value: number
  unit: 'mm' | 'K'
  reason: string
  blockingInStrict: boolean
}

export interface Unsupported {
  id: string
  pageId: string
  kind: string
  message: string
  region?: Box
}

export interface SourcePage {
  pageId: string
  documentId: string
  documentName: string
  pageIndex: number
  role: PageRole
  title: string | null
  calibration: Calibration
  interpretation: { model: string; promptVersion: string } | null
}

export interface SceneDoc {
  schemaVersion: string
  referencePageId: string | null
  plan: Plan
  evidence: Record<string, Record<string, Evidence[]>>
  /** Where each object was seen, for 3D ↔ source highlighting. */
  objectSources: Record<string, { pageId: string; region: Box }[]>
  constraints: Constraint[]
  assumptions: Assumption[]
  registrations: Registration[]
  unsupported: Unsupported[]
  sources: SourcePage[]
  aiIssues: { pageId: string; kind: string; message: string; region: Box | null }[]
  /** Designer decisions that change how validation treats a check. */
  acceptances: { key: string; decisionId: string; rationale: string }[]
  /** Low-confidence detections the designer should review. */
  review: { objectId: string; confidence: number }[]
  buildLog: string[]
}

// ── Validation ─────────────────────────────────────────────────────────

export type Severity = 'blocking' | 'warning' | 'info'

export interface Question {
  kind: 'number' | 'confirm' | 'choice'
  label: string
  unit?: 'mm'
  defaultValue?: number | string
  options?: { value: string; label: string }[]
  /** Command template the answer is applied through. `value` is filled from the answer. */
  command: Record<string, unknown>
}

export interface Issue {
  id: string
  code: string
  severity: Severity
  message: string
  objectIds: string[]
  pageId?: string
  region?: Box | null
  expected?: number | string | null
  observed?: number | string | null
  deviation?: number | null
  /** Key a designer can accept (deviation/acknowledgement) via a decision. */
  acceptKey?: string
  question?: Question
}

export interface Check {
  id: string
  category: 'units' | 'walls' | 'openings' | 'furniture' | 'ceiling' | 'lighting' | 'paneling' | 'registration' | 'completeness' | 'geometry'
  label: string
  expected: string | number | null
  observed: string | number | null
  outcome: 'pass' | 'fail' | 'missing' | 'accepted' | 'warning'
  objectIds: string[]
}

export interface ValidationResult {
  status: 'passed' | 'passed_with_warnings' | 'blocked'
  checks: Check[]
  issues: Issue[]
  summary: { blocking: number; warnings: number; info: number; checksPassed: number; checksTotal: number }
}

export const VALIDATOR_VERSION = 'interior-validator/1'
