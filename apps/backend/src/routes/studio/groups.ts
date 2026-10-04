import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db, studioWhatsappGroups } from '../../db'
import { authenticate } from '../../middleware/authenticate'

const createGroupSchema = z.object({
  name: z.string().min(1).max(255),
  groupType: z.string().max(50).optional(),
  projectId: z.string().optional(),
  externalGroupId: z.string().max(255).optional(),
})

const updateGroupSchema = z.object({
  projectId: z.string().nullable().optional(),
  groupType: z.string().max(50).optional(),
})

export default async function studioGroupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/groups — maps WhatsApp groups to projects
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const groups = await db
      .select()
      .from(studioWhatsappGroups)
      .where(eq(studioWhatsappGroups.userId, userId))
      .orderBy(desc(studioWhatsappGroups.createdAt))
    return reply.send({ data: groups })
  })

  // POST /api/studio/groups — pre-register a group (optional; groups are
  // also auto-created on first ingested message).
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = createGroupSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }
    const id = crypto.randomUUID()
    await db.insert(studioWhatsappGroups).values({ id, userId, ...result.data })
    const [group] = await db.select().from(studioWhatsappGroups).where(eq(studioWhatsappGroups.id, id)).limit(1)
    return reply.code(201).send({ data: group })
  })

  // PATCH /api/studio/groups/:id — (re)assign a group to a project
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = updateGroupSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const [existing] = await db
      .select()
      .from(studioWhatsappGroups)
      .where(and(eq(studioWhatsappGroups.id, id), eq(studioWhatsappGroups.userId, userId)))
      .limit(1)
    if (!existing) return reply.code(404).send({ error: 'Group not found' })

    await db.update(studioWhatsappGroups).set(result.data).where(eq(studioWhatsappGroups.id, id))
    const [updated] = await db.select().from(studioWhatsappGroups).where(eq(studioWhatsappGroups.id, id)).limit(1)
    return reply.send({ data: updated })
  })
}
