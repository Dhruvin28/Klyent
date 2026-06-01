import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc, sql, count } from 'drizzle-orm'
import { db, freelanceProjects, freelanceWorkLogs, payments, files, fileVersions, users } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { deleteS3Object } from '../../lib/s3'

const createProjectSchema = z.object({
  clientName: z.string().min(1).max(200),
  workType: z.string().min(1).max(200),
  chargeType: z.string().min(1).max(100),
  rate: z.number().positive('Rate must be positive'),
  notes: z.string().max(2000).optional(),
})

const updateProjectSchema = z.object({
  clientName: z.string().min(1).max(200).optional(),
  workType: z.string().min(1).max(200).optional(),
  chargeType: z.string().min(1).max(100).optional(),
  rate: z.number().positive().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED']).optional(),
  notes: z.string().max(2000).optional().nullable(),
})

const addWorkLogSchema = z.object({
  quantity: z.number().positive('Quantity must be positive'),
  description: z.string().max(1000).optional(),
  date: z.string().datetime({ message: 'Invalid date format, use ISO 8601' }),
})

const updateWorkLogSchema = z.object({
  quantity: z.number().positive().optional(),
  description: z.string().max(1000).optional().nullable(),
  date: z.string().datetime().optional(),
})

const listQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'COMPLETED']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

async function getProjectStats(projectId: string) {
  const [billedRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
    .from(freelanceWorkLogs)
    .where(eq(freelanceWorkLogs.freelanceProjectId, projectId))

  const [paidRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
    .from(payments)
    .where(eq(payments.freelanceProjectId, projectId))

  const totalBilled = Number(billedRow?.total ?? 0)
  const totalPaid = Number(paidRow?.total ?? 0)
  return { totalBilled, totalPaid, remainingBalance: totalBilled - totalPaid }
}

export default async function freelanceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/freelance
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const queryResult = listQuerySchema.safeParse(request.query)
    if (!queryResult.success) {
      return reply.code(400).send({ error: 'Validation Error', details: queryResult.error.flatten().fieldErrors })
    }
    const { status, page, limit } = queryResult.data
    const skip = (page - 1) * limit

    const conditions = [eq(freelanceProjects.userId, userId)]
    if (status) conditions.push(eq(freelanceProjects.status, status))

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(freelanceProjects)
        .where(and(...conditions))
        .orderBy(desc(freelanceProjects.createdAt))
        .limit(limit).offset(skip),
      db.select({ total: count() }).from(freelanceProjects).where(and(...conditions)),
    ])

    const withStats = await Promise.all(rows.map(async (p) => ({
      ...p,
      rate: Number(p.rate),
      ...(await getProjectStats(p.id)),
    })))

    return reply.send({
      data: withStats,
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    })
  })

  // POST /api/freelance
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = createProjectSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }
    const { clientName, workType, chargeType, rate, notes } = result.data
    const id = crypto.randomUUID()
    await db.insert(freelanceProjects).values({ id, clientName, workType, chargeType, rate: String(rate), notes, userId })
    const [project] = await db.select().from(freelanceProjects).where(eq(freelanceProjects.id, id)).limit(1)
    return reply.code(201).send({ data: { ...project, rate: Number(project.rate), totalBilled: 0, totalPaid: 0, remainingBalance: 0 } })
  })

  // GET /api/freelance/:id
  app.get('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [project] = await db.select().from(freelanceProjects)
      .where(and(eq(freelanceProjects.id, id), eq(freelanceProjects.userId, userId))).limit(1)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const [workLogs, stats] = await Promise.all([
      db.select().from(freelanceWorkLogs)
        .where(eq(freelanceWorkLogs.freelanceProjectId, id))
        .orderBy(desc(freelanceWorkLogs.date)),
      getProjectStats(id),
    ])

    return reply.send({
      data: {
        ...project,
        rate: Number(project.rate),
        ...stats,
        workLogs: workLogs.map((l) => ({
          ...l,
          quantity: Number(l.quantity),
          amount: Number(l.amount),
        })),
      },
    })
  })

  // PATCH /api/freelance/:id
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = updateProjectSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const [project] = await db.select().from(freelanceProjects)
      .where(and(eq(freelanceProjects.id, id), eq(freelanceProjects.userId, userId))).limit(1)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const { rate, ...rest } = result.data
    await db.update(freelanceProjects).set({
      ...rest,
      ...(rate !== undefined ? { rate: String(rate) } : {}),
    }).where(eq(freelanceProjects.id, id))

    const [updated] = await db.select().from(freelanceProjects).where(eq(freelanceProjects.id, id)).limit(1)
    const stats = await getProjectStats(id)
    return reply.send({ data: { ...updated, rate: Number(updated.rate), ...stats } })
  })

  // DELETE /api/freelance/:id
  app.delete('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [project] = await db.select().from(freelanceProjects)
      .where(and(eq(freelanceProjects.id, id), eq(freelanceProjects.userId, userId))).limit(1)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    // Hard delete associated files from R2
    const projectFiles = await db.select({ id: files.id })
      .from(files).where(eq(files.freelanceProjectId, id))
    for (const f of projectFiles) {
      const versions = await db.select().from(fileVersions).where(eq(fileVersions.fileId, f.id))
      for (const v of versions) {
        await deleteS3Object(v.s3Key).catch(() => undefined)
      }
      await db.delete(files).where(eq(files.id, f.id))
    }

    await db.delete(freelanceWorkLogs).where(eq(freelanceWorkLogs.freelanceProjectId, id))
    await db.delete(payments).where(eq(payments.freelanceProjectId, id))
    await db.delete(freelanceProjects).where(eq(freelanceProjects.id, id))

    return reply.code(204).send()
  })

  // GET /api/freelance/:id/work-logs
  app.get('/:id/work-logs', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [project] = await db.select({ id: freelanceProjects.id })
      .from(freelanceProjects)
      .where(and(eq(freelanceProjects.id, id), eq(freelanceProjects.userId, userId))).limit(1)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const logs = await db.select().from(freelanceWorkLogs)
      .where(eq(freelanceWorkLogs.freelanceProjectId, id))
      .orderBy(desc(freelanceWorkLogs.date))

    return reply.send({
      data: logs.map((l) => ({ ...l, quantity: Number(l.quantity), amount: Number(l.amount) })),
    })
  })

  // POST /api/freelance/:id/work-logs
  app.post('/:id/work-logs', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = addWorkLogSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const [project] = await db.select()
      .from(freelanceProjects)
      .where(and(eq(freelanceProjects.id, id), eq(freelanceProjects.userId, userId))).limit(1)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const { quantity, description, date } = result.data
    const amount = quantity * Number(project.rate)
    const logId = crypto.randomUUID()

    await db.insert(freelanceWorkLogs).values({
      id: logId,
      freelanceProjectId: id,
      description,
      quantity: String(quantity),
      amount: String(amount),
      date: new Date(date),
    })

    const [log] = await db.select().from(freelanceWorkLogs).where(eq(freelanceWorkLogs.id, logId)).limit(1)
    const stats = await getProjectStats(id)

    return reply.code(201).send({
      data: { ...log, quantity: Number(log.quantity), amount: Number(log.amount) },
      stats,
    })
  })

  // PATCH /api/freelance/:id/work-logs/:logId
  app.patch('/:id/work-logs/:logId', async (request, reply) => {
    const userId = request.user.sub
    const { id, logId } = request.params as { id: string; logId: string }
    const result = updateWorkLogSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const [project] = await db.select()
      .from(freelanceProjects)
      .where(and(eq(freelanceProjects.id, id), eq(freelanceProjects.userId, userId))).limit(1)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const [log] = await db.select().from(freelanceWorkLogs)
      .where(and(eq(freelanceWorkLogs.id, logId), eq(freelanceWorkLogs.freelanceProjectId, id))).limit(1)
    if (!log) return reply.code(404).send({ error: 'Work log not found' })

    const { quantity, date, description } = result.data
    const newQuantity = quantity ?? Number(log.quantity)
    const newAmount = newQuantity * Number(project.rate)

    await db.update(freelanceWorkLogs).set({
      ...(description !== undefined ? { description } : {}),
      quantity: String(newQuantity),
      amount: String(newAmount),
      ...(date !== undefined ? { date: new Date(date) } : {}),
    }).where(eq(freelanceWorkLogs.id, logId))

    const [updated] = await db.select().from(freelanceWorkLogs).where(eq(freelanceWorkLogs.id, logId)).limit(1)
    const stats = await getProjectStats(id)

    return reply.send({
      data: { ...updated, quantity: Number(updated.quantity), amount: Number(updated.amount) },
      stats,
    })
  })

  // DELETE /api/freelance/:id/work-logs/:logId
  app.delete('/:id/work-logs/:logId', async (request, reply) => {
    const userId = request.user.sub
    const { id, logId } = request.params as { id: string; logId: string }

    const [project] = await db.select({ id: freelanceProjects.id })
      .from(freelanceProjects)
      .where(and(eq(freelanceProjects.id, id), eq(freelanceProjects.userId, userId))).limit(1)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    await db.delete(freelanceWorkLogs)
      .where(and(eq(freelanceWorkLogs.id, logId), eq(freelanceWorkLogs.freelanceProjectId, id)))

    const stats = await getProjectStats(id)
    return reply.send({ stats })
  })

  // GET /api/freelance/:id/files
  app.get('/:id/files', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [project] = await db.select({ id: freelanceProjects.id })
      .from(freelanceProjects)
      .where(and(eq(freelanceProjects.id, id), eq(freelanceProjects.userId, userId))).limit(1)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const fileRows = await db.select().from(files)
      .where(eq(files.freelanceProjectId, id))
      .orderBy(desc(files.updatedAt))

    const result = await Promise.all(fileRows.map(async (f) => {
      const [activeVersion] = await db
        .select({
          id: fileVersions.id,
          versionNumber: fileVersions.versionNumber,
          s3Key: fileVersions.s3Key,
          size: fileVersions.size,
          isActive: fileVersions.isActive,
          uploadedById: fileVersions.uploadedById,
          fileId: fileVersions.fileId,
          createdAt: fileVersions.createdAt,
          uploaderName: users.name,
        })
        .from(fileVersions)
        .innerJoin(users, eq(fileVersions.uploadedById, users.id))
        .where(and(eq(fileVersions.fileId, f.id), eq(fileVersions.isActive, true)))
        .limit(1)
      return {
        ...f,
        versions: activeVersion ? [{ ...activeVersion, uploadedBy: { id: activeVersion.uploadedById, name: activeVersion.uploaderName } }] : [],
      }
    }))

    return reply.send({ data: result })
  })
}
