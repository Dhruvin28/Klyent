import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db, studioDecisions } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { findProjectByName } from '../../studio/projectService'

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export default async function studioDecisionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/decisions
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const result = listQuerySchema.safeParse(request.query)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }
    const { projectName, limit } = result.data
    let { projectId } = result.data
    if (!projectId && projectName) {
      const project = await findProjectByName(userId, projectName)
      projectId = project?.id
    }

    const conditions = [eq(studioDecisions.userId, userId)]
    if (projectId) conditions.push(eq(studioDecisions.projectId, projectId))

    const decisions = await db
      .select()
      .from(studioDecisions)
      .where(and(...conditions))
      .orderBy(desc(studioDecisions.createdAt))
      .limit(limit)

    return reply.send({ data: decisions })
  })
}
