import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
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
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { userId: true },
      })
      if (!client) {
        return reply.code(404).send({ error: 'Client not found' })
      }
      if (client.userId !== userId) {
        return reply.code(403).send({ error: 'Forbidden' })
      }
    }

    const where: Prisma.ActivityLogWhereInput = {
      client: { userId },
      ...(clientId && { clientId }),
      ...(type && { type }),
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          client: { select: { id: true, name: true } },
        },
      }),
      prisma.activityLog.count({ where }),
    ])

    return reply.send({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  })
}
