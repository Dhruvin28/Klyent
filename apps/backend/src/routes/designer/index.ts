import { randomBytes } from 'node:crypto'
import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { db, clients, designAssets, designModels, designProjects, designShares } from '../../db'
import { pngDimensions, sha256, sniffImageMime } from '../../visualizer/imageCheck'
import { defaultPlan, planSchema } from '../../designer/plan'
import { UpstreamError, listModels, getModelInfo, packModel } from '../../designer/polyhaven'
import { displayName, sendWithRange } from '../../designer/http'

type AssetKind = typeof designAssets.$inferInsert['kind']

interface UploadedFile {
  buffer: Buffer
  filename: string
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode })
}

/** Drains a multipart request into text fields + named files (each capped at maxAssetSize). */
async function parseFiles(request: FastifyRequest, allowed: string[]) {
  const fields: Record<string, string> = {}
  const files: Record<string, UploadedFile> = {}
  if (!request.isMultipart()) throw httpError(415, 'Expected multipart/form-data')
  const parts = request.parts({ limits: { files: allowed.length, fields: 20, fileSize: config.designer.maxAssetSize, fieldSize: 64 * 1024 } })
  for await (const part of parts) {
    if (part.type === 'file') {
      const chunks: Buffer[] = []
      for await (const chunk of part.file) chunks.push(chunk as Buffer)
      if (part.file.truncated) {
        throw httpError(413, `"${part.filename}" is too large (max ${config.designer.maxAssetSize / (1024 * 1024)}MB).`)
      }
      if (!allowed.includes(part.fieldname)) throw httpError(400, `Unexpected file field "${part.fieldname}"`)
      if (!chunks.length) continue
      files[part.fieldname] = { buffer: Buffer.concat(chunks), filename: part.filename || part.fieldname }
    } else {
      fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value)
    }
  }
  return { fields, files }
}

function safeName(name: string, fallback: string) {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim().slice(0, 200)
  return cleaned || fallback
}

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/webm': 'webm', 'video/mp4': 'mp4' }

/** Reads width/height from PNG, JPEG or WebP headers; null when the header is unusual. */
function imageDimensions(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return pngDimensions(buf)
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null
        const marker = buf[i + 1]
        const len = buf.readUInt16BE(i + 2)
        // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
        }
        i += 2 + len
      }
      return null
    }
    if (mime === 'image/webp') {
      const chunk = buf.toString('ascii', 12, 16)
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
    }
  } catch {
    return null
  }
  return null
}

function sniffVideoMime(buf: Buffer): 'video/webm' | 'video/mp4' | null {
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm'
  if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  return null
}

function isGlb(buf: Buffer) {
  return buf.length >= 12 && buf.toString('ascii', 0, 4) === 'glTF'
}

function optionalNumber(raw: string | undefined, label: string, min: number, max: number): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${label} must be a number between ${min} and ${max}`)
  return n
}

function requiredNumber(raw: string | undefined, label: string, min: number, max: number): number {
  const n = optionalNumber(raw, label, min, max)
  if (n === null) throw httpError(400, `${label} is required`)
  return n
}

const MAX_MODELS_PER_USER = 2000
const MAX_RENDERS_PER_PROJECT = 300
const RENDER_KINDS = ['render', 'panorama', 'video'] as const

const renderMetaSchema = z
  .object({
    camera: z.string().max(200).optional(),
    samples: z.number().int().min(0).max(100_000).optional(),
    preset: z.string().max(50).optional(),
    durationSec: z.number().finite().min(0).max(3600).optional(),
  })
  .strip()

const modelPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  widthMm: z.number().finite().min(1).max(50_000).optional(),
  depthMm: z.number().finite().min(1).max(50_000).optional(),
  heightMm: z.number().finite().min(1).max(50_000).optional(),
  price: z.number().finite().min(0).max(1e12).nullable().optional(),
  brand: z.string().trim().max(255).nullable().optional(),
})

const shareSchema = z.object({
  title: z.string().trim().min(1).max(255),
  message: z.string().trim().max(5000).optional(),
  renderIds: z.array(z.string().min(1).max(128)).min(1).max(30),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
})

const CONFLICT_MESSAGE = 'This design was changed in another tab or by another session. Reload to get the latest version.'

// Poly Haven categories we prefer to label an imported model with.
const FURNITURE_CATEGORIES = ['seating', 'table', 'bed', 'shelves', 'lighting', 'appliances', 'electronics', 'decorative', 'vases', 'potted plants', 'plants', 'wall decoration', 'office', 'furniture']

export default async function designerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.setErrorHandler((error, request, reply) => {
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'File too large', message: error.message })
    }
    if (error instanceof UpstreamError) {
      request.log.warn({ err: error }, 'Poly Haven request failed')
      return reply.code(502).send({ error: 'Bad Gateway', message: error.message })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.name ?? 'Error', message: error.message })
    }
    request.log.error({ err: error }, 'Designer request failed')
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
    })
  })

  async function insertAsset(
    userId: string,
    kind: AssetKind,
    file: { buffer: Buffer; name: string; mimeType: string; width?: number | null; height?: number | null; meta?: unknown },
    links: { projectId?: string | null; modelId?: string | null } = {}
  ) {
    const id = crypto.randomUUID()
    await db.insert(designAssets).values({
      id,
      userId,
      projectId: links.projectId ?? null,
      modelId: links.modelId ?? null,
      kind,
      name: file.name,
      mimeType: file.mimeType,
      size: file.buffer.length,
      width: file.width ?? null,
      height: file.height ?? null,
      sha256: sha256(file.buffer),
      meta: file.meta ?? null,
      data: file.buffer,
    })
    return id
  }

  async function ownedProject(userId: string, id: string) {
    const [p] = await db.select().from(designProjects).where(and(eq(designProjects.id, id), eq(designProjects.userId, userId))).limit(1)
    return p
  }

  async function ownedModel(userId: string, id: string) {
    const [m] = await db.select().from(designModels).where(and(eq(designModels.id, id), eq(designModels.userId, userId))).limit(1)
    return m
  }

  async function assertClient(userId: string, clientId: string | null | undefined) {
    if (!clientId) return
    const [c] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.userId, userId))).limit(1)
    if (!c) throw httpError(400, 'Client not found')
  }

  function parsePlan(raw: unknown) {
    if (Buffer.byteLength(JSON.stringify(raw)) > config.designer.maxPlanBytes) throw httpError(413, 'This design is too large to save')
    const parsed = planSchema.safeParse(raw)
    if (!parsed.success) {
      throw httpError(400, `plan: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
    }
    return parsed.data
  }

  const renderColumns = {
    id: designAssets.id,
    projectId: designAssets.projectId,
    kind: designAssets.kind,
    name: designAssets.name,
    mimeType: designAssets.mimeType,
    width: designAssets.width,
    height: designAssets.height,
    size: designAssets.size,
    meta: designAssets.meta,
    createdAt: designAssets.createdAt,
  }

  // Asset names carry the file extension for downloads; the UI shows the name without it.
  function serializeRender<T extends { name: string }>(r: T): T {
    return { ...r, name: displayName(r.name) }
  }

  function serializeModel(m: typeof designModels.$inferSelect) {
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      source: m.source,
      sourceRef: m.sourceRef,
      glbAssetId: m.glbAssetId,
      thumbAssetId: m.thumbAssetId,
      widthMm: Number(m.widthMm),
      depthMm: Number(m.depthMm),
      heightMm: Number(m.heightMm),
      price: m.price === null ? null : Number(m.price),
      brand: m.brand,
      license: m.license,
      createdAt: m.createdAt,
    }
  }

  // ── Projects ────────────────────────────────────────────────────────────

  // GET /api/designer/projects
  app.get('/projects', async (request, reply) => {
    const rows = await db
      .select({
        id: designProjects.id,
        name: designProjects.name,
        clientId: designProjects.clientId,
        clientName: clients.name,
        thumbnailAssetId: designProjects.thumbnailAssetId,
        createdAt: designProjects.createdAt,
        updatedAt: designProjects.updatedAt,
      })
      .from(designProjects)
      .leftJoin(clients, eq(clients.id, designProjects.clientId))
      .where(eq(designProjects.userId, request.user.sub))
      .orderBy(desc(designProjects.updatedAt))
      .limit(500)
    return reply.send({ data: rows })
  })

  // POST /api/designer/projects { name, clientId?, plan? }
  app.post('/projects', async (request, reply) => {
    const userId = request.user.sub
    const body = z
      .object({ name: z.string().trim().min(1).max(255), clientId: z.string().max(128).nullable().optional(), plan: z.unknown().optional() })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error', message: body.error.message })
    await assertClient(userId, body.data.clientId)
    const plan = body.data.plan === undefined ? defaultPlan() : parsePlan(body.data.plan)
    const id = crypto.randomUUID()
    await db.insert(designProjects).values({ id, userId, clientId: body.data.clientId || null, name: body.data.name, plan })
    return reply.code(201).send({ data: await ownedProject(userId, id) })
  })

  // GET /api/designer/projects/:id
  app.get('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const p = await ownedProject(request.user.sub, id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    return reply.send({ data: p })
  })

  // PATCH /api/designer/projects/:id { revision, name?, clientId?, plan? }
  app.patch('/projects/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const body = z
      .object({
        revision: z.number().int().min(1),
        name: z.string().trim().min(1).max(255).optional(),
        clientId: z.string().max(128).nullable().optional(),
        plan: z.unknown().optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error', message: body.error.message })
    const p = await ownedProject(userId, id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    if (body.data.revision !== p.revision) return reply.code(409).send({ error: 'Conflict', message: CONFLICT_MESSAGE })

    const patch: Partial<typeof designProjects.$inferInsert> = {}
    if (body.data.name !== undefined) patch.name = body.data.name
    if (body.data.clientId !== undefined) {
      await assertClient(userId, body.data.clientId)
      patch.clientId = body.data.clientId || null
    }
    if (body.data.plan !== undefined) patch.plan = parsePlan(body.data.plan)

    // Optimistic concurrency: the UPDATE re-checks the revision atomically.
    const result = await db
      .update(designProjects)
      .set({ ...patch, revision: sql`${designProjects.revision} + 1` })
      .where(and(eq(designProjects.id, id), eq(designProjects.userId, userId), eq(designProjects.revision, body.data.revision)))
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0
    if (affected === 0) return reply.code(409).send({ error: 'Conflict', message: CONFLICT_MESSAGE })
    return reply.send({ data: await ownedProject(userId, id) })
  })

  // DELETE /api/designer/projects/:id — renders, underlays and links go with it; catalog models stay
  app.delete('/projects/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!(await ownedProject(userId, id))) return reply.code(404).send({ error: 'Project not found' })
    await db.delete(designShares).where(and(eq(designShares.projectId, id), eq(designShares.userId, userId)))
    await db.delete(designAssets).where(and(eq(designAssets.projectId, id), eq(designAssets.userId, userId)))
    await db.delete(designProjects).where(eq(designProjects.id, id))
    return reply.code(204).send()
  })

  // POST /api/designer/projects/:id/thumbnail — multipart: file
  app.post('/projects/:id/thumbnail', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const p = await ownedProject(userId, id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    const { files } = await parseFiles(request, ['file'])
    const file = files.file
    const mime = file && sniffImageMime(file.buffer)
    if (!file || !mime) throw httpError(415, 'Thumbnail must be a JPG, PNG or WebP image')
    if (file.buffer.length > 2 * 1024 * 1024) throw httpError(413, 'Thumbnail is too large (max 2MB)')
    const dims = imageDimensions(file.buffer, mime)
    const thumbnailAssetId = await insertAsset(
      userId,
      'thumbnail',
      { buffer: file.buffer, name: `thumbnail.${MIME_EXT[mime]}`, mimeType: mime, width: dims?.width, height: dims?.height },
      { projectId: id }
    )
    // Not a content edit: leave the revision alone so an open editor doesn't conflict.
    await db.update(designProjects).set({ thumbnailAssetId }).where(eq(designProjects.id, id))
    if (p.thumbnailAssetId) {
      await db.delete(designAssets).where(and(eq(designAssets.id, p.thumbnailAssetId), eq(designAssets.userId, userId)))
    }
    return reply.send({ data: { thumbnailAssetId } })
  })

  // POST /api/designer/projects/:id/underlay — multipart: file (floor-plan image)
  app.post('/projects/:id/underlay', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!(await ownedProject(userId, id))) return reply.code(404).send({ error: 'Project not found' })
    const { files } = await parseFiles(request, ['file'])
    const file = files.file
    const mime = file && sniffImageMime(file.buffer)
    if (!file || !mime) throw httpError(415, 'The floor plan must be a JPG, PNG or WebP image')
    const dims = imageDimensions(file.buffer, mime)
    const base = safeName(file.filename.replace(/\.[^.]+$/, ''), 'floor-plan')
    const assetId = await insertAsset(
      userId,
      'underlay',
      { buffer: file.buffer, name: `${base}.${MIME_EXT[mime]}`, mimeType: mime, width: dims?.width, height: dims?.height },
      { projectId: id }
    )
    return reply.code(201).send({ data: { assetId, width: dims?.width ?? 0, height: dims?.height ?? 0 } })
  })

  // ── Assets ──────────────────────────────────────────────────────────────

  // GET /api/designer/assets/:id[?download=1] — raw bytes, owner only (Range supported for video seeking)
  app.get('/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { download } = request.query as { download?: string }
    const [a] = await db
      .select()
      .from(designAssets)
      .where(and(eq(designAssets.id, id), eq(designAssets.userId, request.user.sub)))
      .limit(1)
    if (!a) return reply.code(404).send({ error: 'Asset not found' })
    const disposition = download === '1' ? 'attachment' : 'inline'
    reply
      .header('Content-Type', a.mimeType)
      .header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(a.name)}`)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('ETag', `"${a.sha256}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Accept-Ranges', 'bytes')
    return sendWithRange(request, reply, a.data)
  })

  // ── Renders, panoramas, videos ──────────────────────────────────────────

  // GET /api/designer/projects/:id/renders
  app.get('/projects/:id/renders', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!(await ownedProject(userId, id))) return reply.code(404).send({ error: 'Project not found' })
    const rows = await db
      .select(renderColumns)
      .from(designAssets)
      .where(and(eq(designAssets.projectId, id), eq(designAssets.userId, userId), inArray(designAssets.kind, [...RENDER_KINDS])))
      .orderBy(desc(designAssets.createdAt))
    return reply.send({ data: rows.map(serializeRender) })
  })

  // POST /api/designer/projects/:id/renders — multipart: kind, name, width?, height?, meta (JSON), file
  app.post('/projects/:id/renders', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!(await ownedProject(userId, id))) return reply.code(404).send({ error: 'Project not found' })
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(designAssets)
      .where(and(eq(designAssets.projectId, id), inArray(designAssets.kind, [...RENDER_KINDS])))
    if (Number(n) >= MAX_RENDERS_PER_PROJECT) throw httpError(409, `This design already has ${MAX_RENDERS_PER_PROJECT} renders. Delete some first.`)

    const { fields, files } = await parseFiles(request, ['file'])
    const kind = fields.kind as (typeof RENDER_KINDS)[number]
    if (!RENDER_KINDS.includes(kind)) throw httpError(400, 'kind must be render, panorama or video')
    const file = files.file
    if (!file) throw httpError(400, 'file is required')
    const mime = kind === 'video' ? sniffVideoMime(file.buffer) : sniffImageMime(file.buffer)
    if (!mime) throw httpError(415, kind === 'video' ? 'Videos must be WebM or MP4' : 'Renders must be JPG, PNG or WebP images')

    let meta: unknown = {}
    if (fields.meta) {
      try {
        meta = JSON.parse(fields.meta)
      } catch {
        throw httpError(400, 'meta must be valid JSON')
      }
    }
    const parsedMeta = renderMetaSchema.safeParse(meta)
    if (!parsedMeta.success) throw httpError(400, `meta: ${parsedMeta.error.message}`)

    const dims = kind === 'video' ? null : imageDimensions(file.buffer, mime)
    const width = dims?.width ?? optionalNumber(fields.width, 'width', 1, 20_000)
    const height = dims?.height ?? optionalNumber(fields.height, 'height', 1, 20_000)
    const name = (fields.name ?? '').trim().slice(0, 200) || kind
    const assetId = await insertAsset(
      userId,
      kind,
      { buffer: file.buffer, name: `${safeName(name, kind)}.${MIME_EXT[mime]}`, mimeType: mime, width, height, meta: parsedMeta.data },
      { projectId: id }
    )
    const [row] = await db.select(renderColumns).from(designAssets).where(eq(designAssets.id, assetId)).limit(1)
    return reply.code(201).send({ data: serializeRender(row) })
  })

  // DELETE /api/designer/renders/:id
  app.delete('/renders/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const [a] = await db
      .select({ id: designAssets.id })
      .from(designAssets)
      .where(and(eq(designAssets.id, id), eq(designAssets.userId, userId), inArray(designAssets.kind, [...RENDER_KINDS])))
      .limit(1)
    if (!a) return reply.code(404).send({ error: 'Render not found' })
    await db.delete(designAssets).where(eq(designAssets.id, id))
    return reply.code(204).send()
  })

  // ── Model catalog ───────────────────────────────────────────────────────

  // GET /api/designer/models
  app.get('/models', async (request, reply) => {
    const rows = await db
      .select()
      .from(designModels)
      .where(eq(designModels.userId, request.user.sub))
      .orderBy(designModels.category, designModels.name)
      .limit(MAX_MODELS_PER_USER)
    return reply.send({ data: rows.map(serializeModel) })
  })

  async function assertModelQuota(userId: string) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(designModels).where(eq(designModels.userId, userId))
    if (Number(n) >= MAX_MODELS_PER_USER) throw httpError(409, `Your catalog already has ${MAX_MODELS_PER_USER} models. Delete some first.`)
  }

  async function createModel(
    userId: string,
    data: {
      name: string
      category: string
      source: 'upload' | 'polyhaven'
      sourceRef: string | null
      widthMm: number
      depthMm: number
      heightMm: number
      price: number | null
      brand: string | null
      license: string | null
    },
    glb: Buffer,
    thumbnail: Buffer | null
  ) {
    const modelId = crypto.randomUUID()
    const base = safeName(data.name, 'model')
    try {
      const glbAssetId = await insertAsset(userId, 'model', { buffer: glb, name: `${base}.glb`, mimeType: 'model/gltf-binary' }, { modelId })
      const thumbMime = thumbnail ? sniffImageMime(thumbnail) : null
      const thumbAssetId =
        thumbnail && thumbMime
          ? await insertAsset(userId, 'model_thumb', { buffer: thumbnail, name: `${base}-thumb.${MIME_EXT[thumbMime]}`, mimeType: thumbMime }, { modelId })
          : null
      await db.insert(designModels).values({
        id: modelId,
        userId,
        name: data.name,
        category: data.category,
        source: data.source,
        sourceRef: data.sourceRef,
        glbAssetId,
        thumbAssetId,
        widthMm: String(data.widthMm),
        depthMm: String(data.depthMm),
        heightMm: String(data.heightMm),
        price: data.price === null ? null : String(data.price),
        brand: data.brand,
        license: data.license,
      })
    } catch (err) {
      await db.delete(designAssets).where(and(eq(designAssets.modelId, modelId), eq(designAssets.userId, userId))).catch(() => undefined)
      throw err
    }
    return serializeModel((await ownedModel(userId, modelId))!)
  }

  // POST /api/designer/models — multipart: name, category, widthMm, depthMm, heightMm, price?, brand?, model (GLB), thumbnail?
  app.post('/models', async (request, reply) => {
    const userId = request.user.sub
    await assertModelQuota(userId)
    const { fields, files } = await parseFiles(request, ['model', 'thumbnail'])
    const name = (fields.name ?? '').trim().slice(0, 255)
    if (!name) throw httpError(400, 'Model name is required')
    const category = (fields.category ?? '').trim().slice(0, 100) || 'furniture'
    if (!files.model || !isGlb(files.model.buffer)) throw httpError(415, 'The model must be a binary glTF (.glb) file')
    if (files.thumbnail && (!sniffImageMime(files.thumbnail.buffer) || files.thumbnail.buffer.length > 2 * 1024 * 1024)) {
      throw httpError(400, 'Invalid thumbnail')
    }
    const model = await createModel(
      userId,
      {
        name,
        category,
        source: 'upload',
        sourceRef: null,
        widthMm: requiredNumber(fields.widthMm, 'widthMm', 1, 50_000),
        depthMm: requiredNumber(fields.depthMm, 'depthMm', 1, 50_000),
        heightMm: requiredNumber(fields.heightMm, 'heightMm', 1, 50_000),
        price: optionalNumber(fields.price, 'price', 0, 1e12),
        brand: fields.brand?.trim().slice(0, 255) || null,
        license: null,
      },
      files.model.buffer,
      files.thumbnail?.buffer ?? null
    )
    return reply.code(201).send({ data: model })
  })

  // PATCH /api/designer/models/:id
  app.patch('/models/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const body = modelPatchSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error', message: body.error.message })
    if (!(await ownedModel(userId, id))) return reply.code(404).send({ error: 'Model not found' })
    const d = body.data
    const patch: Partial<typeof designModels.$inferInsert> = {}
    if (d.name !== undefined) patch.name = d.name
    if (d.category !== undefined) patch.category = d.category
    if (d.widthMm !== undefined) patch.widthMm = String(d.widthMm)
    if (d.depthMm !== undefined) patch.depthMm = String(d.depthMm)
    if (d.heightMm !== undefined) patch.heightMm = String(d.heightMm)
    if (d.price !== undefined) patch.price = d.price === null ? null : String(d.price)
    if (d.brand !== undefined) patch.brand = d.brand || null
    if (Object.keys(patch).length) await db.update(designModels).set(patch).where(eq(designModels.id, id))
    return reply.send({ data: serializeModel((await ownedModel(userId, id))!) })
  })

  // DELETE /api/designer/models/:id — designs that still place it show a placeholder box
  app.delete('/models/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!(await ownedModel(userId, id))) return reply.code(404).send({ error: 'Model not found' })
    await db.delete(designAssets).where(and(eq(designAssets.modelId, id), eq(designAssets.userId, userId)))
    await db.delete(designModels).where(eq(designModels.id, id))
    return reply.code(204).send()
  })

  // ── Poly Haven (CC0) import ─────────────────────────────────────────────

  // GET /api/designer/polyhaven?category=furniture
  app.get('/polyhaven', async (request, reply) => {
    const { category = 'furniture' } = request.query as { category?: string }
    if (!/^[a-z0-9 :_-]{0,60}$/i.test(category)) throw httpError(400, 'Invalid category')
    const entries = await listModels(category)
    const imported = await db
      .select({ ref: designModels.sourceRef })
      .from(designModels)
      .where(and(eq(designModels.userId, request.user.sub), eq(designModels.source, 'polyhaven')))
    const have = new Set(imported.map((r) => r.ref))
    return reply.send({ data: entries.map((e) => ({ ...e, imported: have.has(e.id) })) })
  })

  // Imports in flight per user+asset, so a double click doesn't pack the model twice.
  const importing = new Map<string, Promise<ReturnType<typeof serializeModel>>>()

  // POST /api/designer/polyhaven/:id/import
  app.post('/polyhaven/:id/import', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw httpError(400, 'Invalid Poly Haven asset id')
    const [existing] = await db
      .select()
      .from(designModels)
      .where(and(eq(designModels.userId, userId), eq(designModels.source, 'polyhaven'), eq(designModels.sourceRef, id)))
      .limit(1)
    if (existing) return reply.send({ data: serializeModel(existing) })

    const key = `${userId}:${id}`
    let job = importing.get(key)
    if (!job) {
      job = (async () => {
        await assertModelQuota(userId)
        const info = await getModelInfo(id)
        const packed = await packModel(id, config.designer.maxImportBytes)
        request.log.info({ asset: id, bytes: packed.glb.length }, 'Imported Poly Haven model')
        const category = FURNITURE_CATEGORIES.find((c) => info.categories.includes(c)) ?? 'furniture'
        return createModel(
          userId,
          {
            name: info.name.slice(0, 255),
            category,
            source: 'polyhaven',
            sourceRef: id,
            widthMm: packed.widthMm,
            depthMm: packed.depthMm,
            heightMm: packed.heightMm,
            price: null,
            brand: null,
            license: 'CC0 (Poly Haven)',
          },
          packed.glb,
          packed.thumbnail
        )
      })().finally(() => importing.delete(key))
      importing.set(key, job)
    }
    return reply.code(201).send({ data: await job })
  })

  // ── Share links (virtual tour) ──────────────────────────────────────────

  // POST /api/designer/projects/:id/shares { title, message?, renderIds, expiresInDays? }
  app.post('/projects/:id/shares', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!(await ownedProject(userId, id))) return reply.code(404).send({ error: 'Project not found' })
    const body = shareSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error', message: body.error.message })
    const renderIds = [...new Set(body.data.renderIds)]
    const found = await db
      .select({ id: designAssets.id })
      .from(designAssets)
      .where(and(inArray(designAssets.id, renderIds), eq(designAssets.projectId, id), eq(designAssets.userId, userId), inArray(designAssets.kind, [...RENDER_KINDS])))
    if (found.length !== renderIds.length) throw httpError(400, 'Some selected renders no longer exist')
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(designShares)
      .where(and(eq(designShares.projectId, id), sql`${designShares.revokedAt} IS NULL`))
    if (Number(n) >= 20) throw httpError(409, 'This design already has 20 active links. Revoke an old one first.')

    const shareId = crypto.randomUUID()
    await db.insert(designShares).values({
      id: shareId,
      userId,
      projectId: id,
      token: randomBytes(24).toString('base64url'),
      title: body.data.title,
      message: body.data.message || null,
      renderIds,
      expiresAt: body.data.expiresInDays != null ? new Date(Date.now() + body.data.expiresInDays * 86_400_000) : null,
    })
    const [row] = await db.select().from(designShares).where(eq(designShares.id, shareId)).limit(1)
    return reply.code(201).send({ data: row })
  })

  // GET /api/designer/projects/:id/shares
  app.get('/projects/:id/shares', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await ownedProject(request.user.sub, id))) return reply.code(404).send({ error: 'Project not found' })
    const rows = await db
      .select()
      .from(designShares)
      .where(and(eq(designShares.projectId, id), eq(designShares.userId, request.user.sub)))
      .orderBy(desc(designShares.createdAt))
    return reply.send({ data: rows })
  })

  // DELETE /api/designer/shares/:id — revokes the link (renders stay in the project)
  app.delete('/shares/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const [s] = await db.select({ id: designShares.id }).from(designShares).where(and(eq(designShares.id, id), eq(designShares.userId, userId))).limit(1)
    if (!s) return reply.code(404).send({ error: 'Link not found' })
    await db.update(designShares).set({ revokedAt: new Date() }).where(eq(designShares.id, id))
    return reply.code(204).send()
  })
}
