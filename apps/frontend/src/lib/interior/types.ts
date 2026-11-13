// Frontend mirror of apps/backend/src/interior/contracts.ts (only what the UI reads).
import type { Plan } from '@/lib/designer/types'

export const PAGE_ROLES = ['floor_plan', 'furniture_layout', 'reflected_ceiling_plan', 'electrical_plan', 'elevation', 'section', 'detail', 'schedule', 'other'] as const
export type PageRole = (typeof PAGE_ROLES)[number]
export const ROLE_LABEL: Record<PageRole, string> = {
  floor_plan: 'Floor plan',
  furniture_layout: 'Furniture layout',
  reflected_ceiling_plan: 'Ceiling plan (RCP)',
  electrical_plan: 'Electrical plan',
  elevation: 'Wall elevation',
  section: 'Section',
  detail: 'Detail',
  schedule: 'Schedule',
  other: 'Other',
}
export const PLAN_VIEW_ROLES = new Set<PageRole>(['floor_plan', 'furniture_layout', 'reflected_ceiling_plan', 'electrical_plan'])

export type Units = 'mm' | 'cm' | 'm' | 'ft_in' | 'unknown'
export type Box = [number, number, number, number]
export interface Pt {
  x: number
  y: number
}

export interface TextToken {
  id: string
  text: string
  bbox: Box
  source: 'pdf' | 'ocr' | 'dxf'
  confidence: number
  vertical: boolean
}

export interface PageExtraction {
  source: 'pdf_vector' | 'pdf_raster' | 'image' | 'dxf'
  width: number
  height: number
  previewScale: number
  pdf: { widthPt: number; heightPt: number; pxPerPt: number } | null
  dxf: { insUnits: number; mmPerUnit: number | null; pxPerUnit: number; mmPerPx: number | null; layers: string[]; unsupported: Record<string, number> } | null
  texts: TextToken[]
  cadDimensions: { id: string; measured: number; measuredMm: number | null; displayText: string | null; p1: Pt; p2: Pt }[]
  vectorCount: number
  unitsFromNotes: Units
  warnings: string[]
}

export interface PageInterpretation {
  sheet: { kind: PageRole; title: string | null; scaleNote: string | null; unitsHint: Units; notes: string[] }
  walls: { id: string; a: Pt; b: Pt; thicknessPx: number; kind: string; confidence: number }[]
  openings: { wallRef: string | null; type: string; center: Pt; widthPx: number; swing: string; confidence: number }[]
  rooms: { label: string; polygon: Pt[]; labelTextId: string | null }[]
  furniture: { label: string; category: string; center: Pt; widthPx: number; depthPx: number; rotationDeg: number; confidence: number }[]
  dimensions: { textId: string | null; readText: string; p1: Pt; p2: Pt; confidence: number }[]
  ceilingZones: { label: string; kind: string; polygon: Pt[]; levelText: string | null; levelTextId: string | null; hasCoveLight: boolean }[]
  lights: { kind: string; at: Pt }[]
  elevation: {
    title: string
    wallHint: string | null
    leftX: number
    rightX: number
    floorY: number
    ceilingY: number
    features: { kind: string; x0: number; x1: number; yTop: number; yBottom: number; divisions: number | null; label: string }[]
    heightDimensions: { textId: string | null; readText: string; p1: Pt; p2: Pt }[]
  } | null
  sectionLevels: { kind: string; textId: string | null; readText: string }[]
  issues: { kind: string; message: string; at: Pt | null }[]
  rejectedRefs: string[]
}

export interface Calibration {
  mmPerPx: number | null
  method: 'cad_units' | 'dimensions' | 'scale_note' | 'manual' | 'none'
  status: 'verified' | 'provisional' | 'missing'
  units: Units
  unitsSource: string
  samples: { textId: string | null; text: string; mm: number; px: number; ratio: number; inlier: boolean; authority: string }[]
  spread: number | null
  scaleNoteRatio: number | null
  notes: string[]
}

export interface ElevationAssignment {
  roomLabel: string
  side: 'N' | 'E' | 'S' | 'W'
}

export interface PageMeta {
  id: string
  workspaceId: string
  documentId: string
  pageIndex: number
  width: number
  height: number
  previewWidth: number
  previewHeight: number
  role: PageRole | null
  suggestedRole: PageRole | null
  effectiveRole: PageRole
  title: string | null
  status: 'extracted' | 'interpreting' | 'interpreted' | 'failed' | 'excluded'
  interpretationKey: string | null
  interpretationMeta: { model: string; reasoningEffort: string; usage: { inputTokens: number; outputTokens: number; reasoningTokens: number } | null; latencyMs: number; cached?: boolean; at: string } | null
  calibration: { units?: Units; manual?: { p1: Pt; p2: Pt; distanceMm: number } | null } | null
  assignment: ElevationAssignment | null
  registration: { dxMm: number; dyMm: number } | null
  error: string | null
}

export interface PageDetail extends PageMeta {
  extraction: PageExtraction
  interpretation: PageInterpretation | null
  computedCalibration: Calibration
  hasVectors: boolean
}

export interface InteriorDocument {
  id: string
  name: string
  kind: 'pdf' | 'image' | 'dxf'
  size: number
  status: 'queued' | 'uploaded' | 'extracting' | 'ready' | 'failed'
  pageCount: number
  revisionLabel: string | null
  preflight: { pages: { source: string; width: number; height: number; texts: number; vectors: number; warnings: string[] }[] } | null
  error: string | null
  createdAt: string
}

export interface InteriorJob {
  id: string
  type: 'extract_document' | 'interpret_page' | 'build_scene'
  targetId: string
  status: 'queued' | 'running' | 'retry_wait' | 'succeeded' | 'failed' | 'canceled'
  attempt: number
  maxAttempts: number
  progress: { stage?: string; page?: number; total?: number; model?: string } | null
  errorCode: string | null
  error: string | null
  result: Record<string, unknown> | null
  createdAt: string
  finishedAt: string | null
}

export interface RevisionSummary {
  id: string
  revisionNo: number
  origin: 'build' | 'command' | 'designer_sync' | 'fork'
  status: 'draft' | 'frozen'
  sceneHash: string | null
  summary: Record<string, number> | null
  lockVersion: number
  parentRevisionId: string | null
  sealedAt: string | null
  createdAt: string
}

export interface Approval {
  id: string
  revisionId: string
  validationRunId: string
  sceneHash: string
  mode: 'final' | 'draft'
  note: string | null
  approvedAt: string
}

export interface Workspace {
  id: string
  name: string
  mode: 'strict' | 'draft'
  clientId: string | null
  referencePageId: string | null
  latestRevisionId: string | null
  approvedRevisionId: string | null
  designProjectId: string | null
  designerPushedRevision: number | null
  autoBuild: boolean
  lockVersion: number
  createdAt: string
  updatedAt: string
}

export type WorkspaceStatus = 'empty' | 'processing' | 'needs_review' | 'draft_ready' | 'ready_for_approval' | 'approved'

export interface WorkspaceSummary {
  workspace: Workspace
  status: WorkspaceStatus
  documents: InteriorDocument[]
  pages: PageMeta[]
  jobs: InteriorJob[]
  revisions: RevisionSummary[]
  approvals: Approval[]
  latestValidation: { id: string; revisionId: string; status: ValidationStatus; summary: ValidationSummary; createdAt: string } | null
  ai: { configured: boolean; model: string; reasoningEffort: string }
}

export interface WorkspaceListItem {
  id: string
  name: string
  mode: 'strict' | 'draft'
  clientId: string | null
  clientName: string | null
  designProjectId: string | null
  approvedRevisionId: string | null
  latestRevisionId: string | null
  documents: number
  thumbPageId: string | null
  createdAt: string
  updatedAt: string
}

// ── Scene / validation ──

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

export interface Registration {
  pageId: string
  role: PageRole
  offsetMm: Pt
  method: string
  anchors: number
  residualMm: number | null
  status: 'verified' | 'unverified' | 'failed'
}

export interface SceneDoc {
  schemaVersion: string
  referencePageId: string | null
  plan: Plan
  evidence: Record<string, Record<string, Evidence[]>>
  objectSources: Record<string, { pageId: string; region: Box }[]>
  constraints: { id: string; label: string; expected: number; unit: string; tolerance: number; authority: string; source: { pageId: string; textId?: string; text?: string; region?: Box } }[]
  assumptions: Assumption[]
  registrations: Registration[]
  unsupported: { id: string; pageId: string; kind: string; message: string; region?: Box }[]
  sources: SourcePage[]
  aiIssues: { pageId: string; kind: string; message: string; region: Box | null }[]
  acceptances: { key: string; decisionId: string; rationale: string }[]
  review: { objectId: string; confidence: number }[]
  buildLog: string[]
}

export type Severity = 'blocking' | 'warning' | 'info'
export interface Question {
  kind: 'number' | 'confirm' | 'choice'
  label: string
  unit?: 'mm'
  defaultValue?: number | string
  options?: { value: string; label: string }[]
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
  acceptKey?: string
  question?: Question
}
export interface Check {
  id: string
  category: string
  label: string
  expected: string | number | null
  observed: string | number | null
  outcome: 'pass' | 'fail' | 'missing' | 'accepted' | 'warning'
  objectIds: string[]
}
export type ValidationStatus = 'passed' | 'passed_with_warnings' | 'blocked'
export interface ValidationSummary {
  blocking: number
  warnings: number
  info: number
  checksPassed: number
  checksTotal: number
}
export interface ValidationRun {
  id: string
  revisionId: string
  sceneHash: string
  validatorVersion: string
  policy: { mode: 'strict' | 'draft'; frozen?: boolean }
  status: ValidationStatus
  summary: ValidationSummary
  checks: Check[]
  issues: Issue[]
  createdAt: string
}

export interface ViewSpec {
  key: string
  name: string
  group: 'perspective' | 'elevation' | 'top' | 'ceiling' | 'isometric'
  roomId: string | null
  projection: 'perspective' | 'orthographic'
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  fov: number
  ortho: { width: number; height: number } | null
  aspect: number
  visibility: { items: boolean; ceilings: 'auto' | 'show' | 'hide' }
  mirrorX: boolean
  note: string | null
}

export interface RevisionDetail extends RevisionSummary {
  workspaceId: string
  schemaVersion: string
  scene: SceneDoc
  validation: ValidationRun | null
  approvals: Approval[]
  views: ViewSpec[]
}

export interface RenderSet {
  id: string
  workspaceId: string
  revisionId: string
  approvalId: string | null
  designProjectId: string
  manifest: {
    revisionId: string
    revisionNo: number
    sceneHash: string
    label: 'final' | 'draft'
    approvalId: string | null
    quality: { preset: string; samples: number; longSide: number }
    views: ViewSpec[]
  }
  manifestHash: string
  status: 'queued' | 'running' | 'partially_complete' | 'complete' | 'failed'
  outputs: Record<string, { status: 'pending' | 'complete' | 'failed'; assetId: string | null; error: string | null }>
  createdAt: string
}

export interface Decision {
  id: string
  kind: string
  target: unknown
  beforeJson: unknown
  afterJson: unknown
  rationale: string | null
  createdAt: string
}

export interface Report {
  workspace: { id: string; name: string; mode: string }
  revision: { id: string; revisionNo: number; status: string; sceneHash: string | null; sealedAt: string | null; createdAt: string; summary: Record<string, number> | null; schemaVersion: string }
  validation: ValidationRun | null
  approvals: Approval[]
  sources: SourcePage[]
  registrations: Registration[]
  assumptions: Assumption[]
  unsupported: SceneDoc['unsupported']
  acceptances: SceneDoc['acceptances']
  buildLog: string[]
  decisions: { id: string; kind: string; target: unknown; before: unknown; after: unknown; rationale: string | null; createdAt: string }[]
  model: { name: string; reasoningEffort: string }
}

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  extracted: 'From drawing',
  ai_interpreted: 'AI-read, geometry-checked',
  designer_decision: 'Designer decision',
  default_assumption: 'Provisional assumption',
  derived: 'Derived',
  designer_edit: 'Edited in designer',
}
