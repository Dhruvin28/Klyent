import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { db, clients, vizAssets, vizExports, vizMaterials, vizProjects } from '../../db'
import {
  VizImageError,
  assertWorkingSize,
  decodePng,
  pngDimensions,
  runExclusive,
  sha256,
  sniffImageMime,
  verifyComposite,
} from '../../visualizer/imageCheck'
import {
  initialState,
  materialFieldsSchema,
  referencedMaskIds,
  referencedMaterialIds,
  vizStateSchema,
  type VizState,
} from '../../visualizer/state'

type AssetKind = typeof vizAssets.$inferInsert['kind']

interface UploadedFile {
  buffer: Buffer
  filename: string
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode })
}

/**
 * Drains a multipart request into text fields + named files. Unlike the shared
 * parseMultipart helper this accepts several files keyed by field name
 * (e.g. original + reference + thumbnail), each capped at maxAssetSize.
 */
async function parseFiles(request: FastifyRequest, allowed: string[]) {
  const fields: Record<string, string> = {}
  const files: Record<string, UploadedFile> = {}
  if (!request.isMultipart()) throw httpError(415, 'Expected multipart/form-data')
  const parts = request.parts({ limits: { files: allowed.length, fields: 10, fileSize: config.visualizer.maxAssetSize, fieldSize: 1024 * 1024 } })
  for await (const part of parts) {
    if (part.type === 'file') {
      const chunks: Buffer[] = []
      for await (const chunk of part.file) chunks.push(chunk as Buffer)
      if (part.file.truncated) {
        throw httpError(413, `"${part.filename}" is too large (max ${config.visualizer.maxAssetSize / (1024 * 1024)}MB).`)
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

function parseJsonField<T>(raw: string | undefined, schema: z.ZodType<T>, label: string): T {
  let value: unknown
  try {
    value = JSON.parse(raw ?? '')
  } catch {
    throw httpError(400, `${label} must be valid JSON`)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw httpError(400, `${label}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  return parsed.data
}

function safeName(name: string, fallback: string) {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim().slice(0, 200)
  return cleaned || fallback
}

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

// 30 surfaces + protect, with headroom for masks uploaded by saves still in flight.
const MAX_MASKS_PER_PROJECT = 120

export default async function visualizerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // Image validation failures are client errors, not 500s.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof VizImageError) return reply.code(422).send({ error: 'Invalid image', message: error.message })
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'File too large', message: error.message })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.name ?? 'Error', message: error.message })
    }
    request.log.error({ err: error }, 'Visualizer request failed')
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
    })
  })

  async function insertAsset(
    userId: string,
    kind: AssetKind,
    file: { buffer: Buffer; name: string; mimeType: string; width?: number; height?: number },
    links: { projectId?: string | null; materialId?: string | null } = {}
  ) {
    const id = crypto.randomUUID()
    await db.insert(vizAssets).values({
      id,
      userId,
      projectId: links.projectId ?? null,
      materialId: links.materialId ?? null,
      kind,
      name: file.name,
      mimeType: file.mimeType,
      size: file.buffer.length,
      width: file.width ?? null,
      height: file.height ?? null,
      sha256: sha256(file.buffer),
      data: file.buffer,
    })
    return id
  }

  async function ownedProject(userId: string, id: string) {
    const [p] = await db.select().from(vizProjects).where(and(eq(vizProjects.id, id), eq(vizProjects.userId, userId))).limit(1)
    return p
  }

  async function ownedMaterial(userId: string, id: string) {
    const [m] = await db.select().from(vizMaterials).where(and(eq(vizMaterials.id, id), eq(vizMaterials.userId, userId))).limit(1)
    return m
  }

  async function assertClient(userId: string, clientId: string | null | undefined) {
    if (!clientId) return
    const [c] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.userId, userId))).limit(1)
    if (!c) throw httpError(400, 'Client not found')
  }

  function serializeProject(p: typeof vizProjects.$inferSelect) {
    return { ...p, state: p.state as VizState }
  }

  function serializeMaterial(m: typeof vizMaterials.$inferSelect) {
    return {
      ...m,
      widthMm: m.widthMm === null ? null : Number(m.widthMm),
      heightMm: m.heightMm === null ? null : Number(m.heightMm),
    }
  }

  // ── Projects ────────────────────────────────────────────────────────────

  // GET /api/visualizer/projects
  app.get('/projects', async (request, reply) => {
    const rows = await db
      .select({
        id: vizProjects.id,
        name: vizProjects.name,
        clientId: vizProjects.clientId,
        clientName: clients.name,
        width: vizProjects.width,
        height: vizProjects.height,
        thumbnailAssetId: vizProjects.thumbnailAssetId,
        createdAt: vizProjects.createdAt,
        updatedAt: vizProjects.updatedAt,
      })
      .from(vizProjects)
      .leftJoin(clients, eq(clients.id, vizProjects.clientId))
      .where(eq(vizProjects.userId, request.user.sub))
      .orderBy(desc(vizProjects.updatedAt))
      .limit(500)
    return reply.send({ data: rows })
  })

  // POST /api/visualizer/projects — multipart: name, clientId?, original, reference (lossless PNG), thumbnail?
  app.post('/projects', async (request, reply) => {
    const userId = request.user.sub
    const { fields, files } = await parseFiles(request, ['original', 'reference', 'thumbnail'])
    const name = (fields.name ?? '').trim().slice(0, 255)
    if (!name) throw httpError(400, 'Project name is required')
    const clientId = fields.clientId?.trim() || null
    await assertClient(userId, clientId)
    if (!files.original || !files.reference) throw httpError(400, 'Both the original render and its reference PNG are required')

    const originalMime = sniffImageMime(files.original.buffer)
    if (!originalMime) throw httpError(415, 'The room render must be a JPG, PNG or WebP image')

    // The reference is the browser-decoded, orientation-corrected, opaque pixel grid
    // every later edit and verification is measured against — it must be lossless.
    const { width, height } = await runExclusive(() => {
      const ref = decodePng(files.reference.buffer, 'Reference render')
      for (let i = 3; i < ref.data.length; i += 4) {
        if (ref.data[i] !== 255) throw new VizImageError('Reference render must be fully opaque.')
      }
      return { width: ref.width, height: ref.height }
    })
    assertWorkingSize(width, height)

    let thumbMime: string | null = null
    if (files.thumbnail) {
      thumbMime = sniffImageMime(files.thumbnail.buffer)
      if (!thumbMime || files.thumbnail.buffer.length > 2 * 1024 * 1024) throw httpError(400, 'Invalid thumbnail')
    }

    const projectId = crypto.randomUUID()
    const base = safeName(files.original.filename.replace(/\.[^.]+$/, ''), 'render')
    try {
      const originalAssetId = await insertAsset(
        userId,
        'original',
        { buffer: files.original.buffer, name: `${base}.${MIME_EXT[originalMime]}`, mimeType: originalMime },
        { projectId }
      )
      const referenceAssetId = await insertAsset(
        userId,
        'reference',
        { buffer: files.reference.buffer, name: `${base}-reference.png`, mimeType: 'image/png', width, height },
        { projectId }
      )
      const thumbnailAssetId = files.thumbnail
        ? await insertAsset(userId, 'thumbnail', { buffer: files.thumbnail.buffer, name: `${base}-thumb`, mimeType: thumbMime! }, { projectId })
        : null

      await db.insert(vizProjects).values({
        id: projectId,
        userId,
        clientId,
        name,
        width,
        height,
        originalAssetId,
        referenceAssetId,
        thumbnailAssetId,
        state: initialState(),
      })
    } catch (err) {
      // Don't leave orphaned blobs behind if any step failed.
      await db.delete(vizAssets).where(and(eq(vizAssets.projectId, projectId), eq(vizAssets.userId, userId))).catch(() => undefined)
      throw err
    }
    return reply.code(201).send({ data: serializeProject((await ownedProject(userId, projectId))!) })
  })

  // GET /api/visualizer/projects/:id
  app.get('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const p = await ownedProject(request.user.sub, id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    return reply.send({ data: serializeProject(p) })
  })

  // PATCH /api/visualizer/projects/:id { revision, name?, clientId?, state? }
  app.patch('/projects/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const body = z
      .object({
        revision: z.number().int().min(1),
        name: z.string().trim().min(1).max(255).optional(),
        clientId: z.string().max(128).nullable().optional(),
        state: z.unknown().optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error', message: body.error.message })
    const p = await ownedProject(userId, id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })

    const patch: Partial<typeof vizProjects.$inferInsert> = {}
    if (body.data.name !== undefined) patch.name = body.data.name
    if (body.data.clientId !== undefined) {
      await assertClient(userId, body.data.clientId)
      patch.clientId = body.data.clientId || null
    }

    let state: VizState | undefined
    if (body.data.state !== undefined) {
      const parsed = vizStateSchema.safeParse(body.data.state)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation Error',
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        })
      }
      state = parsed.data
      // Masks and materials must belong to this user (and masks to this project).
      const maskIds = [...referencedMaskIds(state)]
      if (maskIds.length) {
        const found = await db
          .select({ id: vizAssets.id })
          .from(vizAssets)
          .where(and(inArray(vizAssets.id, maskIds), eq(vizAssets.projectId, id), eq(vizAssets.userId, userId), eq(vizAssets.kind, 'mask')))
        if (found.length !== maskIds.length) return reply.code(400).send({ error: 'Validation Error', message: 'State references unknown masks' })
      }
      const materialIds = [...referencedMaterialIds(state)]
      if (materialIds.length) {
        const found = await db
          .select({ id: vizMaterials.id })
          .from(vizMaterials)
          .where(and(inArray(vizMaterials.id, materialIds), eq(vizMaterials.userId, userId)))
        if (found.length !== materialIds.length) {
          return reply.code(400).send({ error: 'Validation Error', message: 'State references unknown materials' })
        }
      }
      patch.state = state
    }

    // Optimistic concurrency: a stale tab cannot silently overwrite newer work.
    const result = await db
      .update(vizProjects)
      .set({ ...patch, revision: sql`${vizProjects.revision} + 1` })
      .where(and(eq(vizProjects.id, id), eq(vizProjects.userId, userId), eq(vizProjects.revision, body.data.revision)))
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0
    if (affected === 0) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'This project was changed in another tab or by another session. Reload to get the latest version.',
      })
    }

    if (state) {
      // Drop masks no longer referenced. Masks uploaded in the last 2 minutes are kept:
      // they may belong to a save that is still in flight.
      const keep = [...referencedMaskIds(state)]
      const conds = [
        eq(vizAssets.projectId, id),
        eq(vizAssets.kind, 'mask'),
        lt(vizAssets.createdAt, new Date(Date.now() - 2 * 60 * 1000)),
      ]
      if (keep.length) conds.push(notInArray(vizAssets.id, keep))
      await db.delete(vizAssets).where(and(...conds))
    }

    return reply.send({ data: serializeProject((await ownedProject(userId, id))!) })
  })

  // DELETE /api/visualizer/projects/:id
  app.delete('/projects/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!(await ownedProject(userId, id))) return reply.code(404).send({ error: 'Project not found' })
    await db.delete(vizExports).where(eq(vizExports.projectId, id))
    await db.delete(vizAssets).where(and(eq(vizAssets.projectId, id), eq(vizAssets.userId, userId)))
    await db.delete(vizProjects).where(eq(vizProjects.id, id))
    return reply.code(204).send()
  })

  // POST /api/visualizer/projects/:id/masks — multipart: mask (grayscale PNG, project dimensions)
  app.post('/projects/:id/masks', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const p = await ownedProject(userId, id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    // Bound storage: drop stale unreferenced masks, then cap what remains.
    const live = referencedMaskIds(p.state as VizState)
    const staleConds = [eq(vizAssets.projectId, id), eq(vizAssets.kind, 'mask'), lt(vizAssets.createdAt, new Date(Date.now() - 2 * 60 * 1000))]
    if (live.size) staleConds.push(notInArray(vizAssets.id, [...live]))
    await db.delete(vizAssets).where(and(...staleConds))
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(vizAssets)
      .where(and(eq(vizAssets.projectId, id), eq(vizAssets.kind, 'mask')))
    if (Number(n) >= MAX_MASKS_PER_PROJECT) throw httpError(429, 'Too many pending selection uploads; wait a minute and try again.')
    const { files } = await parseFiles(request, ['mask'])
    if (!files.mask) throw httpError(400, 'Mask file is required')
    const { width, height } = pngDimensions(files.mask.buffer)
    if (width !== p.width || height !== p.height) {
      throw new VizImageError(`Mask is ${width}×${height} but the render is ${p.width}×${p.height}.`)
    }
    await runExclusive(() => decodePng(files.mask.buffer, 'Mask'))
    const assetId = await insertAsset(userId, 'mask', { buffer: files.mask.buffer, name: 'mask.png', mimeType: 'image/png', width, height }, { projectId: id })
    return reply.code(201).send({ data: { id: assetId } })
  })

  // ── Assets ──────────────────────────────────────────────────────────────

  // GET /api/visualizer/assets/:id[?download=1] — raw bytes, owner only
  app.get('/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { download } = request.query as { download?: string }
    const [a] = await db
      .select()
      .from(vizAssets)
      .where(and(eq(vizAssets.id, id), eq(vizAssets.userId, request.user.sub)))
      .limit(1)
    if (!a) return reply.code(404).send({ error: 'Asset not found' })
    const disposition = download === '1' ? 'attachment' : 'inline'
    return reply
      .header('Content-Type', a.mimeType)
      .header('Content-Length', String(a.data.length))
      .header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(a.name)}`)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('ETag', `"${a.sha256}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(a.data)
  })

  // ── Materials library ───────────────────────────────────────────────────

  app.get('/materials', async (request, reply) => {
    const rows = await db
      .select()
      .from(vizMaterials)
      .where(eq(vizMaterials.userId, request.user.sub))
      .orderBy(desc(vizMaterials.updatedAt))
      .limit(1000)
    return reply.send({ data: rows.map(serializeMaterial) })
  })

  /** Validates and stores a texture/sample pair; returns the column patch for viz_materials. */
  async function storeTextureFiles(userId: string, materialId: string, files: Record<string, UploadedFile>) {
    const patch: Partial<typeof vizMaterials.$inferInsert> = {}
    if (files.texture) {
      const { width, height } = pngDimensions(files.texture.buffer)
      const max = config.visualizer.maxTextureSide
      if (width < 8 || height < 8 || width > max || height > max) {
        throw new VizImageError(`Prepared texture must be between 8 and ${max}px per side.`)
      }
      await runExclusive(() => decodePng(files.texture.buffer, 'Texture'))
      patch.textureAssetId = await insertAsset(
        userId,
        'material_texture',
        { buffer: files.texture.buffer, name: 'texture.png', mimeType: 'image/png', width, height },
        { materialId }
      )
      patch.textureWidth = width
      patch.textureHeight = height
    }
    if (files.source) {
      const mime = sniffImageMime(files.source.buffer)
      if (!mime) throw httpError(415, 'Material sample must be a JPG, PNG or WebP image')
      patch.sourceAssetId = await insertAsset(
        userId,
        'material_source',
        { buffer: files.source.buffer, name: safeName(files.source.filename, `sample.${MIME_EXT[mime]}`), mimeType: mime },
        { materialId }
      )
    }
    return patch
  }

  function validateMaterialShape(m: { kind: string; colorHex?: string | null; textureAssetId?: string | null; widthMm?: unknown; heightMm?: unknown }) {
    if (m.kind === 'paint' && !m.colorHex) throw httpError(400, 'A paint colour is required')
    if (m.kind === 'texture') {
      if (!m.textureAssetId) throw httpError(400, 'A prepared texture is required for texture materials')
      if (!m.widthMm || !m.heightMm) throw httpError(400, 'Physical width and height of the sample are required')
    }
  }

  // POST /api/visualizer/materials — multipart: data (JSON), texture? (PNG), source? (original sample)
  app.post('/materials', async (request, reply) => {
    const userId = request.user.sub
    const { fields, files } = await parseFiles(request, ['texture', 'source'])
    const data = parseJsonField(fields.data, materialFieldsSchema, 'data')
    const id = crypto.randomUUID()
    const texturePatch = data.kind === 'texture' ? await storeTextureFiles(userId, id, files) : {}
    const row = {
      id,
      userId,
      name: data.name,
      kind: data.kind,
      category: data.category,
      colorHex: data.kind === 'paint' ? data.colorHex?.toLowerCase() ?? null : null,
      widthMm: data.widthMm != null ? String(data.widthMm) : null,
      heightMm: data.heightMm != null ? String(data.heightMm) : null,
      brand: data.brand || null,
      code: data.code || null,
      notes: data.notes || null,
      settings: data.settings ?? null,
      ...texturePatch,
    }
    try {
      validateMaterialShape(row)
    } catch (err) {
      await db.delete(vizAssets).where(eq(vizAssets.materialId, id))
      throw err
    }
    await db.insert(vizMaterials).values(row)
    return reply.code(201).send({ data: serializeMaterial((await ownedMaterial(userId, id))!) })
  })

  // PATCH /api/visualizer/materials/:id — JSON or multipart (data + optional new texture/source)
  app.patch('/materials/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const existing = await ownedMaterial(userId, id)
    if (!existing) return reply.code(404).send({ error: 'Material not found' })

    let raw: unknown
    let files: Record<string, UploadedFile> = {}
    if (request.isMultipart()) {
      const parsed = await parseFiles(request, ['texture', 'source'])
      files = parsed.files
      try {
        raw = JSON.parse(parsed.fields.data ?? '{}')
      } catch {
        throw httpError(400, 'data must be valid JSON')
      }
    } else {
      raw = request.body
    }
    const body = materialFieldsSchema.partial().safeParse(raw)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error', message: body.error.message })
    const d = body.data
    if (d.kind && d.kind !== existing.kind) throw httpError(400, 'Material kind cannot be changed')

    const patch: Partial<typeof vizMaterials.$inferInsert> = {}
    if (d.name !== undefined) patch.name = d.name
    if (d.category !== undefined) patch.category = d.category
    if (d.colorHex !== undefined && existing.kind === 'paint') patch.colorHex = d.colorHex?.toLowerCase() ?? null
    if (d.widthMm !== undefined) patch.widthMm = d.widthMm != null ? String(d.widthMm) : null
    if (d.heightMm !== undefined) patch.heightMm = d.heightMm != null ? String(d.heightMm) : null
    if (d.brand !== undefined) patch.brand = d.brand || null
    if (d.code !== undefined) patch.code = d.code || null
    if (d.notes !== undefined) patch.notes = d.notes || null
    if (d.settings !== undefined) patch.settings = d.settings
    validateMaterialShape({ ...existing, ...patch, textureAssetId: files.texture ? 'pending' : existing.textureAssetId })
    if (existing.kind === 'texture') Object.assign(patch, await storeTextureFiles(userId, id, files))
    await db.update(vizMaterials).set(patch).where(eq(vizMaterials.id, id))

    // Replaced texture/sample blobs are no longer reachable.
    const stale: string[] = []
    if (patch.textureAssetId && existing.textureAssetId) stale.push(existing.textureAssetId)
    if (patch.sourceAssetId && existing.sourceAssetId) stale.push(existing.sourceAssetId)
    if (stale.length) await db.delete(vizAssets).where(and(inArray(vizAssets.id, stale), eq(vizAssets.userId, userId)))

    return reply.send({ data: serializeMaterial((await ownedMaterial(userId, id))!) })
  })

  // DELETE /api/visualizer/materials/:id — refused while any project option uses it
  app.delete('/materials/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    if (!(await ownedMaterial(userId, id))) return reply.code(404).send({ error: 'Material not found' })
    const projects = await db
      .select({ name: vizProjects.name, state: vizProjects.state })
      .from(vizProjects)
      .where(eq(vizProjects.userId, userId))
    const usedIn = projects.filter((p) => referencedMaterialIds(p.state as VizState).has(id)).map((p) => p.name)
    if (usedIn.length) {
      return reply.code(409).send({
        error: 'Material in use',
        message: `Remove it from these projects first: ${usedIn.slice(0, 5).join(', ')}${usedIn.length > 5 ? '…' : ''}`,
      })
    }
    await db.delete(vizAssets).where(and(eq(vizAssets.materialId, id), eq(vizAssets.userId, userId)))
    await db.delete(vizMaterials).where(eq(vizMaterials.id, id))
    return reply.code(204).send()
  })

  // ── Exports (verified) ──────────────────────────────────────────────────

  const exportDataSchema = z.object({
    optionId: z.string().min(1).max(128),
    details: z.record(z.unknown()),
  })

  // POST /api/visualizer/projects/:id/exports — multipart: data (JSON), image (PNG), mask (PNG)
  app.post('/projects/:id/exports', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const p = await ownedProject(userId, id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    const { fields, files } = await parseFiles(request, ['image', 'mask'])
    const data = parseJsonField(fields.data, exportDataSchema, 'data')
    if (JSON.stringify(data.details).length > 256 * 1024) throw httpError(400, 'Export details are too large')
    const state = p.state as VizState
    const option = state.options.find((o) => o.id === data.optionId)
    if (!option) throw httpError(400, 'Unknown option')
    if (!files.image || !files.mask) throw httpError(400, 'Both the exported image and its edit mask are required')

    const [ref] = await db
      .select({ data: vizAssets.data })
      .from(vizAssets)
      .where(and(eq(vizAssets.id, p.referenceAssetId), eq(vizAssets.userId, userId)))
      .limit(1)
    if (!ref) throw httpError(500, 'Reference render is missing')

    // Saved selections the client-supplied edit mask must stay within.
    const assigned = state.surfaces.filter((s) => option.assignments[s.id] && s.maskAssetId)
    const maskIds = assigned.map((s) => s.maskAssetId!)
    if (state.protectMaskAssetId) maskIds.push(state.protectMaskAssetId)
    const maskRows = maskIds.length
      ? await db
          .select({ id: vizAssets.id, data: vizAssets.data })
          .from(vizAssets)
          .where(and(inArray(vizAssets.id, maskIds), eq(vizAssets.projectId, id), eq(vizAssets.userId, userId)))
      : []
    const byId = new Map(maskRows.map((r) => [r.id, r.data]))
    if (maskIds.some((m) => !byId.has(m))) throw httpError(409, 'Saved selections are missing; reload the project and try again.')
    // Feathering = three box blurs of radius round(f) → spreads up to 3·round(f) px.
    const spread = Math.max(1, ...assigned.map((s) => 3 * Math.max(1, Math.round(s.feather)) + 1))

    const verification = await runExclusive(() =>
      verifyComposite(ref.data, files.image.buffer, files.mask.buffer, {
        surfaceMasks: assigned.map((s) => byId.get(s.maskAssetId!)!),
        protectMask: state.protectMaskAssetId ? byId.get(state.protectMaskAssetId)! : null,
        spread,
      })
    )
    if (!verification.ok) {
      request.log.warn({ projectId: id, verification }, 'Visualizer export rejected by verification')
      const reasons = [
        verification.changedOutsideMask ? `${verification.changedOutsideMask} pixel(s) outside the editing mask differ from the original render` : '',
        verification.maskOutsideSurfaces ? `the edit mask covers ${verification.maskOutsideSurfaces} pixel(s) outside the saved surface selections` : '',
        verification.maskOnProtected ? `the edit mask covers ${verification.maskOnProtected} protected pixel(s)` : '',
      ].filter(Boolean)
      return reply.code(422).send({
        error: 'Verification failed',
        message: `${reasons.join('; ')}. Export was not saved.`,
        verification,
      })
    }

    const slug = safeName(`${p.name} - ${option.name}`, 'export')
    const imageAssetId = await insertAsset(
      userId,
      'export_image',
      { buffer: files.image.buffer, name: `${slug}.png`, mimeType: 'image/png', width: p.width, height: p.height },
      { projectId: id }
    )
    const maskAssetId = await insertAsset(
      userId,
      'export_mask',
      { buffer: files.mask.buffer, name: `${slug} - edit mask.png`, mimeType: 'image/png', width: p.width, height: p.height },
      { projectId: id }
    )
    const exportId = crypto.randomUUID()
    await db.insert(vizExports).values({
      id: exportId,
      userId,
      projectId: id,
      optionId: option.id,
      optionName: option.name,
      imageAssetId,
      maskAssetId,
      details: data.details,
      verification,
    })
    const [row] = await db.select().from(vizExports).where(eq(vizExports.id, exportId)).limit(1)
    return reply.code(201).send({ data: row })
  })

  // GET /api/visualizer/projects/:id/exports
  app.get('/projects/:id/exports', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await ownedProject(request.user.sub, id))) return reply.code(404).send({ error: 'Project not found' })
    const rows = await db
      .select()
      .from(vizExports)
      .where(and(eq(vizExports.projectId, id), eq(vizExports.userId, request.user.sub)))
      .orderBy(desc(vizExports.createdAt))
    return reply.send({ data: rows })
  })

  // DELETE /api/visualizer/exports/:id
  app.delete('/exports/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const [e] = await db.select().from(vizExports).where(and(eq(vizExports.id, id), eq(vizExports.userId, userId))).limit(1)
    if (!e) return reply.code(404).send({ error: 'Export not found' })
    await db.delete(vizAssets).where(and(inArray(vizAssets.id, [e.imageAssetId, e.maskAssetId]), eq(vizAssets.userId, userId)))
    await db.delete(vizExports).where(eq(vizExports.id, id))
    return reply.code(204).send()
  })
}
