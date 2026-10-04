import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { hybridSearch } from '../../studio/search'
import { findProjectByName } from '../../studio/projectService'

const searchSchema = z.object({
  query: z.string().min(1),
  projectName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export default async function studioSearchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/search?query=...&projectName=...
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const result = searchSchema.safeParse(request.query)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }
    const project = result.data.projectName ? await findProjectByName(userId, result.data.projectName) : null
    const results = await hybridSearch(userId, result.data.query, { projectId: project?.id ?? null, limit: result.data.limit })
    return reply.send({ data: results })
  })
}
