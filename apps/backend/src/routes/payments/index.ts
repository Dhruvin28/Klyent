import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, gte, lte, desc, asc, count, sql, isNotNull, or } from 'drizzle-orm'
import { db, clients, payments, activityLogs, freelanceProjects } from '../../db'
import { authenticate } from '../../middleware/authenticate'

const createPaymentSchema = z.object({
  clientId: z.string().min(1).optional(),
  freelanceProjectId: z.string().min(1).optional(),
  amount: z.number().positive('Amount must be positive'),
  method: z.enum(['CASH', 'ONLINE', 'CHEQUE']),
  date: z.string().datetime({ message: 'Invalid date format, use ISO 8601' }),
  notes: z.string().max(1000).optional(),
}).refine((d) => d.clientId || d.freelanceProjectId, {
  message: 'Either clientId or freelanceProjectId is required',
})

const updatePaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive').optional(),
  method: z.enum(['CASH', 'ONLINE', 'CHEQUE']).optional(),
  date: z.string().datetime({ message: 'Invalid date format, use ISO 8601' }).optional(),
  notes: z.string().max(1000).optional(),
})

const listQuerySchema = z.object({
  clientId: z.string().optional(),
  freelanceProjectId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  method: z.enum(['CASH', 'ONLINE', 'CHEQUE']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort: z.enum(['date', 'amount', 'createdAt']).optional().default('date'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
})

function getPaymentSortColumn(sort: string) {
  switch (sort) {
    case 'amount': return payments.amount
    case 'createdAt': return payments.createdAt
    default: return payments.date
  }
}

export default async function paymentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/payments
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const queryResult = listQuerySchema.safeParse(request.query)
    if (!queryResult.success) {
      return reply.code(400).send({ error: 'Validation Error', details: queryResult.error.flatten().fieldErrors })
    }

    const { clientId, freelanceProjectId, startDate, endDate, method, page, limit, sort, order } = queryResult.data
    const skip = (page - 1) * limit

    const conditions = [eq(payments.userId, userId)]
    if (clientId) conditions.push(eq(payments.clientId, clientId))
    if (freelanceProjectId) conditions.push(eq(payments.freelanceProjectId, freelanceProjectId))
    if (method) conditions.push(eq(payments.method, method))
    if (startDate) conditions.push(gte(payments.date, new Date(startDate)))
    if (endDate) conditions.push(lte(payments.date, new Date(endDate)))

    const sortCol = getPaymentSortColumn(sort)
    const orderFn = order === 'asc' ? asc : desc
    const where = and(...conditions)

    const [paymentRows, [{ total }], sumRow] = await Promise.all([
      db
        .select({
          id: payments.id,
          amount: payments.amount,
          method: payments.method,
          date: payments.date,
          notes: payments.notes,
          createdAt: payments.createdAt,
          updatedAt: payments.updatedAt,
          clientId: payments.clientId,
          freelanceProjectId: payments.freelanceProjectId,
          userId: payments.userId,
          clientName: clients.name,
          freelanceClientName: freelanceProjects.clientName,
          freelanceWorkType: freelanceProjects.workType,
        })
        .from(payments)
        .leftJoin(clients, eq(payments.clientId, clients.id))
        .leftJoin(freelanceProjects, eq(payments.freelanceProjectId, freelanceProjects.id))
        .where(where)
        .orderBy(orderFn(sortCol))
        .limit(limit)
        .offset(skip),
      db.select({ total: count() }).from(payments).where(where),
      db.select({ totalAmount: sql<string>`COALESCE(SUM(${payments.amount}), 0)` }).from(payments).where(where),
    ])

    const formattedPayments = paymentRows.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      method: p.method,
      date: p.date,
      notes: p.notes,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      clientId: p.clientId,
      freelanceProjectId: p.freelanceProjectId,
      userId: p.userId,
      client: p.clientId ? { id: p.clientId, name: p.clientName } : null,
      freelanceProject: p.freelanceProjectId
        ? { id: p.freelanceProjectId, clientName: p.freelanceClientName, workType: p.freelanceWorkType }
        : null,
    }))

    return reply.send({
      data: formattedPayments,
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      totalAmount: Number(sumRow[0]?.totalAmount ?? 0),
      // keep backward compat alias
      summary: { totalAmount: Number(sumRow[0]?.totalAmount ?? 0) },
    })
  })

  // POST /api/payments
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = createPaymentSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const { clientId, freelanceProjectId, amount, method, date, notes } = result.data

    let clientName: string | null = null
    let freelanceClientName: string | null = null
    let freelanceWorkType: string | null = null

    if (clientId) {
      const [client] = await db.select({ userId: clients.userId, name: clients.name })
        .from(clients).where(eq(clients.id, clientId)).limit(1)
      if (!client) return reply.code(404).send({ error: 'Client not found' })
      if (client.userId !== userId) return reply.code(403).send({ error: 'Forbidden' })
      clientName = client.name
    }

    if (freelanceProjectId) {
      const [fp] = await db.select({ userId: freelanceProjects.userId, clientName: freelanceProjects.clientName, workType: freelanceProjects.workType })
        .from(freelanceProjects).where(eq(freelanceProjects.id, freelanceProjectId)).limit(1)
      if (!fp) return reply.code(404).send({ error: 'Freelance project not found' })
      if (fp.userId !== userId) return reply.code(403).send({ error: 'Forbidden' })
      freelanceClientName = fp.clientName
      freelanceWorkType = fp.workType
    }

    const id = crypto.randomUUID()
    await db.insert(payments).values({
      id,
      amount: String(amount),
      method,
      date: new Date(date),
      notes,
      clientId: clientId ?? null,
      freelanceProjectId: freelanceProjectId ?? null,
      userId,
    })

    const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1)

    // Log activity only for client payments (activity_logs requires client_id NOT NULL)
    if (clientId && clientName) {
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        type: 'PAYMENT_ADDED',
        metadata: { paymentId: payment.id, amount, method, clientName },
        clientId,
        userId,
      })
    }

    return reply.code(201).send({
      data: {
        ...payment,
        amount: Number(payment.amount),
        client: clientId ? { id: clientId, name: clientName } : null,
        freelanceProject: freelanceProjectId ? { id: freelanceProjectId, clientName: freelanceClientName, workType: freelanceWorkType } : null,
      },
    })
  })

  // PATCH /api/payments/:id
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const result = updatePaymentSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const [existing] = await db.select().from(payments)
      .where(and(eq(payments.id, id), eq(payments.userId, userId))).limit(1)
    if (!existing) return reply.code(404).send({ error: 'Payment not found' })

    const { amount, date, ...rest } = result.data
    await db.update(payments).set({
      ...rest,
      ...(amount !== undefined ? { amount: String(amount) } : {}),
      ...(date !== undefined ? { date: new Date(date) } : {}),
    }).where(eq(payments.id, id))

    const [updated] = await db.select().from(payments).where(eq(payments.id, id)).limit(1)

    if (existing.clientId) {
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        type: 'PAYMENT_UPDATED',
        metadata: { paymentId: id, updatedFields: Object.keys(result.data) },
        clientId: existing.clientId,
        userId,
      })
    }

    return reply.send({ data: { ...updated, amount: Number(updated.amount) } })
  })

  // DELETE /api/payments/:id
  app.delete('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [existing] = await db.select().from(payments)
      .where(and(eq(payments.id, id), eq(payments.userId, userId))).limit(1)
    if (!existing) return reply.code(404).send({ error: 'Payment not found' })

    await db.delete(payments).where(eq(payments.id, id))

    if (existing.clientId) {
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        type: 'PAYMENT_DELETED',
        metadata: { paymentId: id, amount: Number(existing.amount), method: existing.method },
        clientId: existing.clientId,
        userId,
      })
    }

    return reply.code(204).send()
  })
}
