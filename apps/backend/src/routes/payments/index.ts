import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

const createPaymentSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  amount: z.number().positive('Amount must be positive'),
  method: z.enum(['CASH', 'ONLINE', 'CHEQUE']),
  date: z.string().datetime({ message: 'Invalid date format, use ISO 8601' }),
  notes: z.string().max(1000).optional(),
})

const updatePaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive').optional(),
  method: z.enum(['CASH', 'ONLINE', 'CHEQUE']).optional(),
  date: z.string().datetime({ message: 'Invalid date format, use ISO 8601' }).optional(),
  notes: z.string().max(1000).optional(),
})

const listQuerySchema = z.object({
  clientId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  method: z.enum(['CASH', 'ONLINE', 'CHEQUE']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort: z.enum(['date', 'amount', 'createdAt']).optional().default('date'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
})

export default async function paymentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/payments
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const queryResult = listQuerySchema.safeParse(request.query)

    if (!queryResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: queryResult.error.flatten().fieldErrors,
      })
    }

    const { clientId, startDate, endDate, method, page, limit, sort, order } = queryResult.data
    const skip = (page - 1) * limit

    // Ensure user owns any specified client
    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { userId: true },
      })
      if (!client || client.userId !== userId) {
        return reply.code(403).send({ error: 'Forbidden' })
      }
    }

    const where: Prisma.PaymentWhereInput = {
      client: { userId },
      ...(clientId && { clientId }),
      ...(method && { method }),
      ...((startDate || endDate) && {
        date: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      }),
    }

    const [payments, total, aggregate] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort]: order },
        include: {
          client: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({
        where,
        _sum: { amount: true },
      }),
    ])

    return reply.send({
      data: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalAmount: Number(aggregate._sum.amount ?? 0),
      },
    })
  })

  // POST /api/payments
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = createPaymentSchema.safeParse(request.body)

    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: result.error.flatten().fieldErrors,
      })
    }

    const { clientId, amount, method, date, notes } = result.data

    // Verify client ownership
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { userId: true, name: true },
    })

    if (!client) {
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const payment = await prisma.payment.create({
      data: {
        amount: new Prisma.Decimal(amount),
        method,
        date: new Date(date),
        notes,
        clientId,
        userId,
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    })

    await prisma.activityLog.create({
      data: {
        type: 'PAYMENT_ADDED',
        metadata: {
          paymentId: payment.id,
          amount,
          method,
          clientName: client.name,
        },
        clientId,
        userId,
      },
    })

    return reply.code(201).send({
      data: { ...payment, amount: Number(payment.amount) },
    })
  })

  // PATCH /api/payments/:id
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const result = updatePaymentSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: result.error.flatten().fieldErrors,
      })
    }

    const existing = await prisma.payment.findUnique({
      where: { id },
      include: { client: { select: { userId: true, name: true } } },
    })

    if (!existing) {
      return reply.code(404).send({ error: 'Payment not found' })
    }
    if (existing.client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const { amount, date, ...rest } = result.data

    const updated = await prisma.payment.update({
      where: { id },
      data: {
        ...rest,
        ...(amount !== undefined && { amount: new Prisma.Decimal(amount) }),
        ...(date !== undefined && { date: new Date(date) }),
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    })

    await prisma.activityLog.create({
      data: {
        type: 'PAYMENT_UPDATED',
        metadata: {
          paymentId: id,
          updatedFields: Object.keys(result.data),
          clientName: existing.client.name,
        },
        clientId: existing.clientId,
        userId,
      },
    })

    return reply.send({
      data: { ...updated, amount: Number(updated.amount) },
    })
  })

  // DELETE /api/payments/:id
  app.delete('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const existing = await prisma.payment.findUnique({
      where: { id },
      include: { client: { select: { userId: true, name: true } } },
    })

    if (!existing) {
      return reply.code(404).send({ error: 'Payment not found' })
    }
    if (existing.client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    await prisma.payment.delete({ where: { id } })

    await prisma.activityLog.create({
      data: {
        type: 'PAYMENT_DELETED',
        metadata: {
          paymentId: id,
          amount: Number(existing.amount),
          method: existing.method,
          clientName: existing.client.name,
        },
        clientId: existing.clientId,
        userId,
      },
    })

    return reply.code(204).send()
  })
}
