import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

const createClientSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  projectDescription: z.string().max(2000).optional(),
  totalDealAmount: z.number().min(0).optional().default(0),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ON_HOLD']).optional().default('ACTIVE'),
})

const updateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  projectDescription: z.string().max(2000).optional(),
  totalDealAmount: z.number().min(0).optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ON_HOLD']).optional(),
})

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ON_HOLD']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort: z.enum(['name', 'createdAt', 'updatedAt', 'totalDealAmount']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
})

export default async function clientRoutes(app: FastifyInstance) {
  // All routes require authentication
  app.addHook('preHandler', authenticate)

  // GET /api/clients
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const queryResult = listQuerySchema.safeParse(request.query)

    if (!queryResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: queryResult.error.flatten().fieldErrors,
      })
    }

    const { search, status, page, limit, sort, order } = queryResult.data
    const skip = (page - 1) * limit

    const where: Prisma.ClientWhereInput = {
      userId,
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort]: order },
        include: {
          payments: {
            select: { amount: true },
          },
          _count: {
            select: { files: true, payments: true },
          },
        },
      }),
      prisma.client.count({ where }),
    ])

    const clientsWithStats = clients.map((client) => {
      const totalPaid = client.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      )
      const remainingBalance = Number(client.totalDealAmount) - totalPaid
      const { payments, ...rest } = client
      return {
        ...rest,
        totalDealAmount: Number(rest.totalDealAmount),
        totalPaid,
        remainingBalance,
      }
    })

    return reply.send({
      data: clientsWithStats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  })

  // POST /api/clients
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = createClientSchema.safeParse(request.body)

    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: result.error.flatten().fieldErrors,
      })
    }

    const { totalDealAmount, ...rest } = result.data

    const client = await prisma.client.create({
      data: {
        ...rest,
        totalDealAmount: new Prisma.Decimal(totalDealAmount ?? 0),
        userId,
      },
    })

    await prisma.activityLog.create({
      data: {
        type: 'CLIENT_CREATED',
        metadata: { clientName: client.name },
        clientId: client.id,
        userId,
      },
    })

    return reply.code(201).send({ data: client })
  })

  // GET /api/clients/:id
  app.get('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        payments: {
          orderBy: { date: 'desc' },
        },
        files: {
          include: {
            versions: {
              where: { isActive: true },
              orderBy: { versionNumber: 'desc' },
              take: 1,
            },
            _count: { select: { versions: true, comments: true } },
          },
          orderBy: { updatedAt: 'desc' },
        },
        _count: {
          select: { payments: true, files: true, activityLogs: true },
        },
      },
    })

    if (!client) {
      return reply.code(404).send({ error: 'Client not found' })
    }

    if (client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const totalPaid = client.payments.reduce((sum, p) => sum + Number(p.amount), 0)
    const remainingBalance = Number(client.totalDealAmount) - totalPaid

    return reply.send({
      data: {
        ...client,
        totalDealAmount: Number(client.totalDealAmount),
        payments: client.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
        totalPaid,
        remainingBalance,
      },
    })
  })

  // PATCH /api/clients/:id
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const result = updateClientSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: result.error.flatten().fieldErrors,
      })
    }

    const existing = await prisma.client.findUnique({ where: { id } })
    if (!existing) {
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (existing.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const { status, totalDealAmount, ...rest } = result.data
    const statusChanged = status !== undefined && status !== existing.status

    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...rest,
        ...(status && { status }),
        ...(totalDealAmount !== undefined && {
          totalDealAmount: new Prisma.Decimal(totalDealAmount),
        }),
      },
    })

    if (statusChanged) {
      await prisma.activityLog.create({
        data: {
          type: 'STATUS_CHANGED',
          metadata: { from: existing.status, to: status },
          clientId: id,
          userId,
        },
      })
    } else {
      await prisma.activityLog.create({
        data: {
          type: 'CLIENT_UPDATED',
          metadata: { updatedFields: Object.keys(result.data) },
          clientId: id,
          userId,
        },
      })
    }

    return reply.send({ data: updated })
  })

  // DELETE /api/clients/:id
  app.delete('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const existing = await prisma.client.findUnique({ where: { id } })
    if (!existing) {
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (existing.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    await prisma.client.delete({ where: { id } })

    return reply.code(204).send()
  })

  // GET /api/clients/:id/stats
  app.get('/:id/stats', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const client = await prisma.client.findUnique({
      where: { id },
      select: { userId: true, totalDealAmount: true, status: true },
    })

    if (!client) {
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const [paymentAgg, paymentCount, byMethod] = await Promise.all([
      prisma.payment.aggregate({
        where: { clientId: id },
        _sum: { amount: true },
      }),
      prisma.payment.count({ where: { clientId: id } }),
      prisma.payment.groupBy({
        by: ['method'],
        where: { clientId: id },
        _sum: { amount: true },
        _count: true,
      }),
    ])

    const totalPaid = Number(paymentAgg._sum.amount ?? 0)
    const totalDeal = Number(client.totalDealAmount)
    const remainingBalance = totalDeal - totalPaid

    return reply.send({
      data: {
        totalDealAmount: totalDeal,
        totalPaid,
        remainingBalance,
        paymentCount,
        status: client.status,
        paymentsByMethod: byMethod.map((m) => ({
          method: m.method,
          total: Number(m._sum.amount ?? 0),
          count: m._count,
        })),
      },
    })
  })
}
