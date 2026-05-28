import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, or, like, inArray, desc, asc, count, sql } from 'drizzle-orm'
import { db, clients, payments, activityLogs } from '../../db'
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

// Map sort field names to actual column references
function getClientSortColumn(sort: string) {
  switch (sort) {
    case 'name': return clients.name
    case 'updatedAt': return clients.updatedAt
    case 'totalDealAmount': return clients.totalDealAmount
    default: return clients.createdAt
  }
}

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

    // Build where conditions
    const conditions = [eq(clients.userId, userId)]
    if (status) conditions.push(eq(clients.status, status))
    if (search) {
      conditions.push(
        or(
          like(clients.name, `%${search}%`),
          like(clients.email, `%${search}%`)
        )!
      )
    }

    const whereClause = and(...conditions)

    const sortCol = getClientSortColumn(sort)
    const orderFn = order === 'asc' ? asc : desc

    const [clientRows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(clients)
        .where(whereClause)
        .orderBy(orderFn(sortCol))
        .limit(limit)
        .offset(skip),
      db.select({ total: count() }).from(clients).where(whereClause),
    ])

    // Get payment sums for these clients
    const clientIds = clientRows.map((c) => c.id)
    const paymentSums =
      clientIds.length > 0
        ? await db
            .select({
              clientId: payments.clientId,
              totalPaid: sql<string>`sum(${payments.amount})`,
            })
            .from(payments)
            .where(inArray(payments.clientId, clientIds))
            .groupBy(payments.clientId)
        : []

    const paymentSumMap = new Map(paymentSums.map((p) => [p.clientId, Number(p.totalPaid ?? 0)]))

    const clientsWithStats = clientRows.map((client) => {
      const totalPaid = paymentSumMap.get(client.id) ?? 0
      const remainingBalance = Number(client.totalDealAmount) - totalPaid
      return {
        ...client,
        totalDealAmount: Number(client.totalDealAmount),
        totalPaid,
        remainingBalance,
      }
    })

    return reply.send({
      data: clientsWithStats,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
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
    const id = crypto.randomUUID()

    await db.insert(clients).values({
      id,
      ...rest,
      totalDealAmount: String(totalDealAmount ?? 0),
      userId,
    })

    const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)

    const logId = crypto.randomUUID()
    await db.insert(activityLogs).values({
      id: logId,
      type: 'CLIENT_CREATED',
      metadata: { clientName: client.name },
      clientId: client.id,
      userId,
    })

    return reply.code(201).send({ data: client })
  })

  // GET /api/clients/:id
  app.get('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)

    if (!client) {
      return reply.code(404).send({ error: 'Client not found' })
    }

    if (client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    // Fetch payments ordered by date desc
    const clientPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.clientId, id))
      .orderBy(desc(payments.date))

    const totalPaid = clientPayments.reduce((sum, p) => sum + Number(p.amount), 0)
    const remainingBalance = Number(client.totalDealAmount) - totalPaid

    return reply.send({
      data: {
        ...client,
        totalDealAmount: Number(client.totalDealAmount),
        payments: clientPayments.map((p) => ({ ...p, amount: Number(p.amount) })),
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

    const [existing] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)
    if (!existing) {
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (existing.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const { status, totalDealAmount, ...rest } = result.data
    const statusChanged = status !== undefined && status !== existing.status

    const updateData: Record<string, unknown> = { ...rest }
    if (status) updateData.status = status
    if (totalDealAmount !== undefined) updateData.totalDealAmount = String(totalDealAmount)

    await db.update(clients).set(updateData).where(eq(clients.id, id))

    const [updated] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)

    const logId = crypto.randomUUID()
    if (statusChanged) {
      await db.insert(activityLogs).values({
        id: logId,
        type: 'STATUS_CHANGED',
        metadata: { from: existing.status, to: status },
        clientId: id,
        userId,
      })
    } else {
      await db.insert(activityLogs).values({
        id: logId,
        type: 'CLIENT_UPDATED',
        metadata: { updatedFields: Object.keys(result.data) },
        clientId: id,
        userId,
      })
    }

    return reply.send({ data: updated })
  })

  // DELETE /api/clients/:id
  app.delete('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [existing] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)
    if (!existing) {
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (existing.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    await db.delete(clients).where(eq(clients.id, id))

    return reply.code(204).send()
  })

  // GET /api/clients/:id/stats
  app.get('/:id/stats', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [client] = await db
      .select({ userId: clients.userId, totalDealAmount: clients.totalDealAmount, status: clients.status })
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1)

    if (!client) {
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const [paymentSumRow, [{ paymentCount }], byMethod] = await Promise.all([
      db
        .select({ total: sql<string>`sum(${payments.amount})` })
        .from(payments)
        .where(eq(payments.clientId, id)),
      db.select({ paymentCount: count() }).from(payments).where(eq(payments.clientId, id)),
      db
        .select({
          method: payments.method,
          total: sql<string>`sum(${payments.amount})`,
          count: count(),
        })
        .from(payments)
        .where(eq(payments.clientId, id))
        .groupBy(payments.method),
    ])

    const totalPaid = Number(paymentSumRow[0]?.total ?? 0)
    const totalDeal = Number(client.totalDealAmount)
    const remainingBalance = totalDeal - totalPaid

    return reply.send({
      data: {
        totalDealAmount: totalDeal,
        totalPaid,
        remainingBalance,
        paymentCount: Number(paymentCount),
        status: client.status,
        paymentsByMethod: byMethod.map((m) => ({
          method: m.method,
          total: Number(m.total ?? 0),
          count: Number(m.count),
        })),
      },
    })
  })
}
