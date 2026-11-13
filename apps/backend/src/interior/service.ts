import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { config } from '../config'
import { db, designAssets, designProjects, intDecisions, intDocuments, intJobs, intPages, intRevisions, intValidationRuns, intWorkspaces } from '../db'
import { planSchema } from '../designer/plan'
import { sha256 } from '../visualizer/imageCheck'
import { aiConfigured } from '../ai/chatService'
import { interpretPage, interpretationKey, InterpretationError, PROMPT_VERSION } from './ai/interpret'
import { compileScene, type CompilePage } from './build/compile'
import { applyCommands, CommandError, commandSchema, type Command } from './commands'
import type { CalibrationOverride, ElevationAssignment, PageExtraction, PageInterpretation, PageRole, RegistrationOverride, SceneDoc, ValidationResult } from './contracts'
import { PAGE_ROLES, VALIDATOR_VERSION } from './contracts'
import { extractDocument, ExtractionError, type DocumentKind } from './extract'
import { readSegments } from './extract/common'
import { enqueueJob, JobError, registerJobHandler, setJobFailureHook, setJobSuccessHook, type JobContext } from './jobs'
import { validateScene } from './validate'
import { prepareInterpretation } from './geometry/prepare'

export type Workspace = typeof intWorkspaces.$inferSelect
export type Revision = typeof intRevisions.$inferSelect

export class ServiceError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

// ── Canonical hashing ──

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`
}
export const sceneHash = (scene: SceneDoc) => createHash('sha256').update(stableStringify(scene)).digest('hex')

// ── Lookups (always scoped to the owner) ──

export async function ownedWorkspace(userId: string, id: string) {
  const [w] = await db.select().from(intWorkspaces).where(and(eq(intWorkspaces.id, id), eq(intWorkspaces.userId, userId))).limit(1)
  if (!w) throw new ServiceError(404, 'NOT_FOUND', 'Workspace not found')
  return w
}

export async function ownedRevision(userId: string, id: string) {
  const [r] = await db.select().from(intRevisions).where(and(eq(intRevisions.id, id), eq(intRevisions.userId, userId))).limit(1)
  if (!r) throw new ServiceError(404, 'NOT_FOUND', 'Revision not found')
  return r
}

export function effectiveRole(p: { role: string | null; suggestedRole: string | null }): PageRole {
  const r = (p.role ?? p.suggestedRole ?? 'other') as PageRole
  return PAGE_ROLES.includes(r) ? r : 'other'
}

const pageMetaColumns = {
  id: intPages.id,
  workspaceId: intPages.workspaceId,
  documentId: intPages.documentId,
  pageIndex: intPages.pageIndex,
  width: intPages.width,
  height: intPages.height,
  previewWidth: intPages.previewWidth,
  previewHeight: intPages.previewHeight,
  role: intPages.role,
  suggestedRole: intPages.suggestedRole,
  title: intPages.title,
  status: intPages.status,
  interpretationKey: intPages.interpretationKey,
  interpretationMeta: intPages.interpretationMeta,
  calibration: intPages.calibration,
  assignment: intPages.assignment,
  registration: intPages.registration,
  error: intPages.error,
  createdAt: intPages.createdAt,
  updatedAt: intPages.updatedAt,
}
export { pageMetaColumns }

// ── Compile inputs ──

async function loadCompilePages(workspaceId: string): Promise<CompilePage[]> {
  const docs = await db.select({ id: intDocuments.id, name: intDocuments.name }).from(intDocuments).where(eq(intDocuments.workspaceId, workspaceId))
  const names = new Map(docs.map((d) => [d.id, d.name]))
  const rows = await db
    .select({ ...pageMetaColumns, extraction: intPages.extraction, interpretation: intPages.interpretation, vectors: intPages.vectors })
    .from(intPages)
    .where(eq(intPages.workspaceId, workspaceId))
    .orderBy(asc(intPages.createdAt), asc(intPages.pageIndex))
  return rows
    .filter((r) => r.status !== 'excluded')
    .map((r) => {
      const vectors = r.vectors ? readSegments(r.vectors) : null
      const meta = r.interpretationMeta as { model?: string; promptVersion?: string } | null
      return {
        pageId: r.id,
        documentId: r.documentId,
        documentName: names.get(r.documentId) ?? 'Drawing',
        pageIndex: r.pageIndex,
        role: effectiveRole(r),
        title: r.title,
        extraction: r.extraction as PageExtraction,
        interpretation: prepareInterpretation((r.interpretation as PageInterpretation | null) ?? null, vectors),
        interpretationMeta: meta?.model ? { model: meta.model, promptVersion: meta.promptVersion ?? PROMPT_VERSION } : null,
        calibrationOverride: (r.calibration as CalibrationOverride | null) ?? null,
        assignment: (r.assignment as ElevationAssignment | null) ?? null,
        registrationOverride: (r.registration as RegistrationOverride | null) ?? null,
        vectors,
        loadImage: async () => {
          const [img] = await db.select({ image: intPages.image }).from(intPages).where(eq(intPages.id, r.id)).limit(1)
          return img.image
        },
      }
    })
}

/** Re-applies the designer's earlier answers after a rebuild (skipping ones whose objects are gone). */
async function replayDecisions(workspaceId: string, scene: SceneDoc): Promise<SceneDoc> {
  const rows = await db.select().from(intDecisions).where(eq(intDecisions.workspaceId, workspaceId)).orderBy(asc(intDecisions.createdAt))
  let current = scene
  for (const d of rows) {
    const parsed = commandSchema.safeParse(d.command)
    if (!parsed.success || parsed.data.type === 'set_page_units') continue
    try {
      current = applyCommands(current, [parsed.data], () => d.id).scene
    } catch (err) {
      if (err instanceof CommandError) current.buildLog.push(`Earlier decision (${d.kind}) could not be re-applied: ${err.message}`)
      else throw err
    }
  }
  return current
}

// ── Revisions and validation ──

async function nextRevisionNo(tx: typeof db, workspaceId: string) {
  // Serialises revision numbering per workspace.
  await tx.select({ id: intWorkspaces.id }).from(intWorkspaces).where(eq(intWorkspaces.id, workspaceId)).for('update')
  const [m] = await tx.select({ n: sql<number>`COALESCE(MAX(${intRevisions.revisionNo}), 0)` }).from(intRevisions).where(eq(intRevisions.workspaceId, workspaceId))
  return Number(m?.n ?? 0) + 1
}

export async function insertRevision(tx: typeof db, ws: Workspace, scene: SceneDoc, origin: string, parentId: string | null) {
  const id = crypto.randomUUID()
  const revisionNo = await nextRevisionNo(tx, ws.id)
  const summary = {
    walls: scene.plan.walls.length,
    rooms: scene.plan.rooms.length,
    openings: scene.plan.openings.length,
    items: scene.plan.items.length,
    ceilings: scene.plan.ceilings?.length ?? 0,
    panels: scene.plan.panels?.length ?? 0,
    fixtures: scene.plan.fixtures?.length ?? 0,
    constraints: scene.constraints.length,
    assumptions: scene.assumptions.length,
  }
  await tx.insert(intRevisions).values({ id, userId: ws.userId, workspaceId: ws.id, revisionNo, parentRevisionId: parentId, origin, status: 'draft', schemaVersion: scene.schemaVersion, scene, summary })
  await tx.update(intWorkspaces).set({ latestRevisionId: id, lockVersion: sql`${intWorkspaces.lockVersion} + 1` }).where(eq(intWorkspaces.id, ws.id))
  return id
}

export async function runValidation(tx: typeof db, ws: Workspace, rev: Revision, scene: SceneDoc): Promise<{ id: string; result: ValidationResult; hash: string }> {
  const policy = { mode: ws.mode }
  const result = validateScene(scene, policy)
  const hash = rev.sceneHash ?? sceneHash(scene)
  const id = crypto.randomUUID()
  await tx.insert(intValidationRuns).values({
    id,
    userId: ws.userId,
    workspaceId: ws.id,
    revisionId: rev.id,
    sceneHash: hash,
    validatorVersion: VALIDATOR_VERSION,
    policy: { ...policy, frozen: rev.status === 'frozen' },
    status: result.status,
    summary: result.summary,
    checks: result.checks,
    issues: result.issues,
  })
  return { id, result, hash }
}

export async function latestValidation(revisionId: string) {
  const [v] = await db.select().from(intValidationRuns).where(eq(intValidationRuns.revisionId, revisionId)).orderBy(desc(intValidationRuns.createdAt)).limit(1)
  return v ?? null
}

/** Applies commands to a draft revision in place (optimistic concurrency on lock_version). */
export async function applyRevisionCommands(userId: string, revisionId: string, baseLockVersion: number, commands: Command[]) {
  const pageCmds = commands.filter((c) => c.type === 'set_page_units')
  const sceneCmds = commands.filter((c) => c.type !== 'set_page_units')
  return db.transaction(async (tx) => {
    const [rev] = await tx.select().from(intRevisions).where(and(eq(intRevisions.id, revisionId), eq(intRevisions.userId, userId))).for('update').limit(1)
    if (!rev) throw new ServiceError(404, 'NOT_FOUND', 'Revision not found')
    if (rev.status !== 'draft') throw new ServiceError(409, 'REVISION_SEALED', 'This revision is frozen. Fork it to make changes.')
    if (rev.lockVersion !== baseLockVersion) throw new ServiceError(409, 'REVISION_CONFLICT', 'This revision changed since you loaded it. Reload and try again.')
    const [ws] = await tx.select().from(intWorkspaces).where(eq(intWorkspaces.id, rev.workspaceId)).limit(1)
    let scene = rev.scene as SceneDoc
    let rebuild = false
    for (const c of pageCmds) {
      if (c.type !== 'set_page_units') continue
      const [page] = await tx.select({ id: intPages.id, calibration: intPages.calibration }).from(intPages).where(and(eq(intPages.id, c.pageId), eq(intPages.workspaceId, ws.id))).limit(1)
      if (!page) throw new ServiceError(404, 'NOT_FOUND', 'Page not found')
      const before = page.calibration as CalibrationOverride | null
      await tx.update(intPages).set({ calibration: { ...(before ?? {}), units: c.units } }).where(eq(intPages.id, page.id))
      await tx.insert(intDecisions).values({ id: crypto.randomUUID(), userId, workspaceId: ws.id, revisionId, kind: 'set_page_units', target: { pageId: c.pageId }, beforeJson: before, afterJson: { units: c.units }, command: c, rationale: 'Designer confirmed drawing units' })
      rebuild = true
    }
    if (sceneCmds.length) {
      let applied
      try {
        applied = applyCommands(scene, sceneCmds, () => crypto.randomUUID())
      } catch (err) {
        if (err instanceof CommandError) throw new ServiceError(422, err.code, err.message)
        throw err
      }
      const plan = planSchema.safeParse(applied.scene.plan)
      if (!plan.success) throw new ServiceError(422, 'INVALID_RESULT', `The change would make the design invalid: ${plan.error.issues[0]?.message}`)
      scene = applied.scene
      for (const d of applied.decisions) {
        await tx.insert(intDecisions).values({ id: d.id, userId, workspaceId: ws.id, revisionId, kind: d.kind, target: d.target, beforeJson: d.before ?? null, afterJson: d.after ?? null, command: d.command, rationale: d.rationale })
      }
      await tx.update(intRevisions).set({ scene, lockVersion: sql`${intRevisions.lockVersion} + 1` }).where(eq(intRevisions.id, rev.id))
    }
    const [fresh] = await tx.select().from(intRevisions).where(eq(intRevisions.id, rev.id)).limit(1)
    const validation = await runValidation(tx as unknown as typeof db, ws, fresh, scene)
    if (rebuild) await enqueueJob(tx as unknown as typeof db, { userId, workspaceId: ws.id, type: 'build_scene', targetId: ws.id, idempotencyKey: `build:${ws.id}:${Date.now()}` })
    return { revision: fresh, validation, rebuildQueued: rebuild }
  })
}

// ── Pipeline orchestration ──

export async function maybeAutoBuild(ws: Workspace) {
  if (!ws.autoBuild) return
  const pending = await db
    .select({ id: intJobs.id })
    .from(intJobs)
    .where(and(eq(intJobs.workspaceId, ws.id), inArray(intJobs.type, ['extract_document', 'interpret_page']), inArray(intJobs.status, ['queued', 'running', 'retry_wait'])))
    .limit(1)
  if (pending.length) return
  const pages = await db
    .select({ id: intPages.id, key: intPages.interpretationKey, role: intPages.role, cal: intPages.calibration, asg: intPages.assignment, reg: intPages.registration, status: intPages.status })
    .from(intPages)
    .where(eq(intPages.workspaceId, ws.id))
  if (!pages.some((p) => p.key)) return
  const fingerprint = createHash('sha256').update(stableStringify({ pages: pages.map((p) => [p.id, p.key, p.role, p.cal, p.asg, p.reg, p.status]), ref: ws.referencePageId, mode: ws.mode })).digest('hex').slice(0, 32)
  await enqueueJob(db, { userId: ws.userId, workspaceId: ws.id, type: 'build_scene', targetId: ws.id, idempotencyKey: `build:${ws.id}:${fingerprint}` })
}

export async function queueInterpretation(ws: Workspace, pageId: string, force: boolean) {
  return enqueueJob(db, { userId: ws.userId, workspaceId: ws.id, type: 'interpret_page', targetId: pageId, idempotencyKey: `interpret:${pageId}:${force ? Date.now() : 'initial'}`, input: { force }, maxAttempts: 3 })
}

async function handleExtract(ctx: JobContext) {
  const [doc] = await db.select().from(intDocuments).where(eq(intDocuments.id, ctx.job.targetId)).limit(1)
  if (!doc) throw new JobError('NOT_FOUND', 'The document was deleted.')
  await db.update(intDocuments).set({ status: 'extracting', error: null }).where(eq(intDocuments.id, doc.id))
  let pages
  try {
    pages = await extractDocument(doc.data, doc.kind as DocumentKind, doc.mimeType, (i, total) => ctx.checkpoint({ stage: 'extract', page: i + 1, total }))
  } catch (err) {
    if (err instanceof ExtractionError) throw new JobError(err.code, err.message, err.retryable)
    throw new JobError('EXTRACTION_FAILED', (err as Error).message ?? 'Extraction failed', false)
  }
  const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(intPages).where(and(eq(intPages.workspaceId, doc.workspaceId), sql`${intPages.documentId} <> ${doc.id}`))
  if (Number(n) + pages.length > config.interior.maxPagesPerWorkspace) {
    throw new JobError('TOO_MANY_PAGES', `This workspace would exceed ${config.interior.maxPagesPerWorkspace} pages.`)
  }
  const ids: string[] = []
  await db.transaction(async (tx) => {
    if (!(await ctx.stillOwner(tx as unknown as typeof db))) throw new JobError('LEASE_LOST', 'Lease lost', true)
    await tx.delete(intPages).where(eq(intPages.documentId, doc.id))
    for (const p of pages) {
      const id = crypto.randomUUID()
      ids.push(id)
      await tx.insert(intPages).values({
        id,
        userId: doc.userId,
        workspaceId: doc.workspaceId,
        documentId: doc.id,
        pageIndex: p.pageIndex,
        width: p.width,
        height: p.height,
        previewWidth: p.previewWidth,
        previewHeight: p.previewHeight,
        status: 'extracted',
        extraction: p.extraction,
        vectors: p.vectors,
        image: p.image,
        preview: p.preview,
        title: pages.length > 1 ? `${doc.name} — p${p.pageIndex + 1}` : doc.name,
      })
    }
    await tx
      .update(intDocuments)
      .set({ status: 'ready', pageCount: pages.length, preflight: { pages: pages.map((p) => ({ source: p.extraction.source, width: p.width, height: p.height, texts: p.extraction.texts.length, vectors: p.extraction.vectorCount, warnings: p.extraction.warnings })) } })
      .where(eq(intDocuments.id, doc.id))
  })
  const [ws] = await db.select().from(intWorkspaces).where(eq(intWorkspaces.id, doc.workspaceId)).limit(1)
  for (const id of ids) await queueInterpretation(ws, id, false)
  return { pages: ids.length }
}

async function handleInterpret(ctx: JobContext) {
  const [page] = await db.select().from(intPages).where(eq(intPages.id, ctx.job.targetId)).limit(1)
  if (!page) throw new JobError('NOT_FOUND', 'The page was deleted.')
  if (!aiConfigured()) throw new JobError('AI_NOT_CONFIGURED', 'OPENAI_API_KEY is not set on the server.')
  const [doc] = await db.select({ name: intDocuments.name }).from(intDocuments).where(eq(intDocuments.id, page.documentId)).limit(1)
  const input = {
    extraction: page.extraction as PageExtraction,
    preview: page.preview,
    previewWidth: page.previewWidth,
    previewHeight: page.previewHeight,
    roleHint: (page.role as PageRole | null) ?? null,
    sheetName: `${doc?.name ?? 'Drawing'}${(page.extraction as PageExtraction).pdf ? `, page ${page.pageIndex + 1}` : ''}`,
  }
  const key = interpretationKey(input)
  const force = !!(ctx.job.input as { force?: boolean } | null)?.force
  await db.update(intPages).set({ status: 'interpreting', error: null }).where(eq(intPages.id, page.id))

  let interpretation: PageInterpretation | null = null
  let meta: Record<string, unknown> | null = null
  if (!force) {
    // Content-addressed cache within this owner's data (plan §9.4).
    const [hit] = await db
      .select({ interpretation: intPages.interpretation, meta: intPages.interpretationMeta })
      .from(intPages)
      .where(and(eq(intPages.userId, page.userId), eq(intPages.interpretationKey, key), sql`${intPages.interpretation} IS NOT NULL`))
      .limit(1)
    if (hit) {
      interpretation = hit.interpretation as PageInterpretation
      meta = { ...(hit.meta as object), cached: true }
    }
  }
  if (!interpretation) {
    await ctx.checkpoint({ stage: 'interpret', model: config.interior.model })
    try {
      const r = await interpretPage(input, config.interior.maxTokensPerJob)
      interpretation = r.interpretation
      meta = r.meta as unknown as Record<string, unknown>
    } catch (err) {
      if (err instanceof InterpretationError) throw new JobError(err.code, err.message, err.retryable)
      throw err
    }
  }
  await db.transaction(async (tx) => {
    if (!(await ctx.stillOwner(tx as unknown as typeof db))) throw new JobError('LEASE_LOST', 'Lease lost', true)
    await tx
      .update(intPages)
      .set({
        interpretation,
        interpretationKey: key,
        interpretationMeta: meta,
        suggestedRole: interpretation!.sheet.kind,
        title: interpretation!.sheet.title ? interpretation!.sheet.title.slice(0, 255) : page.title,
        status: 'interpreted',
        error: null,
      })
      .where(eq(intPages.id, page.id))
  })
  const usage = (meta as { usage?: unknown } | null)?.usage ?? null
  return { cached: !!(meta as { cached?: boolean } | null)?.cached, usage, walls: interpretation!.walls.length, rejectedRefs: interpretation!.rejectedRefs.length }
}

async function handleBuild(ctx: JobContext) {
  const [ws] = await db.select().from(intWorkspaces).where(eq(intWorkspaces.id, ctx.job.targetId)).limit(1)
  if (!ws) throw new JobError('NOT_FOUND', 'The workspace was deleted.')
  await ctx.checkpoint({ stage: 'compile' })
  const pages = await loadCompilePages(ws.id)
  let scene = await compileScene({ referencePageId: ws.referencePageId, pages })
  scene = await replayDecisions(ws.id, scene)
  const parsed = planSchema.safeParse(scene.plan)
  if (!parsed.success) throw new JobError('INVALID_SCENE', `The reconstructed plan is invalid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  await ctx.checkpoint({ stage: 'validate' })
  let revisionId = ''
  await db.transaction(async (tx) => {
    const t = tx as unknown as typeof db
    if (!(await ctx.stillOwner(t))) throw new JobError('LEASE_LOST', 'Lease lost', true)
    revisionId = await insertRevision(t, ws, scene, 'build', ws.latestRevisionId)
    const [rev] = await t.select().from(intRevisions).where(eq(intRevisions.id, revisionId)).limit(1)
    await runValidation(t, ws, rev, scene)
  })
  return { revisionId, walls: scene.plan.walls.length, rooms: scene.plan.rooms.length }
}

setJobFailureHook(async (job, willRetry) => {
  if (willRetry) return
  if (job.type === 'extract_document') {
    const [j] = await db.select({ error: intJobs.error }).from(intJobs).where(eq(intJobs.id, job.id)).limit(1)
    await db.update(intDocuments).set({ status: 'failed', error: j?.error ?? 'Extraction failed' }).where(eq(intDocuments.id, job.targetId))
  } else if (job.type === 'interpret_page') {
    const [j] = await db.select({ error: intJobs.error }).from(intJobs).where(eq(intJobs.id, job.id)).limit(1)
    await db.update(intPages).set({ status: 'failed', error: j?.error ?? 'Interpretation failed' }).where(eq(intPages.id, job.targetId))
  }
})

// Auto-build once the last extraction/interpretation of a workspace has finished.
setJobSuccessHook(async (job) => {
  if (job.type !== 'interpret_page' && job.type !== 'extract_document') return
  const [ws] = await db.select().from(intWorkspaces).where(eq(intWorkspaces.id, job.workspaceId)).limit(1)
  if (ws) await maybeAutoBuild(ws)
})

registerJobHandler('extract_document', handleExtract)
registerJobHandler('interpret_page', handleInterpret)
registerJobHandler('build_scene', handleBuild)

// ── Designer integration (plan §5.4) ──

/** Creates or updates the linked designer project with this revision's plan. */
export async function pushToDesigner(userId: string, ws: Workspace, rev: Revision, force: boolean) {
  const scene = rev.scene as SceneDoc
  const plan = structuredClone(scene.plan)
  // The reference drawing as a calibrated underlay so the designer can compare.
  const refSrc = scene.sources.find((s) => s.pageId === scene.referencePageId)
  if (refSrc?.calibration.mmPerPx) {
    const [img] = await db.select({ image: intPages.image, width: intPages.width, height: intPages.height }).from(intPages).where(eq(intPages.id, refSrc.pageId)).limit(1)
    if (img) {
      const assetId = crypto.randomUUID()
      await db.insert(designAssets).values({ id: assetId, userId, projectId: ws.designProjectId, kind: 'underlay', name: `${refSrc.documentName}.png`, mimeType: 'image/png', size: img.image.length, width: img.width, height: img.height, sha256: sha256(img.image), data: img.image })
      plan.underlay = { assetId, x: 0, y: 0, mmPerPx: refSrc.calibration.mmPerPx, opacity: 0.45, visible: true }
    }
  }
  const valid = planSchema.safeParse(plan)
  if (!valid.success) throw new ServiceError(422, 'INVALID_SCENE', 'This revision cannot be opened in the designer.')
  if (Buffer.byteLength(JSON.stringify(valid.data)) > config.designer.maxPlanBytes) throw new ServiceError(413, 'TOO_LARGE', 'This design is too large for the designer.')

  let projectId = ws.designProjectId
  let project = projectId ? (await db.select().from(designProjects).where(and(eq(designProjects.id, projectId), eq(designProjects.userId, userId))).limit(1))[0] : undefined
  if (project) {
    if (!force && ws.designerPushedRevision !== null && project.revision !== ws.designerPushedRevision) {
      throw new ServiceError(409, 'DESIGNER_CHANGED', 'The design was edited in the designer since it was last updated from here. Sync those edits first, or overwrite them.')
    }
    const oldUnderlay = (project.plan as { underlay?: { assetId?: string } | null })?.underlay?.assetId
    await db.update(designProjects).set({ plan: valid.data, revision: sql`${designProjects.revision} + 1` }).where(eq(designProjects.id, project.id))
    if (oldUnderlay && oldUnderlay !== plan.underlay?.assetId) {
      await db.delete(designAssets).where(and(eq(designAssets.id, oldUnderlay), eq(designAssets.userId, userId), eq(designAssets.kind, 'underlay')))
    }
  } else {
    projectId = crypto.randomUUID()
    await db.insert(designProjects).values({ id: projectId, userId, clientId: ws.clientId, name: `${ws.name} (Interior 3D)`, plan: valid.data })
  }
  if (plan.underlay) await db.update(designAssets).set({ projectId }).where(eq(designAssets.id, plan.underlay.assetId))
  ;[project] = await db.select().from(designProjects).where(eq(designProjects.id, projectId!)).limit(1)
  await db.update(intWorkspaces).set({ designProjectId: projectId, designerPushedRevision: project!.revision }).where(eq(intWorkspaces.id, ws.id))
  return { designProjectId: projectId!, designerRevision: project!.revision }
}

/** New draft revision from the designer's current plan (manual edits become designer evidence). */
export async function syncFromDesigner(userId: string, ws: Workspace, base: Revision) {
  if (!ws.designProjectId) throw new ServiceError(409, 'NO_DESIGNER_PROJECT', 'Open the revision in the designer first.')
  const [project] = await db.select().from(designProjects).where(and(eq(designProjects.id, ws.designProjectId), eq(designProjects.userId, userId))).limit(1)
  if (!project) throw new ServiceError(404, 'NOT_FOUND', 'The linked designer project was deleted.')
  const parsed = planSchema.safeParse(project.plan)
  if (!parsed.success) throw new ServiceError(422, 'INVALID_SCENE', 'The designer plan is invalid.')
  const prev = base.scene as SceneDoc
  const scene: SceneDoc = structuredClone(prev)
  const next = parsed.data
  const changed: string[] = []
  const decisionId = crypto.randomUUID()
  const diff = <T extends { id: string }>(a: T[] = [], b: T[] = []) => {
    const before = new Map(a.map((x) => [x.id, stableStringify(x)]))
    for (const x of b) {
      if (before.get(x.id) !== stableStringify(x)) {
        changed.push(x.id)
        ;((scene.evidence[x.id] ??= {}).designer ??= []).push({ kind: 'designer_edit', decisionId, note: before.has(x.id) ? 'Edited in the designer' : 'Added in the designer' })
      }
    }
    const kept = new Set(b.map((x) => x.id))
    return a.filter((x) => !kept.has(x.id)).map((x) => x.id)
  }
  const removed = [
    ...diff(prev.plan.walls, next.walls),
    ...diff(prev.plan.openings, next.openings),
    ...diff(prev.plan.items, next.items),
    ...diff(prev.plan.ceilings, next.ceilings),
    ...diff(prev.plan.panels, next.panels),
    ...diff(prev.plan.fixtures, next.fixtures),
  ]
  // Keep the interior-only geometry from this revision if the designer dropped the fields.
  scene.plan = { ...next, underlay: next.underlay, ceilings: next.ceilings ?? prev.plan.ceilings, panels: next.panels ?? prev.plan.panels, fixtures: next.fixtures ?? prev.plan.fixtures }
  scene.assumptions = scene.assumptions.map((a) => ({ ...a, objectIds: a.objectIds.filter((id) => id === 'plan' || !removed.includes(id)) })).filter((a) => a.objectIds.length)
  if (prev.plan.wallHeight !== next.wallHeight) {
    ;((scene.evidence.plan ??= {}).ceilingHeight ??= []).push({ kind: 'designer_edit', decisionId, value: next.wallHeight })
    scene.assumptions = scene.assumptions.filter((a) => a.property !== 'wallHeight')
  }
  return db.transaction(async (tx) => {
    const t = tx as unknown as typeof db
    const id = await insertRevision(t, ws, scene, 'designer_sync', base.id)
    await t.insert(intDecisions).values({ id: decisionId, userId, workspaceId: ws.id, revisionId: id, kind: 'designer_sync', target: { objectIds: changed }, beforeJson: { revisionId: base.id }, afterJson: { changed: changed.length, removed: removed.length, designerRevision: project.revision }, command: null, rationale: 'Edits made in the 3D designer' })
    await t.update(intWorkspaces).set({ designerPushedRevision: project.revision }).where(eq(intWorkspaces.id, ws.id))
    const [rev] = await t.select().from(intRevisions).where(eq(intRevisions.id, id)).limit(1)
    await runValidation(t, ws, rev, scene)
    return { revisionId: id, changed: changed.length, removed: removed.length }
  })
}

export { aiConfigured }
