import { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db, users } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { generateIngestionKey, hashIngestionKey } from '../../middleware/studioIngestionKey'

export default async function studioSettingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/settings — whether an ingestion key has been generated yet
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const [user] = await db.select({ hash: users.studioIngestionKeyHash }).from(users).where(eq(users.id, userId)).limit(1)
    return reply.send({ data: { hasIngestionKey: !!user?.hash } })
  })

  /**
   * POST /api/studio/settings/ingestion-key — (re)generate the per-user key
   * used by a WhatsApp capture bridge/importer to call POST /api/studio/messages.
   * The raw key is returned exactly once and never stored in plaintext.
   */
  app.post('/ingestion-key', async (request, reply) => {
    const userId = request.user.sub
    const key = generateIngestionKey()
    await db.update(users).set({ studioIngestionKeyHash: hashIngestionKey(key) }).where(eq(users.id, userId))
    return reply.send({ data: { ingestionApiKey: key } })
  })
}
