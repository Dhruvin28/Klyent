import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc, count } from 'drizzle-orm'
import { db, clients, activityLogs, users } from '../../db'
import { authenticate } from '../../middleware/authenticate'

const listQuerySchema = z.object({
  clientId: z.string().optional(),
  type: z
    .enum([
      'PAYMENT_ADDED',
      'PAYMENT_UPDATED',
      'PAYMENT_DELETED',
      'FILE_UPLOADED',
      'FILE_VERSION_ADDED',
      'STATUS_CHANGED',
      'CLIENT_CREATED',
      'CLIENT_UPDATED',
      'COMMENT_ADDED',
    ])
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export default async function activityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/activity
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const queryResult = listQuerySchema.safeParse(request.query)

    if (!queryResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: queryResult.error.flatten().fieldErrors,
      })
    }

    const { clientId, type, page, limit } = queryResult.data
    const skip = (page - 1) * limit

    // If clientId provided, verify ownership
    if (clientId) {
      const [client] = await db
        .select({ userId: clients.userId })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1)
      if (!client) {
        return reply.code(404).send({ error: 'Client not found' })
      }
      if (client.userId !== userId) {
        return reply.code(403).send({ error: 'Forbidden' })
      }
    }

    // Build conditions
    const conditions = [eq(clients.userId, userId)]
    if (clientId) conditions.push(eq(activityLogs.clientId, clientId))
    if (type) conditions.push(eq(activityLogs.type, type))

    const whereClause = and(...conditions)

    const [logs, [{ total }]] = await Promise.all([
      db
        .select({
          id: activityLogs.id,
          type: activityLogs.type,
          metadata: activityLogs.metadata,
          clientId: activityLogs.clientId,
          userId: activityLogs.userId,
          createdAt: activityLogs.createdAt,
          userName: users.name,
          userEmail: users.email,
          userId2: users.id,
          clientName: clients.name,
          clientId2: clients.id,
        })
        .from(activityLogs)
        .innerJoin(clients, eq(activityLogs.clientId, clients.id))
        .innerJoin(users, eq(activityLogs.userId, users.id))
        .where(whereClause)
        .orderBy(desc(activityLogs.createdAt))
        .limit(limit)
        .offset(skip),
      db
        .select({ total: count() })
        .from(activityLogs)
        .innerJoin(clients, eq(activityLogs.clientId, clients.id))
        .where(whereClause),
    ])

    return reply.send({
      data: logs.map((log) => ({
        id: log.id,
        type: log.type,
        metadata: log.metadata,
        clientId: log.clientId,
        userId: log.userId,
        createdAt: log.createdAt,
        user: { id: log.userId2, name: log.userName, email: log.userEmail },
        client: { id: log.clientId2, name: log.clientName },
      })),
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    })
  })
}
