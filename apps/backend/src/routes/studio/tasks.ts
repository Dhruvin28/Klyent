import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc, asc, sql } from 'drizzle-orm'
import { db, studioTasks } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { findProjectByName } from '../../studio/projectService'

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

const updateTaskSchema = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: z.string().optional(),
})

export default async function studioTaskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/tasks
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const result = listQuerySchema.safeParse(request.query)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }
    const { projectName, status, limit } = result.data
    let { projectId } = result.data
    if (!projectId && projectName) {
      const project = await findProjectByName(userId, projectName)
      projectId = project?.id
    }

    const conditions = [eq(studioTasks.userId, userId)]
    if (projectId) conditions.push(eq(studioTasks.projectId, projectId))
    if (status) conditions.push(eq(studioTasks.status, status))

    const tasks = await db
      .select()
      .from(studioTasks)
      .where(and(...conditions))
      .orderBy(sql`(${studioTasks.dueDate} IS NULL)`, asc(studioTasks.dueDate), desc(studioTasks.createdAt))
      .limit(limit)

    return reply.send({ data: tasks })
  })

  // PATCH /api/studio/tasks/:id
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = updateTaskSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const [existing] = await db
      .select()
      .from(studioTasks)
      .where(and(eq(studioTasks.id, id), eq(studioTasks.userId, userId)))
      .limit(1)
    if (!existing) return reply.code(404).send({ error: 'Task not found' })

    const { dueDate, ...rest } = result.data
    await db
      .update(studioTasks)
      .set({ ...rest, ...(dueDate ? { dueDate: new Date(dueDate) } : {}) })
      .where(eq(studioTasks.id, id))

    const [updated] = await db.select().from(studioTasks).where(eq(studioTasks.id, id)).limit(1)
    return reply.send({ data: updated })
  })
}
