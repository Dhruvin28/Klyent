import { createHash } from 'node:crypto'
import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import {
  db,
  clients,
  designAssets,
  designProjects,
  intApprovals,
  intDecisions,
  intDocuments,
  intJobs,
  intPages,
  intRenderSets,
  intRevisions,
  intValidationRuns,
  intWorkspaces,
} from '../../db'
import { sha256, sniffImageMime } from '../../visualizer/imageCheck'
import { commandSchema } from '../../interior/commands'
import { PAGE_ROLES, type CalibrationOverride, type PageExtraction, type PageInterpretation, type SceneDoc } from '../../interior/contracts'
import { prepareInterpretation } from '../../interior/geometry/prepare'
import { readSegments } from '../../interior/extract/common'
import { buildCameras, type ViewSpec } from '../../interior/build/views'
import { calibratePage } from '../../interior/geometry/calibrate'
import { sniffDocument } from '../../interior/extract'
import { enqueueJob } from '../../interior/jobs'
import {
  ServiceError,
  aiConfigured,
  applyRevisionCommands,
  effectiveRole,
  insertRevision,
  latestValidation,
  ownedRevision,
  ownedWorkspace,
  pageMetaColumns,
  pushToDesigner,
  queueInterpretation,
  runValidation,
  sceneHash,
  stableStringify,
  syncFromDesigner,
} from '../../interior/service'

function httpError(statusCode: number, message: string, code = 'ERROR') {
  return Object.assign(new Error(message), { statusCode, code })
}

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() })

const QUALITY = {
  draft: { samples: 64, label: 'Draft' },
  presentation: { samples: 256, label: 'Presentation' },
  high_resolution: { samples: 768, label: 'High resolution' },
} as const

export default async function interiorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', async (_req, reply) => {
    if (!config.interior.enabled) return reply.code(404).send({ error: 'Not Found', message: 'Interior 3D is disabled.' })
  })

  app.setErrorHandler((error, request, reply) => {
    const e = error as Error & { statusCode?: number; code?: string }
    if (e instanceof ServiceError) return reply.code(e.statusCode).send({ error: e.code, code: e.code, message: e.message })
    if (e instanceof z.ZodError) {
      return reply.code(400).send({ error: 'VALIDATION', code: 'VALIDATION', message: e.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') })
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'TOO_LARGE', code: 'TOO_LARGE', message: e.message })
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.code ?? e.name, code: e.code ?? 'ERROR', message: e.message })
    request.log.error({ err: e }, 'Interior request failed')
    return reply.code(500).send({ error: 'INTERNAL', code: 'INTERNAL', message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : e.message })
  })

  const uid = (req: FastifyRequest) => req.user.sub

  async function ownedPage(userId: string, id: string) {
    const [p] = await db.select().from(intPages).where(and(eq(intPages.id, id), eq(intPages.userId, userId))).limit(1)
    if (!p) throw httpError(404, 'Page not found', 'NOT_FOUND')
    return p
  }

  async function workspaceSummary(userId: string, id: string) {
    const ws = await ownedWorkspace(userId, id)
    const docs = await db
      .select({ id: intDocuments.id, name: intDocuments.name, kind: intDocuments.kind, size: intDocuments.size, status: intDocuments.status, pageCount: intDocuments.pageCount, revisionLabel: intDocuments.revisionLabel, preflight: intDocuments.preflight, error: intDocuments.error, createdAt: intDocuments.createdAt })
      .from(intDocuments)
      .where(eq(intDocuments.workspaceId, ws.id))
      .orderBy(asc(intDocuments.createdAt))
    const pages = await db.select(pageMetaColumns).from(intPages).where(eq(intPages.workspaceId, ws.id)).orderBy(asc(intPages.createdAt), asc(intPages.pageIndex))
    const jobs = await db
      .select({ id: intJobs.id, type: intJobs.type, targetId: intJobs.targetId, status: intJobs.status, attempt: intJobs.attempt, maxAttempts: intJobs.maxAttempts, progress: intJobs.progress, errorCode: intJobs.errorCode, error: intJobs.error, result: intJobs.result, createdAt: intJobs.createdAt, finishedAt: intJobs.finishedAt })
      .from(intJobs)
      .where(eq(intJobs.workspaceId, ws.id))
      .orderBy(desc(intJobs.createdAt))
      .limit(60)
    const revisions = await db
      .select({ id: intRevisions.id, revisionNo: intRevisions.revisionNo, origin: intRevisions.origin, status: intRevisions.status, sceneHash: intRevisions.sceneHash, summary: intRevisions.summary, lockVersion: intRevisions.lockVersion, parentRevisionId: intRevisions.parentRevisionId, sealedAt: intRevisions.sealedAt, createdAt: intRevisions.createdAt })
      .from(intRevisions)
      .where(eq(intRevisions.workspaceId, ws.id))
      .orderBy(desc(intRevisions.revisionNo))
      .limit(50)
    const approvals = await db.select().from(intApprovals).where(eq(intApprovals.workspaceId, ws.id)).orderBy(desc(intApprovals.approvedAt))
    const active = jobs.some((j) => ['queued', 'running', 'retry_wait'].includes(j.status))
    const latest = revisions[0] ? await latestValidation(revisions[0].id) : null
    const approved = approvals.find((a) => a.revisionId === ws.approvedRevisionId)
    const status = active
      ? 'processing'
      : approved && approved.mode === 'final'
        ? 'approved'
        : !revisions.length
          ? pages.length
            ? 'needs_review'
            : 'empty'
          : latest?.status === 'blocked'
            ? 'needs_review'
            : revisions[0].status === 'frozen'
              ? 'ready_for_approval'
              : 'draft_ready'
    return {
      workspace: ws,
      status,
      documents: docs,
      pages: pages.map((p) => ({ ...p, effectiveRole: effectiveRole(p) })),
      jobs,
      revisions,
      approvals,
      latestValidation: latest ? { id: latest.id, revisionId: latest.revisionId, status: latest.status, summary: latest.summary, createdAt: latest.createdAt } : null,
      ai: { configured: aiConfigured(), model: config.interior.model, reasoningEffort: config.interior.reasoningEffort },
    }
  }

  // ── Status ──
  app.get('/status', async () => ({ data: { enabled: config.interior.enabled, aiConfigured: aiConfigured(), model: config.interior.model, reasoningEffort: config.interior.reasoningEffort } }))

  // ── Workspaces ──
  app.get('/workspaces', async (request) => {
    const rows = await db
      .select({ id: intWorkspaces.id, name: intWorkspaces.name, mode: intWorkspaces.mode, clientId: intWorkspaces.clientId, clientName: clients.name, designProjectId: intWorkspaces.designProjectId, approvedRevisionId: intWorkspaces.approvedRevisionId, latestRevisionId: intWorkspaces.latestRevisionId, createdAt: intWorkspaces.createdAt, updatedAt: intWorkspaces.updatedAt })
      .from(intWorkspaces)
      .leftJoin(clients, eq(clients.id, intWorkspaces.clientId))
      .where(eq(intWorkspaces.userId, uid(request)))
      .orderBy(desc(intWorkspaces.updatedAt))
      .limit(500)
    const ids = rows.map((r) => r.id)
    const counts = ids.length
      ? await db.select({ ws: intDocuments.workspaceId, n: sql<number>`COUNT(*)` }).from(intDocuments).where(inArray(intDocuments.workspaceId, ids)).groupBy(intDocuments.workspaceId)
      : []
    const thumbs = ids.length ? await db.select({ ws: intPages.workspaceId, id: sql<string>`MIN(${intPages.id})` }).from(intPages).where(inArray(intPages.workspaceId, ids)).groupBy(intPages.workspaceId) : []
    return { data: rows.map((r) => ({ ...r, documents: Number(counts.find((c) => c.ws === r.id)?.n ?? 0), thumbPageId: thumbs.find((t) => t.ws === r.id)?.id ?? null })) }
  })

  app.post('/workspaces', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(255), clientId: z.string().max(128).nullable().optional(), mode: z.enum(['strict', 'draft']).default('strict') }).parse(request.body)
    if (body.clientId) {
      const [c] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, body.clientId), eq(clients.userId, uid(request)))).limit(1)
      if (!c) throw httpError(400, 'Client not found')
    }
    const id = crypto.randomUUID()
    await db.insert(intWorkspaces).values({ id, userId: uid(request), name: body.name, clientId: body.clientId || null, mode: body.mode })
    return reply.code(201).send({ data: await workspaceSummary(uid(request), id) })
  })

  app.get('/workspaces/:id', async (request) => {
    const { id } = request.params as { id: string }
    return { data: await workspaceSummary(uid(request), id) }
  })

  app.patch('/workspaces/:id', async (request) => {
    const { id } = request.params as { id: string }
    const ws = await ownedWorkspace(uid(request), id)
    const body = z
      .object({ name: z.string().trim().min(1).max(255).optional(), mode: z.enum(['strict', 'draft']).optional(), referencePageId: z.string().max(128).nullable().optional(), autoBuild: z.boolean().optional() })
      .parse(request.body)
    if (body.referencePageId) {
      const p = await ownedPage(uid(request), body.referencePageId)
      if (p.workspaceId !== ws.id) throw httpError(400, 'That page belongs to another workspace')
    }
    await db.update(intWorkspaces).set(body).where(eq(intWorkspaces.id, ws.id))
    if (body.referencePageId !== undefined && body.referencePageId !== ws.referencePageId) {
      await db.insert(intDecisions).values({ id: crypto.randomUUID(), userId: ws.userId, workspaceId: ws.id, kind: 'set_reference_plan', target: { pageId: body.referencePageId }, beforeJson: { pageId: ws.referencePageId }, afterJson: { pageId: body.referencePageId }, rationale: 'Reference plan chosen by the designer' })
    }
    return { data: await workspaceSummary(uid(request), id) }
  })

  app.delete('/workspaces/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const ws = await ownedWorkspace(uid(request), id)
    await db.update(intJobs).set({ cancelRequestedAt: new Date() }).where(and(eq(intJobs.workspaceId, ws.id), inArray(intJobs.status, ['queued', 'running', 'retry_wait'])))
    for (const t of [intPages, intDocuments, intRevisions, intValidationRuns, intDecisions, intApprovals, intRenderSets] as const) {
      await db.delete(t).where(eq(t.workspaceId, ws.id))
    }
    await db.delete(intJobs).where(and(eq(intJobs.workspaceId, ws.id), inArray(intJobs.status, ['succeeded', 'failed', 'canceled', 'queued', 'retry_wait'])))
    await db.delete(intWorkspaces).where(eq(intWorkspaces.id, ws.id))
    // The linked designer project stays: it is an independent, editable design.
    return reply.code(204).send()
  })

  // ── Documents (upload → preflight → extract job) ──
  app.post('/workspaces/:id/documents', async (request, reply) => {
    const { id } = request.params as { id: string }
    const ws = await ownedWorkspace(uid(request), id)
    if (!request.isMultipart()) throw httpError(415, 'Expected multipart/form-data')
    const files: { buffer: Buffer; filename: string }[] = []
    let revisionLabel: string | null = null
    const parts = request.parts({ limits: { files: 12, fileSize: config.interior.maxUploadBytes, fields: 5 } })
    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = []
        for await (const c of part.file) chunks.push(c as Buffer)
        if (part.file.truncated) throw httpError(413, `"${part.filename}" is too large (max ${config.interior.maxUploadBytes / 1024 / 1024} MB).`, 'TOO_LARGE')
        if (chunks.length) files.push({ buffer: Buffer.concat(chunks), filename: part.filename || 'drawing' })
      } else if (part.fieldname === 'revisionLabel') {
        revisionLabel = String(part.value ?? '').trim().slice(0, 64) || null
      }
    }
    if (!files.length) throw httpError(400, 'Attach at least one drawing.')
    const accepted: { id: string; name: string }[] = []
    const rejected: { name: string; code: string; message: string }[] = []
    for (const f of files) {
      const sniff = sniffDocument(f.buffer, f.filename)
      if ('error' in sniff) {
        rejected.push({ name: f.filename, code: sniff.code, message: sniff.error })
        continue
      }
      const hash = sha256(f.buffer)
      const [dup] = await db.select({ id: intDocuments.id }).from(intDocuments).where(and(eq(intDocuments.workspaceId, ws.id), eq(intDocuments.sha256, hash))).limit(1)
      if (dup) {
        rejected.push({ name: f.filename, code: 'DUPLICATE', message: 'This exact file is already in the workspace.' })
        continue
      }
      const docId = crypto.randomUUID()
      const name = f.filename.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 200)
      await db.transaction(async (tx) => {
        await tx.insert(intDocuments).values({ id: docId, userId: ws.userId, workspaceId: ws.id, name, kind: sniff.kind, mimeType: sniff.mime, size: f.buffer.length, sha256: hash, revisionLabel, status: 'queued', data: f.buffer })
        await enqueueJob(tx as unknown as typeof db, { userId: ws.userId, workspaceId: ws.id, type: 'extract_document', targetId: docId, idempotencyKey: `extract:${docId}`, maxAttempts: 2 })
      })
      accepted.push({ id: docId, name })
    }
    await db.update(intWorkspaces).set({ updatedAt: new Date() }).where(eq(intWorkspaces.id, ws.id))
    return reply.code(accepted.length ? 202 : 400).send({ data: { accepted, rejected }, ...(accepted.length ? {} : { error: 'UNSUPPORTED_FORMAT', message: rejected.map((r) => `${r.name}: ${r.message}`).join(' ') }) })
  })

  app.delete('/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [doc] = await db.select({ id: intDocuments.id, workspaceId: intDocuments.workspaceId }).from(intDocuments).where(and(eq(intDocuments.id, id), eq(intDocuments.userId, uid(request)))).limit(1)
    if (!doc) throw httpError(404, 'Document not found', 'NOT_FOUND')
    const pageIds = (await db.select({ id: intPages.id }).from(intPages).where(eq(intPages.documentId, doc.id))).map((p) => p.id)
    await db.update(intJobs).set({ cancelRequestedAt: new Date() }).where(and(inArray(intJobs.targetId, [doc.id, ...pageIds]), inArray(intJobs.status, ['queued', 'running', 'retry_wait'])))
    await db.delete(intPages).where(eq(intPages.documentId, doc.id))
    await db.delete(intDocuments).where(eq(intDocuments.id, doc.id))
    await db.update(intWorkspaces).set({ referencePageId: null }).where(and(eq(intWorkspaces.id, doc.workspaceId), pageIds.length ? inArray(intWorkspaces.referencePageId, pageIds) : sql`FALSE`))
    return reply.code(204).send()
  })

  // ── Pages ──
  app.get('/pages/:id', async (request) => {
    const { id } = request.params as { id: string }
    const [p] = await db
      .select({ ...pageMetaColumns, extraction: intPages.extraction, interpretation: intPages.interpretation, vectors: intPages.vectors, userId: intPages.userId })
      .from(intPages)
      .where(and(eq(intPages.id, id), eq(intPages.userId, uid(request))))
      .limit(1)
    if (!p) throw httpError(404, 'Page not found', 'NOT_FOUND')
    const { vectors, ...rest } = p
    const interpretation = prepareInterpretation((p.interpretation as PageInterpretation | null) ?? null, vectors ? readSegments(vectors) : null)
    const calibration = calibratePage(p.extraction as PageExtraction, interpretation, (p.calibration as CalibrationOverride | null) ?? null)
    return { data: { ...rest, interpretation, hasVectors: !!vectors?.length, effectiveRole: effectiveRole(p), computedCalibration: calibration } }
  })

  app.get('/pages/:id/image', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { variant } = request.query as { variant?: string }
    const full = variant === 'full'
    const [p] = await db
      .select(full ? { data: intPages.image } : { data: intPages.preview })
      .from(intPages)
      .where(and(eq(intPages.id, id), eq(intPages.userId, uid(request))))
      .limit(1)
    if (!p) throw httpError(404, 'Page not found', 'NOT_FOUND')
    return reply.header('Content-Type', full ? 'image/png' : 'image/jpeg').header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff').send(p.data)
  })

  app.get('/pages/:id/vectors', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [p] = await db.select({ v: intPages.vectors }).from(intPages).where(and(eq(intPages.id, id), eq(intPages.userId, uid(request)))).limit(1)
    if (!p) throw httpError(404, 'Page not found', 'NOT_FOUND')
    return reply.header('Content-Type', 'application/octet-stream').header('Cache-Control', 'private, max-age=3600').send(p.v ?? Buffer.alloc(0))
  })

  app.patch('/pages/:id', async (request) => {
    const { id } = request.params as { id: string }
    const p = await ownedPage(uid(request), id)
    const body = z
      .object({
        role: z.enum(PAGE_ROLES).nullable().optional(),
        excluded: z.boolean().optional(),
        assignment: z.object({ roomLabel: z.string().trim().min(1).max(120), side: z.enum(['N', 'E', 'S', 'W']) }).nullable().optional(),
        calibration: z
          .object({ units: z.enum(['mm', 'cm', 'm', 'ft_in', 'unknown']).optional(), manual: z.object({ p1: pointSchema, p2: pointSchema, distanceMm: z.number().finite().positive().max(200_000) }).nullable().optional() })
          .nullable()
          .optional(),
        registration: z.object({ dxMm: z.number().finite().min(-1e6).max(1e6), dyMm: z.number().finite().min(-1e6).max(1e6) }).nullable().optional(),
      })
      .parse(request.body)
    const patch: Partial<typeof intPages.$inferInsert> = {}
    const decisions: { kind: string; before: unknown; after: unknown }[] = []
    if (body.role !== undefined) {
      patch.role = body.role
      decisions.push({ kind: 'set_page_role', before: p.role, after: body.role })
    }
    if (body.excluded !== undefined) {
      patch.status = body.excluded ? 'excluded' : p.interpretation ? 'interpreted' : 'extracted'
      decisions.push({ kind: body.excluded ? 'exclude_page' : 'include_page', before: p.status, after: patch.status })
    }
    if (body.assignment !== undefined) {
      patch.assignment = body.assignment
      decisions.push({ kind: 'assign_elevation', before: p.assignment, after: body.assignment })
    }
    if (body.calibration !== undefined) {
      patch.calibration = body.calibration
      decisions.push({ kind: 'calibrate_page', before: p.calibration, after: body.calibration })
    }
    if (body.registration !== undefined) {
      patch.registration = body.registration
      decisions.push({ kind: 'register_page', before: p.registration, after: body.registration })
    }
    await db.update(intPages).set(patch).where(eq(intPages.id, p.id))
    for (const d of decisions) {
      await db.insert(intDecisions).values({ id: crypto.randomUUID(), userId: p.userId, workspaceId: p.workspaceId, kind: d.kind, target: { pageId: p.id }, beforeJson: d.before ?? null, afterJson: d.after ?? null, rationale: null })
    }
    // A changed role changes what the model is asked; re-interpret with the hint.
    if (body.role !== undefined && body.role && body.role !== p.suggestedRole && p.interpretation) {
      const ws = await ownedWorkspace(uid(request), p.workspaceId)
      await queueInterpretation(ws, p.id, true)
    }
    const [fresh] = await db.select(pageMetaColumns).from(intPages).where(eq(intPages.id, p.id)).limit(1)
    return { data: { ...fresh, effectiveRole: effectiveRole(fresh) } }
  })

  app.post('/pages/:id/interpret', async (request, reply) => {
    const { id } = request.params as { id: string }
    const p = await ownedPage(uid(request), id)
    if (!aiConfigured()) throw httpError(503, 'OPENAI_API_KEY is not set on the server.', 'AI_NOT_CONFIGURED')
    const ws = await ownedWorkspace(uid(request), p.workspaceId)
    const jobId = await queueInterpretation(ws, p.id, true)
    return reply.code(202).send({ data: { jobId } })
  })

  // ── Build ──
  app.post('/workspaces/:id/build', async (request, reply) => {
    const { id } = request.params as { id: string }
    const ws = await ownedWorkspace(uid(request), id)
    const key = (request.headers['idempotency-key'] as string | undefined)?.slice(0, 100) ?? String(Date.now())
    const jobId = await enqueueJob(db, { userId: ws.userId, workspaceId: ws.id, type: 'build_scene', targetId: ws.id, idempotencyKey: `build:${ws.id}:manual:${key}` })
    return reply.code(202).send({ data: { jobId } })
  })

  // ── Jobs ──
  app.get('/jobs/:id', async (request) => {
    const { id } = request.params as { id: string }
    const [j] = await db.select().from(intJobs).where(and(eq(intJobs.id, id), eq(intJobs.userId, uid(request)))).limit(1)
    if (!j) throw httpError(404, 'Job not found', 'NOT_FOUND')
    return { data: { ...j, leaseToken: undefined } }
  })

  app.post('/jobs/:id/cancel', async (request) => {
    const { id } = request.params as { id: string }
    const res = await db.update(intJobs).set({ cancelRequestedAt: new Date() }).where(and(eq(intJobs.id, id), eq(intJobs.userId, uid(request)), inArray(intJobs.status, ['queued', 'running', 'retry_wait'])))
    const n = (res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0
    if (!n) throw httpError(409, 'This job is not running.', 'NOT_CANCELABLE')
    await db.update(intJobs).set({ status: 'canceled', finishedAt: new Date() }).where(and(eq(intJobs.id, id), inArray(intJobs.status, ['queued', 'retry_wait'])))
    return { data: { ok: true } }
  })

  app.post('/jobs/:id/retry', async (request) => {
    const { id } = request.params as { id: string }
    const [j] = await db.select().from(intJobs).where(and(eq(intJobs.id, id), eq(intJobs.userId, uid(request)))).limit(1)
    if (!j) throw httpError(404, 'Job not found', 'NOT_FOUND')
    if (!['failed', 'canceled'].includes(j.status)) throw httpError(409, 'Only failed or canceled jobs can be retried.', 'NOT_RETRYABLE')
    const newId = await enqueueJob(db, { userId: j.userId, workspaceId: j.workspaceId, type: j.type as never, targetId: j.targetId, idempotencyKey: `${j.idempotencyKey.slice(0, 120)}:retry:${Date.now()}`, input: { ...((j.input as object) ?? {}), force: true }, maxAttempts: j.maxAttempts })
    return { data: { jobId: newId } }
  })

  // ── Revisions ──
  app.get('/revisions/:id', async (request) => {
    const { id } = request.params as { id: string }
    const rev = await ownedRevision(uid(request), id)
    const validation = await latestValidation(rev.id)
    const approvals = await db.select().from(intApprovals).where(eq(intApprovals.revisionId, rev.id)).orderBy(desc(intApprovals.approvedAt))
    return { data: { ...rev, validation, approvals, views: buildCameras((rev.scene as SceneDoc).plan) } }
  })

  app.post('/revisions/:id/commands', async (request) => {
    const { id } = request.params as { id: string }
    const body = z.object({ baseLockVersion: z.number().int().min(0), commands: z.array(commandSchema).min(1).max(50) }).parse(request.body)
    const out = await applyRevisionCommands(uid(request), id, body.baseLockVersion, body.commands)
    return { data: { revision: out.revision, validation: { id: out.validation.id, ...out.validation.result }, rebuildQueued: out.rebuildQueued } }
  })

  app.post('/revisions/:id/validate', async (request) => {
    const { id } = request.params as { id: string }
    const rev = await ownedRevision(uid(request), id)
    const ws = await ownedWorkspace(uid(request), rev.workspaceId)
    const v = await runValidation(db, ws, rev, rev.scene as SceneDoc)
    return { data: { id: v.id, sceneHash: v.hash, ...v.result } }
  })

  app.get('/validations/:id', async (request) => {
    const { id } = request.params as { id: string }
    const [v] = await db.select().from(intValidationRuns).where(and(eq(intValidationRuns.id, id), eq(intValidationRuns.userId, uid(request)))).limit(1)
    if (!v) throw httpError(404, 'Validation run not found', 'NOT_FOUND')
    return { data: v }
  })

  app.post('/revisions/:id/freeze', async (request) => {
    const { id } = request.params as { id: string }
    const body = z.object({ baseLockVersion: z.number().int().min(0) }).parse(request.body)
    const out = await db.transaction(async (tx) => {
      const t = tx as unknown as typeof db
      const [rev] = await t.select().from(intRevisions).where(and(eq(intRevisions.id, id), eq(intRevisions.userId, uid(request)))).for('update').limit(1)
      if (!rev) throw httpError(404, 'Revision not found', 'NOT_FOUND')
      if (rev.status === 'frozen') return { rev, run: null }
      if (rev.lockVersion !== body.baseLockVersion) throw httpError(409, 'This revision changed since you loaded it. Reload and try again.', 'REVISION_CONFLICT')
      const hash = sceneHash(rev.scene as SceneDoc)
      await t.update(intRevisions).set({ status: 'frozen', sceneHash: hash, sealedAt: new Date() }).where(eq(intRevisions.id, rev.id))
      const [sealed] = await t.select().from(intRevisions).where(eq(intRevisions.id, rev.id)).limit(1)
      const [ws] = await t.select().from(intWorkspaces).where(eq(intWorkspaces.id, rev.workspaceId)).limit(1)
      const run = await runValidation(t, ws, sealed, sealed.scene as SceneDoc)
      return { rev: sealed, run }
    })
    return { data: { revision: { ...out.rev, scene: undefined }, validation: out.run ? { id: out.run.id, sceneHash: out.run.hash, ...out.run.result } : await latestValidation(out.rev.id) } }
  })

  app.post('/revisions/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ validationRunId: z.string().min(1).max(128), mode: z.enum(['final', 'draft']), note: z.string().trim().max(1000).optional() }).parse(request.body)
    const rev = await ownedRevision(uid(request), id)
    if (rev.status !== 'frozen' || !rev.sceneHash) throw httpError(409, 'Freeze the revision before approving it.', 'APPROVAL_REQUIRES_FREEZE')
    const [run] = await db.select().from(intValidationRuns).where(and(eq(intValidationRuns.id, body.validationRunId), eq(intValidationRuns.revisionId, rev.id))).limit(1)
    if (!run) throw httpError(404, 'Validation run not found', 'NOT_FOUND')
    if (run.sceneHash !== rev.sceneHash) throw httpError(409, 'The validation does not match this exact revision. Validate again.', 'VALIDATION_STALE')
    const ws = await ownedWorkspace(uid(request), rev.workspaceId)
    if (body.mode === 'final' && run.status === 'blocked') {
      throw httpError(409, `${(run.summary as { blocking: number }).blocking} blocking issue(s) remain. Resolve them, or approve as a labelled draft.`, 'APPROVAL_BLOCKED')
    }
    if (body.mode === 'final' && ws.mode === 'draft') throw httpError(409, 'Draft-mode workspaces can only issue draft approvals. Switch the workspace to strict mode.', 'STRICT_MODE_REQUIRED')
    const approvalId = crypto.randomUUID()
    await db.insert(intApprovals).values({ id: approvalId, userId: ws.userId, workspaceId: ws.id, revisionId: rev.id, validationRunId: run.id, sceneHash: rev.sceneHash, mode: body.mode, note: body.note ?? null })
    await db.update(intWorkspaces).set({ approvedRevisionId: rev.id }).where(eq(intWorkspaces.id, ws.id))
    await db.insert(intDecisions).values({ id: crypto.randomUUID(), userId: ws.userId, workspaceId: ws.id, revisionId: rev.id, kind: 'approve', target: { revisionId: rev.id }, afterJson: { mode: body.mode, validationRunId: run.id, sceneHash: rev.sceneHash }, rationale: body.note ?? null })
    return reply.code(201).send({ data: { approvalId } })
  })

  app.post('/revisions/:id/fork', async (request, reply) => {
    const { id } = request.params as { id: string }
    const rev = await ownedRevision(uid(request), id)
    const ws = await ownedWorkspace(uid(request), rev.workspaceId)
    const newId = await db.transaction(async (tx) => {
      const t = tx as unknown as typeof db
      const nid = await insertRevision(t, ws, rev.scene as SceneDoc, 'fork', rev.id)
      const [fresh] = await t.select().from(intRevisions).where(eq(intRevisions.id, nid)).limit(1)
      await runValidation(t, ws, fresh, fresh.scene as SceneDoc)
      return nid
    })
    return reply.code(201).send({ data: { revisionId: newId } })
  })

  app.post('/revisions/:id/designer', async (request) => {
    const { id } = request.params as { id: string }
    const body = z.object({ force: z.boolean().default(false) }).parse(request.body ?? {})
    const rev = await ownedRevision(uid(request), id)
    const ws = await ownedWorkspace(uid(request), rev.workspaceId)
    return { data: await pushToDesigner(uid(request), ws, rev, body.force) }
  })

  app.post('/revisions/:id/sync-designer', async (request, reply) => {
    const { id } = request.params as { id: string }
    const rev = await ownedRevision(uid(request), id)
    const ws = await ownedWorkspace(uid(request), rev.workspaceId)
    return reply.code(201).send({ data: await syncFromDesigner(uid(request), ws, rev) })
  })

  app.get('/workspaces/:id/decisions', async (request) => {
    const { id } = request.params as { id: string }
    const ws = await ownedWorkspace(uid(request), id)
    const rows = await db.select().from(intDecisions).where(eq(intDecisions.workspaceId, ws.id)).orderBy(desc(intDecisions.createdAt)).limit(500)
    return { data: rows }
  })

  // ── Validation report (data for the PDF/printable report) ──
  app.get('/revisions/:id/report', async (request) => {
    const { id } = request.params as { id: string }
    const rev = await ownedRevision(uid(request), id)
    const ws = await ownedWorkspace(uid(request), rev.workspaceId)
    const scene = rev.scene as SceneDoc
    const validation = await latestValidation(rev.id)
    const approvals = await db.select().from(intApprovals).where(eq(intApprovals.revisionId, rev.id))
    const decisions = await db.select().from(intDecisions).where(eq(intDecisions.workspaceId, ws.id)).orderBy(asc(intDecisions.createdAt))
    return {
      data: {
        workspace: { id: ws.id, name: ws.name, mode: ws.mode },
        revision: { id: rev.id, revisionNo: rev.revisionNo, status: rev.status, sceneHash: rev.sceneHash, sealedAt: rev.sealedAt, createdAt: rev.createdAt, summary: rev.summary, schemaVersion: rev.schemaVersion },
        validation,
        approvals,
        sources: scene.sources,
        registrations: scene.registrations,
        assumptions: scene.assumptions,
        unsupported: scene.unsupported,
        acceptances: scene.acceptances,
        buildLog: scene.buildLog,
        decisions: decisions.map((d) => ({ id: d.id, kind: d.kind, target: d.target, before: d.beforeJson, after: d.afterJson, rationale: d.rationale, createdAt: d.createdAt })),
        model: { name: config.interior.model, reasoningEffort: config.interior.reasoningEffort },
      },
    }
  })

  // ── Render sets (immutable manifest → per-view outputs) ──
  app.post('/revisions/:id/render-sets', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({ viewKeys: z.array(z.string().min(1).max(200)).min(1).max(80), quality: z.enum(['draft', 'presentation', 'high_resolution']), longSide: z.number().int().min(640).max(4096), allowDraft: z.boolean().default(false), rerun: z.boolean().default(false) })
      .parse(request.body)
    const rev = await ownedRevision(uid(request), id)
    let ws = await ownedWorkspace(uid(request), rev.workspaceId)
    const scene = rev.scene as SceneDoc
    const [approval] = rev.sceneHash
      ? await db.select().from(intApprovals).where(and(eq(intApprovals.revisionId, rev.id), eq(intApprovals.sceneHash, rev.sceneHash))).orderBy(desc(intApprovals.approvedAt)).limit(1)
      : []
    if (!approval && !body.allowDraft) throw httpError(409, 'Approve this revision before producing final renders, or render it as a labelled draft.', 'APPROVAL_REQUIRED')
    const all = buildCameras(scene.plan)
    const views: ViewSpec[] = body.viewKeys.map((k) => {
      const v = all.find((x) => x.key === k)
      if (!v) throw httpError(400, `Unknown view ${k}`)
      return v
    })
    if (!ws.designProjectId) {
      await pushToDesigner(uid(request), ws, rev, false)
      ws = await ownedWorkspace(uid(request), ws.id)
    }
    const status = approval?.mode === 'final' ? 'final' : 'draft'
    const manifest = {
      schema: 'interior-render-manifest/1',
      revisionId: rev.id,
      revisionNo: rev.revisionNo,
      sceneHash: rev.sceneHash ?? sceneHash(scene),
      approvalId: approval?.id ?? null,
      validationRunId: approval?.validationRunId ?? null,
      label: status,
      renderer: { name: 'three-gpu-pathtracer', version: '0.0.27', runtime: 'browser WebGL2' },
      quality: { preset: body.quality, samples: QUALITY[body.quality].samples, longSide: body.longSide, bounces: 6 },
      lighting: scene.plan.lighting,
      views,
    }
    // An explicit re-run must produce a new set even when nothing in the manifest changed.
    const manifestHash = createHash('sha256').update(stableStringify(body.rerun ? { ...manifest, rerunNonce: crypto.randomUUID() } : manifest)).digest('hex')
    const [existing] = await db.select().from(intRenderSets).where(and(eq(intRenderSets.workspaceId, ws.id), eq(intRenderSets.manifestHash, manifestHash))).limit(1)
    if (existing) return reply.send({ data: existing })
    const setId = crypto.randomUUID()
    const outputs = Object.fromEntries(views.map((v) => [v.key, { status: 'pending', assetId: null, error: null }]))
    await db.insert(intRenderSets).values({ id: setId, userId: ws.userId, workspaceId: ws.id, revisionId: rev.id, approvalId: approval?.id ?? null, designProjectId: ws.designProjectId!, manifest, manifestHash, status: 'queued', outputs })
    const [row] = await db.select().from(intRenderSets).where(eq(intRenderSets.id, setId)).limit(1)
    return reply.code(201).send({ data: row })
  })

  app.get('/workspaces/:id/render-sets', async (request) => {
    const { id } = request.params as { id: string }
    const ws = await ownedWorkspace(uid(request), id)
    return { data: await db.select().from(intRenderSets).where(eq(intRenderSets.workspaceId, ws.id)).orderBy(desc(intRenderSets.createdAt)).limit(50) }
  })

  async function updateOutput(userId: string, setId: string, viewKey: string, value: { status: string; assetId: string | null; error: string | null }) {
    return db.transaction(async (tx) => {
      const t = tx as unknown as typeof db
      const [set] = await t.select().from(intRenderSets).where(and(eq(intRenderSets.id, setId), eq(intRenderSets.userId, userId))).for('update').limit(1)
      if (!set) throw httpError(404, 'Render set not found', 'NOT_FOUND')
      const outputs = { ...(set.outputs as Record<string, { status: string; assetId: string | null }>) }
      if (!outputs[viewKey]) throw httpError(400, 'Unknown view for this render set')
      const previous = outputs[viewKey].assetId
      outputs[viewKey] = value
      const values = Object.values(outputs)
      const status = values.every((o) => o.status === 'complete') ? 'complete' : values.some((o) => o.status === 'complete') ? 'partially_complete' : values.every((o) => o.status === 'failed') ? 'failed' : 'running'
      await t.update(intRenderSets).set({ outputs, status }).where(eq(intRenderSets.id, set.id))
      return { set: { ...set, outputs, status }, previous }
    })
  }

  app.post('/render-sets/:id/outputs/:viewKey', async (request, reply) => {
    const { id, viewKey } = request.params as { id: string; viewKey: string }
    const userId = uid(request)
    const [set] = await db.select().from(intRenderSets).where(and(eq(intRenderSets.id, id), eq(intRenderSets.userId, userId))).limit(1)
    if (!set) throw httpError(404, 'Render set not found', 'NOT_FOUND')
    const manifest = set.manifest as { views: ViewSpec[]; label: string; revisionNo: number; sceneHash: string; quality: { samples: number; preset: string } }
    const view = manifest.views.find((v) => v.key === viewKey)
    if (!view) throw httpError(400, 'Unknown view for this render set')
    if (!request.isMultipart()) throw httpError(415, 'Expected multipart/form-data')
    let file: Buffer | null = null
    let width = 0
    let height = 0
    for await (const part of request.parts({ limits: { files: 1, fileSize: 40 * 1024 * 1024, fields: 4 } })) {
      if (part.type === 'file') {
        const chunks: Buffer[] = []
        for await (const c of part.file) chunks.push(c as Buffer)
        if (part.file.truncated) throw httpError(413, 'Render is too large', 'TOO_LARGE')
        file = Buffer.concat(chunks)
      } else if (part.fieldname === 'width') width = parseInt(String(part.value), 10) || 0
      else if (part.fieldname === 'height') height = parseInt(String(part.value), 10) || 0
    }
    const mime = file && sniffImageMime(file)
    if (!file || !mime) throw httpError(415, 'Render must be a PNG or JPEG image')
    const assetId = crypto.randomUUID()
    const ext = mime === 'image/png' ? 'png' : 'jpg'
    const label = manifest.label === 'final' ? '' : ' · DRAFT'
    await db.insert(designAssets).values({
      id: assetId,
      userId,
      projectId: set.designProjectId,
      kind: 'render',
      name: `${view.name} · R${manifest.revisionNo}${label}.${ext}`.slice(0, 480),
      mimeType: mime,
      size: file.length,
      width: width || null,
      height: height || null,
      sha256: sha256(file),
      meta: { camera: view.name, samples: manifest.quality.samples, preset: manifest.quality.preset, interior: { renderSetId: set.id, revisionNo: manifest.revisionNo, sceneHash: manifest.sceneHash, viewKey, group: view.group, label: manifest.label, projection: view.projection } },
      data: file,
    })
    const { set: updated, previous } = await updateOutput(userId, set.id, viewKey, { status: 'complete', assetId, error: null })
    if (previous && previous !== assetId) await db.delete(designAssets).where(and(eq(designAssets.id, previous), eq(designAssets.userId, userId)))
    return reply.code(201).send({ data: updated })
  })

  app.post('/render-sets/:id/outputs/:viewKey/fail', async (request) => {
    const { id, viewKey } = request.params as { id: string; viewKey: string }
    const body = z.object({ error: z.string().max(500) }).parse(request.body)
    const { set } = await updateOutput(uid(request), id, viewKey, { status: 'failed', assetId: null, error: body.error })
    return { data: set }
  })

  // Designer project linkage info (used by the UI to open the designer).
  app.get('/workspaces/:id/designer', async (request) => {
    const { id } = request.params as { id: string }
    const ws = await ownedWorkspace(uid(request), id)
    if (!ws.designProjectId) return { data: null }
    const [p] = await db.select({ id: designProjects.id, revision: designProjects.revision, updatedAt: designProjects.updatedAt }).from(designProjects).where(and(eq(designProjects.id, ws.designProjectId), eq(designProjects.userId, ws.userId))).limit(1)
    return { data: p ? { ...p, editedSincePush: ws.designerPushedRevision !== null && p.revision !== ws.designerPushedRevision } : null }
  })
}
