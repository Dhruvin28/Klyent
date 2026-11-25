import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db, studioQuotes, studioVendors, studioMaterials } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { findProjectByName } from '../../studio/projectService'

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export default async function studioQuoteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/quotes
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

    const conditions = [eq(studioQuotes.userId, userId)]
    if (projectId) conditions.push(eq(studioQuotes.projectId, projectId))

    const quotes = await db
      .select({
        id: studioQuotes.id,
        projectId: studioQuotes.projectId,
        description: studioQuotes.description,
        price: studioQuotes.price,
        unit: studioQuotes.unit,
        status: studioQuotes.status,
        quoteDate: studioQuotes.quoteDate,
        createdAt: studioQuotes.createdAt,
        vendorName: studioVendors.name,
        materialName: studioMaterials.name,
      })
      .from(studioQuotes)
      .leftJoin(studioVendors, eq(studioVendors.id, studioQuotes.vendorId))
      .leftJoin(studioMaterials, eq(studioMaterials.id, studioQuotes.materialId))
      .where(and(...conditions))
      .orderBy(desc(studioQuotes.createdAt))
      .limit(limit)

    return reply.send({ data: quotes })
  })
}
