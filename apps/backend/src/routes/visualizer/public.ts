import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db, users, vizAssets, vizProjects, vizShares, type VizShareComment, type VizShareOption } from '../../db'

// Client review links are opened without an account: every route here is public and
// only ever reveals what the designer put on the link.

const MAX_COMMENTS = 200

/** Client address; App Service puts the caller first in X-Forwarded-For. */
function clientIp(request: FastifyRequest): string {
  const fwd = request.headers['x-forwarded-for']
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
  return first || request.ip
}

/** Small in-memory limiter for public writes (per client IP and link). */
const hits = new Map<string, number[]>()
function limited(key: string, max = 20, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k)
  }
  return recent.length > max
}

async function liveShare(token: string) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null
  const [s] = await db.select().from(vizShares).where(eq(vizShares.token, token)).limit(1)
  if (!s || s.revokedAt || (s.expiresAt && s.expiresAt.getTime() < Date.now())) return null
  return s
}

const decisionSchema = z.object({
  optionId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2000).default(''),
})

const commentSchema = z.object({
  optionId: z.string().min(1).max(128).nullable().default(null),
  name: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(2000),
})

export default async function visualizerPublicRoutes(app: FastifyInstance) {
  // Relative to the API base URL (the frontend prefixes its configured base).
  const assetPath = (token: string, id: string) => `/visualizer-public/shares/${token}/assets/${id}`

  // GET /api/visualizer-public/shares/:token
  app.get('/shares/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const s = await liveShare(token)
    if (!s) return reply.code(404).send({ error: 'Not found', message: 'This review link has expired or was removed.' })
    const [owner] = await db
      .select({ companyName: users.companyName, companyLogoUrl: users.companyLogoUrl, companyPhone: users.companyPhone, companyWebsite: users.companyWebsite, name: users.name })
      .from(users)
      .where(eq(users.id, s.userId))
      .limit(1)
    const [project] = await db.select({ name: vizProjects.name }).from(vizProjects).where(eq(vizProjects.id, s.projectId)).limit(1)
    const options = (s.options as VizShareOption[]).map((o) => ({
      optionId: o.optionId,
      name: o.name,
      notes: o.notes,
      image: assetPath(token, o.imageAssetId),
      total: s.showPrices ? o.total : null,
      areaSqft: o.areaSqft,
      materials: o.materials,
    }))
    return reply.header('Cache-Control', 'no-store').send({
      data: {
        title: s.title,
        message: s.message,
        projectName: project?.name ?? s.title,
        designer: {
          name: owner?.companyName || owner?.name || 'Your designer',
          logoUrl: owner?.companyLogoUrl ?? null,
          phone: owner?.companyPhone ?? null,
          website: owner?.companyWebsite ?? null,
        },
        original: assetPath(token, s.originalAssetId),
        options,
        showPrices: s.showPrices,
        decision: s.decision ?? null,
        comments: s.comments ?? [],
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      },
    })
  })

  // GET /api/visualizer-public/shares/:token/assets/:id — only images that belong to the link
  app.get('/shares/:token/assets/:id', async (request, reply) => {
    const { token, id } = request.params as { token: string; id: string }
    const s = await liveShare(token)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const allowed = new Set([s.originalAssetId, ...(s.options as VizShareOption[]).map((o) => o.imageAssetId)])
    if (!allowed.has(id)) return reply.code(404).send({ error: 'Not found' })
    const [a] = await db
      .select({ data: vizAssets.data, mimeType: vizAssets.mimeType, sha256: vizAssets.sha256 })
      .from(vizAssets)
      .where(and(eq(vizAssets.id, id), eq(vizAssets.userId, s.userId), eq(vizAssets.kind, 'share_image')))
      .limit(1)
    if (!a) return reply.code(404).send({ error: 'Not found' })
    return reply
      .header('Content-Type', a.mimeType)
      .header('Content-Length', String(a.data.length))
      .header('Cache-Control', 'private, max-age=3600')
      .header('ETag', `"${a.sha256}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(a.data)
  })

  // POST /api/visualizer-public/shares/:token/decision { optionId, name, comment }
  app.post('/shares/:token/decision', async (request, reply) => {
    const { token } = request.params as { token: string }
    if (limited(`${clientIp(request)}|${token}`)) return reply.code(429).send({ error: 'Too many requests', message: 'Please wait a few minutes and try again.' })
    const s = await liveShare(token)
    if (!s) return reply.code(404).send({ error: 'Not found', message: 'This review link has expired or was removed.' })
    const body = decisionSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error', message: 'Enter your name and choose an option.' })
    const option = (s.options as VizShareOption[]).find((o) => o.optionId === body.data.optionId)
    if (!option) return reply.code(400).send({ error: 'Validation Error', message: 'Unknown option' })
    const now = new Date().toISOString()
    const decision = { optionId: option.optionId, optionName: option.name, clientName: body.data.name, comment: body.data.comment ?? '', decidedAt: now }
    // The decision also lands in the comment trail, so a change of mind stays visible to the designer.
    const comments = [...((s.comments ?? []) as VizShareComment[])]
    if (comments.length < MAX_COMMENTS) {
      comments.push({
        id: crypto.randomUUID(),
        optionId: option.optionId,
        name: body.data.name,
        message: `Approved ${option.name}${body.data.comment ? ` — ${body.data.comment}` : ''}`,
        createdAt: now,
      })
    }
    await db.update(vizShares).set({ decision, comments }).where(eq(vizShares.id, s.id))
    return reply.send({ data: { decision, comments } })
  })

  // POST /api/visualizer-public/shares/:token/comments { optionId?, name, message }
  app.post('/shares/:token/comments', async (request, reply) => {
    const { token } = request.params as { token: string }
    if (limited(`${clientIp(request)}|${token}`)) return reply.code(429).send({ error: 'Too many requests', message: 'Please wait a few minutes and try again.' })
    const s = await liveShare(token)
    if (!s) return reply.code(404).send({ error: 'Not found', message: 'This review link has expired or was removed.' })
    const body = commentSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error', message: 'Enter your name and a message.' })
    if (body.data.optionId && !(s.options as VizShareOption[]).some((o) => o.optionId === body.data.optionId)) {
      return reply.code(400).send({ error: 'Validation Error', message: 'Unknown option' })
    }
    const comments = [...((s.comments ?? []) as VizShareComment[])]
    if (comments.length >= MAX_COMMENTS) return reply.code(409).send({ error: 'Conflict', message: 'This link has reached its comment limit.' })
    comments.push({ id: crypto.randomUUID(), optionId: body.data.optionId ?? null, name: body.data.name, message: body.data.message, createdAt: new Date().toISOString() })
    await db.update(vizShares).set({ comments }).where(eq(vizShares.id, s.id))
    return reply.code(201).send({ data: { comments } })
  })
}
