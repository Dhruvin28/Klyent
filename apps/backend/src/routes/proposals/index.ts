import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc, count, max } from 'drizzle-orm'
import { db, proposals, users } from '../../db'
import { authenticate } from '../../middleware/authenticate'

const paymentMilestoneSchema = z.object({
  milestone: z.number().int().positive(),
  description: z.string().min(1).max(200),
  percentage: z.number().min(0).max(100),
  amount: z.number().min(0),
})

const materialItemSchema = z.object({
  srNo: z.number().int(),
  description: z.string().max(500),
  rate: z.string().max(100).optional().nullable(),
})

const materialSectionSchema = z.object({
  id: z.string().max(64),
  title: z.string().min(1).max(100),
  rateLabel: z.string().max(50).optional().default('Rate'),
  items: z.array(materialItemSchema),
})

const costBreakupItemSchema = z.object({
  item: z.string().min(1).max(200),
  description: z.string().max(1000),
  amount: z.number().min(0),
})

const createProposalSchema = z.object({
  proposalType: z.enum(['STANDARD', 'COST_BREAKUP']).optional().default('STANDARD'),
  materialSections: z.array(materialSectionSchema).optional().nullable(),
  costBreakupItems: z.array(costBreakupItemSchema).optional().nullable(),
  proposalNumber: z.string().min(1).max(100),
  serviceType: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTill: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clientName: z.string().min(1).max(200),
  clientPhone: z.string().max(50).optional().nullable(),
  clientEmail: z.string().email().max(255).optional().nullable(),
  clientAddress: z.string().max(1000).optional().nullable(),
  siteName: z.string().max(200).optional().nullable(),
  projectLocation: z.string().max(200).optional().nullable(),
  projectType: z.string().max(100).optional().nullable(),
  projectScope: z.string().max(500).optional().nullable(),
  aboutCompany: z.string().max(2000).optional().nullable(),
  scopeOfWork: z.array(z.string().max(500)).optional().nullable(),
  feesDescription: z.string().min(1).max(500),
  feesAmount: z.number().min(0),
  feesAmountInWords: z.string().max(500).optional().nullable(),
  feesNote: z.string().max(500).optional().nullable(),
  paymentMilestones: z.array(paymentMilestoneSchema).optional().nullable(),
  termsAndConditions: z.array(z.string().max(500)).optional().nullable(),
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']).optional(),
})

const updateProposalSchema = createProposalSchema.partial()

const listQuerySchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

// Shared query for proposal with company info
async function getProposalWithCompany(whereClause: ReturnType<typeof and>) {
  const [row] = await db.select({
    id: proposals.id,
    proposalType: proposals.proposalType,
    materialSections: proposals.materialSections,
    costBreakupItems: proposals.costBreakupItems,
    proposalNumber: proposals.proposalNumber,
    serviceType: proposals.serviceType,
    date: proposals.date,
    validTill: proposals.validTill,
    clientName: proposals.clientName,
    clientPhone: proposals.clientPhone,
    clientEmail: proposals.clientEmail,
    clientAddress: proposals.clientAddress,
    siteName: proposals.siteName,
    projectLocation: proposals.projectLocation,
    projectType: proposals.projectType,
    projectScope: proposals.projectScope,
    aboutCompany: proposals.aboutCompany,
    scopeOfWork: proposals.scopeOfWork,
    feesDescription: proposals.feesDescription,
    feesAmount: proposals.feesAmount,
    feesAmountInWords: proposals.feesAmountInWords,
    feesNote: proposals.feesNote,
    paymentMilestones: proposals.paymentMilestones,
    termsAndConditions: proposals.termsAndConditions,
    status: proposals.status,
    shareToken: proposals.shareToken,
    version: proposals.version,
    rootProposalId: proposals.rootProposalId,
    userId: proposals.userId,
    createdAt: proposals.createdAt,
    updatedAt: proposals.updatedAt,
    companyName: users.companyName,
    companyLogoUrl: users.companyLogoUrl,
    companyPhone: users.companyPhone,
    companyAddress: users.companyAddress,
    companyWebsite: users.companyWebsite,
  })
    .from(proposals)
    .innerJoin(users, eq(proposals.userId, users.id))
    .where(whereClause)
    .limit(1)
  return row ?? null
}

export default async function proposalRoutes(app: FastifyInstance) {
  // ── PUBLIC route — no authentication ──────────────────────────
  // Must be in its own scope so the private addHook below doesn't apply.
  app.register(async (pub: FastifyInstance) => {
    pub.get('/share/:token', async (request, reply) => {
      const { token } = request.params as { token: string }

      const row = await getProposalWithCompany(eq(proposals.shareToken, token) as ReturnType<typeof and>)
      if (!row) return reply.code(404).send({ error: 'Proposal not found or link is invalid' })

      return reply.send({ data: { ...row, feesAmount: Number(row.feesAmount) } })
    })
  })

  // ── PRIVATE routes — require authentication ────────────────────
  app.register(async (priv: FastifyInstance) => {
    priv.addHook('preHandler', authenticate)

    // GET /api/proposals
    priv.get('/', async (request, reply) => {
      const userId = request.user.sub
      const queryResult = listQuerySchema.safeParse(request.query)
      if (!queryResult.success) {
        return reply.code(400).send({ error: 'Validation Error', details: queryResult.error.flatten().fieldErrors })
      }
      const { status, page, limit } = queryResult.data
      const skip = (page - 1) * limit

      const conditions = [eq(proposals.userId, userId)]
      if (status) conditions.push(eq(proposals.status, status))

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(proposals)
          .where(and(...conditions))
          .orderBy(desc(proposals.createdAt))
          .limit(limit).offset(skip),
        db.select({ total: count() }).from(proposals).where(and(...conditions)),
      ])

      return reply.send({
        data: rows.map((p) => ({ ...p, feesAmount: Number(p.feesAmount) })),
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      })
    })

    // POST /api/proposals
    priv.post('/', async (request, reply) => {
      const userId = request.user.sub
      const result = createProposalSchema.safeParse(request.body)
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
      }

      const { feesAmount, ...rest } = result.data
      const id = crypto.randomUUID()

      await db.insert(proposals).values({
        id,
        ...rest,
        feesAmount: String(feesAmount),
        status: rest.status ?? 'DRAFT',
        version: 1,
        rootProposalId: id, // a brand new proposal is the root of its own version lineage
        userId,
      })

      const [created] = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1)
      return reply.code(201).send({ data: { ...created, feesAmount: Number(created.feesAmount) } })
    })

    // POST /api/proposals/:id/version — save edits as a new version of an existing proposal
    priv.post('/:id/version', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }
      const result = createProposalSchema.safeParse(request.body)
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
      }

      // The source proposal must exist and belong to the user.
      const [source] = await db.select({ id: proposals.id, rootProposalId: proposals.rootProposalId })
        .from(proposals)
        .where(and(eq(proposals.id, id), eq(proposals.userId, userId)))
        .limit(1)
      if (!source) return reply.code(404).send({ error: 'Proposal not found' })

      // All versions share the same root; fall back to the source id for legacy rows.
      const rootProposalId = source.rootProposalId ?? source.id

      // Next version = highest existing version in this lineage + 1.
      const [{ maxVersion }] = await db.select({ maxVersion: max(proposals.version) })
        .from(proposals)
        .where(and(eq(proposals.rootProposalId, rootProposalId), eq(proposals.userId, userId)))
      const nextVersion = (Number(maxVersion) || 1) + 1

      const { feesAmount, ...rest } = result.data
      const newId = crypto.randomUUID()

      await db.insert(proposals).values({
        id: newId,
        ...rest,
        feesAmount: String(feesAmount),
        status: rest.status ?? 'DRAFT',
        shareToken: null, // each version gets its own share link when shared
        version: nextVersion,
        rootProposalId,
        userId,
      })

      const [created] = await db.select().from(proposals).where(eq(proposals.id, newId)).limit(1)
      return reply.code(201).send({ data: { ...created, feesAmount: Number(created.feesAmount) } })
    })

    // GET /api/proposals/:id
    priv.get('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }

      const row = await getProposalWithCompany(and(eq(proposals.id, id), eq(proposals.userId, userId))!)
      if (!row) return reply.code(404).send({ error: 'Proposal not found' })

      return reply.send({ data: { ...row, feesAmount: Number(row.feesAmount) } })
    })

    // PATCH /api/proposals/:id
    priv.patch('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }
      const result = updateProposalSchema.safeParse(request.body)
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
      }

      const [existing] = await db.select({ id: proposals.id })
        .from(proposals)
        .where(and(eq(proposals.id, id), eq(proposals.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Proposal not found' })

      const { feesAmount, ...rest } = result.data
      await db.update(proposals).set({
        ...rest,
        ...(feesAmount !== undefined ? { feesAmount: String(feesAmount) } : {}),
      }).where(eq(proposals.id, id))

      const [updated] = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1)
      return reply.send({ data: { ...updated, feesAmount: Number(updated.feesAmount) } })
    })

    // DELETE /api/proposals/:id
    priv.delete('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }

      const [existing] = await db.select({ id: proposals.id })
        .from(proposals)
        .where(and(eq(proposals.id, id), eq(proposals.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Proposal not found' })

      await db.delete(proposals).where(eq(proposals.id, id))
      return reply.code(204).send()
    })

    // POST /api/proposals/:id/share
    priv.post('/:id/share', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }

      const [existing] = await db.select({ id: proposals.id, shareToken: proposals.shareToken })
        .from(proposals)
        .where(and(eq(proposals.id, id), eq(proposals.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Proposal not found' })

      const token = existing.shareToken ?? crypto.randomUUID()
      if (!existing.shareToken) {
        await db.update(proposals).set({ shareToken: token, status: 'SENT' }).where(eq(proposals.id, id))
      }

      return reply.send({ data: { shareToken: token } })
    })
  })
}
