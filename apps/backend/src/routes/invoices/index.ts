import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc, count, like, sql } from 'drizzle-orm'
import { db, invoices, clients, users } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { computeInvoiceTotals } from './totals'

const lineItemSchema = z.object({
  id: z.string().max(64),
  description: z.string().min(1).max(500),
  hsnSac: z.string().max(20).optional().nullable(),
  quantity: z.number().min(0),
  unit: z.string().max(20).optional().nullable(),
  rate: z.number().min(0),
  discountPercent: z.number().min(0).max(100).optional().default(0),
  taxRate: z.number().min(0).max(100).optional().default(0),
})

const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  clientId: z.string().max(128).optional().nullable(),
  clientName: z.string().min(1).max(200),
  clientPhone: z.string().max(50).optional().nullable(),
  clientEmail: z.string().email().max(255).optional().nullable().or(z.literal('')),
  clientAddress: z.string().max(1000).optional().nullable(),
  clientGstin: z.string().max(20).optional().nullable(),

  supplierStateCode: z.string().max(2).optional().nullable(),
  supplierStateName: z.string().max(100).optional().nullable(),
  placeOfSupplyCode: z.string().max(2).optional().nullable(),
  placeOfSupplyName: z.string().max(100).optional().nullable(),

  lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),

  amountPaid: z.number().min(0).optional().default(0),
  notes: z.string().max(2000).optional().nullable(),
  termsAndConditions: z.array(z.string().max(500)).optional().nullable(),
  bankName: z.string().max(200).optional().nullable(),
  bankAccountName: z.string().max(200).optional().nullable(),
  bankAccountNumber: z.string().max(50).optional().nullable(),
  bankIfsc: z.string().max(20).optional().nullable(),
  upiId: z.string().max(100).optional().nullable(),

  status: z.enum(['DRAFT', 'SENT', 'PART_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
})

const updateInvoiceSchema = createInvoiceSchema.partial()

const listQuerySchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PART_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
  clientId: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

const markPaidSchema = z.object({
  amountPaid: z.number().min(0),
})

// Numeric columns come back from MySQL as strings; the API always returns numbers.
const NUMERIC_FIELDS = [
  'subtotal', 'discountTotal', 'taxableAmount', 'cgstAmount', 'sgstAmount',
  'igstAmount', 'totalTax', 'roundOff', 'totalAmount', 'amountPaid',
] as const

function serialize<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row }
  for (const f of NUMERIC_FIELDS) {
    if (out[f] != null) out[f] = Number(out[f])
  }
  out.balanceDue = Number(out.totalAmount ?? 0) - Number(out.amountPaid ?? 0)
  return out
}

// Invoice plus the company letterhead, for PDF rendering.
async function getInvoiceWithCompany(whereClause: ReturnType<typeof and>) {
  const [row] = await db
    .select({
      invoice: invoices,
      companyName: users.companyName,
      companyLogoUrl: users.companyLogoUrl,
      companyPhone: users.companyPhone,
      companyAddress: users.companyAddress,
      companyWebsite: users.companyWebsite,
      companyGstin: users.companyGstin,
    })
    .from(invoices)
    .innerJoin(users, eq(invoices.userId, users.id))
    .where(whereClause)
    .limit(1)

  if (!row) return null
  const { invoice, ...company } = row
  return { ...serialize(invoice), ...company }
}

type InvoiceStatus = 'DRAFT' | 'SENT' | 'PART_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'

// Status follows the money, except for states the user set deliberately.
function derivedStatus(
  requested: string | undefined,
  current: string | undefined,
  totalAmount: number,
  amountPaid: number
): InvoiceStatus {
  const status = (requested ?? current ?? 'DRAFT') as InvoiceStatus
  if (status === 'CANCELLED' || status === 'DRAFT') return status
  if (amountPaid <= 0) return status === 'PAID' || status === 'PART_PAID' ? 'SENT' : status
  if (amountPaid >= totalAmount) return 'PAID'
  return 'PART_PAID'
}

export default async function invoiceRoutes(app: FastifyInstance) {
  // ── PUBLIC route — no authentication ──────────────────────────
  // Its own scope, so the private addHook below does not apply.
  app.register(async (pub: FastifyInstance) => {
    pub.get('/share/:token', async (request, reply) => {
      const { token } = request.params as { token: string }

      const row = await getInvoiceWithCompany(eq(invoices.shareToken, token) as ReturnType<typeof and>)
      if (!row) return reply.code(404).send({ error: 'Invoice not found or link is invalid' })

      return reply.send({ data: row })
    })
  })

  // ── PRIVATE routes — require authentication ────────────────────
  app.register(async (priv: FastifyInstance) => {
    priv.addHook('preHandler', authenticate)

    // GET /api/invoices/next-number — suggest the next number in the series
    priv.get('/next-number', async (request, reply) => {
      const userId = request.user.sub
      const now = new Date()
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
      const fy = `${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}`
      const prefix = `INV/${fy}/`

      const [row] = await db
        .select({ maxNumber: sql<string>`max(${invoices.invoiceNumber})` })
        .from(invoices)
        .where(and(eq(invoices.userId, userId), like(invoices.invoiceNumber, `${prefix}%`)))

      const lastSeq = row?.maxNumber ? parseInt(row.maxNumber.slice(prefix.length), 10) : 0
      const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1

      return reply.send({ data: { invoiceNumber: `${prefix}${String(nextSeq).padStart(3, '0')}` } })
    })

    // GET /api/invoices
    priv.get('/', async (request, reply) => {
      const userId = request.user.sub
      const queryResult = listQuerySchema.safeParse(request.query)
      if (!queryResult.success) {
        return reply.code(400).send({ error: 'Validation Error', details: queryResult.error.flatten().fieldErrors })
      }
      const { status, clientId, page, limit } = queryResult.data
      const skip = (page - 1) * limit

      const conditions = [eq(invoices.userId, userId)]
      if (status) conditions.push(eq(invoices.status, status))
      if (clientId) conditions.push(eq(invoices.clientId, clientId))

      const [rows, [{ total }], [totals]] = await Promise.all([
        db.select().from(invoices)
          .where(and(...conditions))
          .orderBy(desc(invoices.createdAt))
          .limit(limit).offset(skip),
        db.select({ total: count() }).from(invoices).where(and(...conditions)),
        // Summary tiles for the list page, over the whole filtered set.
        db.select({
          billed: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)`,
          collected: sql<string>`coalesce(sum(${invoices.amountPaid}), 0)`,
        }).from(invoices).where(and(...conditions)),
      ])

      const billed = Number(totals?.billed ?? 0)
      const collected = Number(totals?.collected ?? 0)

      return reply.send({
        data: rows.map(serialize),
        summary: { billed, collected, outstanding: billed - collected },
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      })
    })

    // POST /api/invoices
    priv.post('/', async (request, reply) => {
      const userId = request.user.sub
      const result = createInvoiceSchema.safeParse(request.body)
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
      }

      const { lineItems, amountPaid, status, clientId, clientEmail, ...rest } = result.data

      // A supplied clientId must belong to the caller.
      if (clientId) {
        const [client] = await db.select({ id: clients.id })
          .from(clients)
          .where(and(eq(clients.id, clientId), eq(clients.userId, userId)))
          .limit(1)
        if (!client) return reply.code(404).send({ error: 'Client not found' })
      }

      const totals = computeInvoiceTotals(lineItems, rest.supplierStateCode, rest.placeOfSupplyCode)
      const paid = amountPaid ?? 0
      const id = crypto.randomUUID()

      await db.insert(invoices).values({
        id,
        ...rest,
        clientId: clientId ?? null,
        clientEmail: clientEmail || null,
        lineItems,
        isInterState: totals.isInterState,
        subtotal: String(totals.subtotal),
        discountTotal: String(totals.discountTotal),
        taxableAmount: String(totals.taxableAmount),
        cgstAmount: String(totals.cgstAmount),
        sgstAmount: String(totals.sgstAmount),
        igstAmount: String(totals.igstAmount),
        totalTax: String(totals.totalTax),
        roundOff: String(totals.roundOff),
        totalAmount: String(totals.totalAmount),
        amountInWords: totals.amountInWords,
        amountPaid: String(paid),
        status: derivedStatus(status, undefined, totals.totalAmount, paid),
        userId,
      })

      const [created] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
      return reply.code(201).send({ data: serialize(created) })
    })

    // GET /api/invoices/:id
    priv.get('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }

      const row = await getInvoiceWithCompany(and(eq(invoices.id, id), eq(invoices.userId, userId))!)
      if (!row) return reply.code(404).send({ error: 'Invoice not found' })

      return reply.send({ data: row })
    })

    // PATCH /api/invoices/:id
    priv.patch('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }
      const result = updateInvoiceSchema.safeParse(request.body)
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
      }

      const [existing] = await db.select().from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Invoice not found' })

      const { lineItems, amountPaid, status, clientEmail, clientId, ...rest } = result.data

      // Re-pointing the invoice at a client requires that client to be ours.
      if (clientId) {
        const [client] = await db.select({ id: clients.id })
          .from(clients)
          .where(and(eq(clients.id, clientId), eq(clients.userId, userId)))
          .limit(1)
        if (!client) return reply.code(404).send({ error: 'Client not found' })
      }

      // Totals are recomputed whenever items or the place of supply move.
      const items = lineItems ?? existing.lineItems ?? []
      const supplierCode = rest.supplierStateCode !== undefined ? rest.supplierStateCode : existing.supplierStateCode
      const placeCode = rest.placeOfSupplyCode !== undefined ? rest.placeOfSupplyCode : existing.placeOfSupplyCode
      const totals = computeInvoiceTotals(items, supplierCode, placeCode)
      const paid = amountPaid !== undefined ? amountPaid : Number(existing.amountPaid)

      await db.update(invoices).set({
        ...rest,
        ...(clientId !== undefined ? { clientId: clientId || null } : {}),
        ...(clientEmail !== undefined ? { clientEmail: clientEmail || null } : {}),
        ...(lineItems ? { lineItems } : {}),
        isInterState: totals.isInterState,
        subtotal: String(totals.subtotal),
        discountTotal: String(totals.discountTotal),
        taxableAmount: String(totals.taxableAmount),
        cgstAmount: String(totals.cgstAmount),
        sgstAmount: String(totals.sgstAmount),
        igstAmount: String(totals.igstAmount),
        totalTax: String(totals.totalTax),
        roundOff: String(totals.roundOff),
        totalAmount: String(totals.totalAmount),
        amountInWords: totals.amountInWords,
        amountPaid: String(paid),
        status: derivedStatus(status, existing.status, totals.totalAmount, paid),
      }).where(eq(invoices.id, id))

      const [updated] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
      return reply.send({ data: serialize(updated) })
    })

    // PATCH /api/invoices/:id/payment — record how much has been received
    priv.patch('/:id/payment', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }
      const result = markPaidSchema.safeParse(request.body)
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
      }

      const [existing] = await db.select({ status: invoices.status, totalAmount: invoices.totalAmount })
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Invoice not found' })

      const { amountPaid } = result.data
      await db.update(invoices).set({
        amountPaid: String(amountPaid),
        status: derivedStatus(undefined, existing.status, Number(existing.totalAmount), amountPaid),
      }).where(eq(invoices.id, id))

      const [updated] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
      return reply.send({ data: serialize(updated) })
    })

    // DELETE /api/invoices/:id
    priv.delete('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }

      const [existing] = await db.select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Invoice not found' })

      await db.delete(invoices).where(eq(invoices.id, id))
      return reply.code(204).send()
    })

    // POST /api/invoices/:id/share
    priv.post('/:id/share', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }

      const [existing] = await db.select({ id: invoices.id, shareToken: invoices.shareToken, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Invoice not found' })

      const token = existing.shareToken ?? crypto.randomUUID()
      if (!existing.shareToken) {
        await db.update(invoices).set({
          shareToken: token,
          // Sharing issues the invoice, but never downgrades a paid one.
          ...(existing.status === 'DRAFT' ? { status: 'SENT' as const } : {}),
        }).where(eq(invoices.id, id))
      }

      return reply.send({ data: { shareToken: token } })
    })
  })
}
