import { FastifyInstance } from 'fastify'
import { and, eq, inArray } from 'drizzle-orm'
import { db, users, designAssets, designProjects, designShares } from '../../db'
import { displayName, sendWithRange } from '../../designer/http'

// Virtual-tour links are opened without an account: every route here is public and
// only ever reveals the renders the designer put on the link.

const SHARED_KINDS = ['render', 'panorama', 'video'] as const

async function liveShare(token: string) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null
  const [s] = await db.select().from(designShares).where(eq(designShares.token, token)).limit(1)
  if (!s || s.revokedAt || (s.expiresAt && s.expiresAt.getTime() < Date.now())) return null
  return s
}

export default async function designerPublicRoutes(app: FastifyInstance) {
  // Relative to the API base URL (the frontend prefixes its configured base).
  const assetPath = (token: string, id: string) => `/designer-public/shares/${token}/assets/${id}`

  // GET /api/designer-public/shares/:token
  app.get('/shares/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const s = await liveShare(token)
    if (!s) return reply.code(404).send({ error: 'Not found', message: 'This link has expired or was removed.' })
    const [owner] = await db
      .select({ companyName: users.companyName, companyLogoUrl: users.companyLogoUrl, companyPhone: users.companyPhone, companyWebsite: users.companyWebsite, name: users.name })
      .from(users)
      .where(eq(users.id, s.userId))
      .limit(1)
    const [project] = await db.select({ name: designProjects.name }).from(designProjects).where(eq(designProjects.id, s.projectId)).limit(1)
    const ids = s.renderIds as string[]
    const rows = ids.length
      ? await db
          .select({ id: designAssets.id, kind: designAssets.kind, name: designAssets.name, mimeType: designAssets.mimeType, width: designAssets.width, height: designAssets.height })
          .from(designAssets)
          .where(and(inArray(designAssets.id, ids), eq(designAssets.userId, s.userId), inArray(designAssets.kind, [...SHARED_KINDS])))
      : []
    const byId = new Map(rows.map((r) => [r.id, r]))
    // Keep the order the designer picked; skip renders deleted since.
    const items = ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({ ...r, name: displayName(r.name), path: assetPath(token, r.id) }))
    return reply.header('Cache-Control', 'no-store').send({
      data: {
        title: s.title,
        message: s.message,
        projectName: project?.name ?? s.title,
        company: {
          name: owner?.companyName || owner?.name || null,
          logoUrl: owner?.companyLogoUrl ?? null,
          phone: owner?.companyPhone ?? null,
          website: owner?.companyWebsite ?? null,
        },
        items,
        createdAt: s.createdAt,
      },
    })
  })

  // GET /api/designer-public/shares/:token/assets/:id — only renders that belong to the link
  app.get('/shares/:token/assets/:id', async (request, reply) => {
    const { token, id } = request.params as { token: string; id: string }
    const s = await liveShare(token)
    if (!s || !(s.renderIds as string[]).includes(id)) return reply.code(404).send({ error: 'Not found' })
    const [a] = await db
      .select({ data: designAssets.data, mimeType: designAssets.mimeType, sha256: designAssets.sha256 })
      .from(designAssets)
      .where(and(eq(designAssets.id, id), eq(designAssets.userId, s.userId), inArray(designAssets.kind, [...SHARED_KINDS])))
      .limit(1)
    if (!a) return reply.code(404).send({ error: 'Not found' })
    reply
      .header('Content-Type', a.mimeType)
      .header('Cache-Control', 'private, max-age=3600')
      .header('ETag', `"${a.sha256}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Accept-Ranges', 'bytes')
    return sendWithRange(request, reply, a.data)
  })
}
