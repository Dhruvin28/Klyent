import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc, count, like, ne, sql } from 'drizzle-orm'
import { db, purchaseOrders, procurementItems, users, studioProjects, type PurchaseOrderLine } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { computeInvoiceTotals } from '../invoices/totals'
import { validationError, numericFields, ownedProject, ownedVendor, stateCodeFromGstin, syncItemStatuses } from './shared'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const lineSchema = z.object({
  id: z.string().min(1).max(64),
  itemId: z.string().max(128).optional().nullable(),
  productId: z.string().max(128).optional().nullable(),
  description: z.string().trim().min(1).max(500),
  hsnSac: z.string().max(20).optional().nullable(),
  quantity: z.number().positive(),
  unit: z.string().max(30).optional().nullable(),
  rate: z.number().min(0),
  discountPercent: z.number().min(0).max(100).optional().default(0),
  taxRate: z.number().min(0).max(100).optional().default(0),
})

const STATUSES = ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const
type PoStatus = (typeof STATUSES)[number]

const createOrderSchema = z.object({
  poNumber: z.string().trim().min(1).max(100),
  poDate: dateStr,
  expectedDelivery: dateStr.optional().nullable().or(z.literal('')),
  projectId: z.string().max(128).optional().nullable(),
  vendorId: z.string().min(1).max(128),
  deliveryAddress: z.string().max(1000).optional().nullable(),
  placeOfSupplyCode: z.string().max(2).optional().nullable(),
  placeOfSupplyName: z.string().max(100).optional().nullable(),
  lineItems: z.array(lineSchema).min(1, 'At least one line item is required').max(200),
  notes: z.string().max(2000).optional().nullable(),
  termsAndConditions: z.array(z.string().max(500)).optional().nullable(),
  // Only DRAFT, SENT and CANCELLED are chosen; the received states follow deliveries.
  status: z.enum(['DRAFT', 'SENT', 'CANCELLED']).optional(),
})

const updateOrderSchema = createOrderSchema.partial()

const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  projectId: z.string().max(128).optional(),
  vendorId: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

const receiveSchema = z.object({
  lines: z.array(z.object({ id: z.string().max(64), receivedQuantity: z.number().min(0) })).min(1),
})

const NUMERIC = [
  'subtotal', 'discountTotal', 'taxableAmount', 'cgstAmount', 'sgstAmount',
  'igstAmount', 'totalTax', 'roundOff', 'totalAmount', 'amountPaid',
] as const

function serialize<T extends Record<string, unknown>>(row: T) {
  const out = numericFields(row, NUMERIC)
  return { ...out, balanceDue: Number(out.totalAmount ?? 0) - Number(out.amountPaid ?? 0) }
}

// Delivery status follows received quantities, except for the states set on purpose.
function derivedStatus(requested: PoStatus | undefined, current: PoStatus | undefined, lines: PurchaseOrderLine[]): PoStatus {
  const status = requested ?? current ?? 'DRAFT'
  if (status === 'CANCELLED' || status === 'DRAFT') return status
  const received = lines.reduce((s, l) => s + (l.receivedQuantity ?? 0), 0)
  if (received <= 0) return 'SENT'
  return lines.every((l) => (l.receivedQuantity ?? 0) >= l.quantity) ? 'RECEIVED' : 'PARTIALLY_RECEIVED'
}

function totalsColumns(lines: PurchaseOrderLine[], supplierCode: string | null, placeCode: string | null) {
  const t = computeInvoiceTotals(lines, supplierCode, placeCode)
  return {
    isInterState: t.isInterState,
    subtotal: String(t.subtotal),
    discountTotal: String(t.discountTotal),
    taxableAmount: String(t.taxableAmount),
    cgstAmount: String(t.cgstAmount),
    sgstAmount: String(t.sgstAmount),
    igstAmount: String(t.igstAmount),
    totalTax: String(t.totalTax),
    roundOff: String(t.roundOff),
    totalAmount: String(t.totalAmount),
    amountInWords: t.amountInWords,
  }
}

const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory',
} // Kept in sync with apps/frontend/src/lib/indianStates.ts.

// The vendor's details at the time of ordering, and their state from the GSTIN.
function vendorSnapshot(v: NonNullable<Awaited<ReturnType<typeof ownedVendor>>>) {
  const code = stateCodeFromGstin(v.gstin)
  return {
    vendorId: v.id,
    vendorName: v.name,
    vendorPhone: v.phone,
    vendorEmail: v.email,
    vendorAddress: v.address,
    vendorGstin: v.gstin,
    supplierStateCode: code,
    supplierStateName: code ? STATE_NAMES[code] ?? null : null,
  }
}

// Requirement ids on the lines must be the caller's.
async function checkItemIds(userId: string, lines: { itemId?: string | null }[]) {
  for (const id of new Set(lines.map((l) => l.itemId).filter(Boolean) as string[])) {
    const [row] = await db.select({ id: procurementItems.id }).from(procurementItems)
      .where(and(eq(procurementItems.id, id), eq(procurementItems.userId, userId)))
      .limit(1)
    if (!row) return false
  }
  return true
}

async function getOrderWithCompany(whereClause: ReturnType<typeof and>) {
  const [row] = await db
    .select({
      order: purchaseOrders,
      projectName: studioProjects.name,
      companyName: users.companyName,
      companyLogoUrl: users.companyLogoUrl,
      companyPhone: users.companyPhone,
      companyAddress: users.companyAddress,
      companyWebsite: users.companyWebsite,
      companyGstin: users.companyGstin,
    })
    .from(purchaseOrders)
    .innerJoin(users, eq(purchaseOrders.userId, users.id))
    .leftJoin(studioProjects, eq(studioProjects.id, purchaseOrders.projectId))
    .where(whereClause)
    .limit(1)
  if (!row) return null
  const { order, ...rest } = row
  return { ...serialize(order), ...rest }
}

export default async function orderRoutes(app: FastifyInstance) {
  // ── PUBLIC — the vendor's view of a shared PO ──────────────────
  app.register(async (pub: FastifyInstance) => {
    pub.get('/share/:token', async (request, reply) => {
      const { token } = request.params as { token: string }
      const row = await getOrderWithCompany(eq(purchaseOrders.shareToken, token) as ReturnType<typeof and>)
      if (!row || row.status === 'CANCELLED') {
        return reply.code(404).send({ error: 'Purchase order not found or link is invalid' })
      }
      // The vendor does not see what the designer has paid against it or the project name.
      const { amountPaid: _paid, balanceDue: _due, projectName: _project, ...visible } = row
      return reply.send({ data: visible })
    })

    // The vendor confirms they have received and accepted the order.
    pub.post('/share/:token/acknowledge', async (request, reply) => {
      const { token } = request.params as { token: string }
      const [row] = await db.select({ id: purchaseOrders.id, status: purchaseOrders.status, ack: purchaseOrders.vendorAcknowledgedAt })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.shareToken, token))
        .limit(1)
      if (!row || row.status === 'CANCELLED') {
        return reply.code(404).send({ error: 'Purchase order not found or link is invalid' })
      }
      // Whole seconds, as the TIMESTAMP column stores it, so every read agrees.
      const acknowledgedAt = row.ack ?? new Date(Math.floor(Date.now() / 1000) * 1000)
      if (!row.ack) {
        await db.update(purchaseOrders).set({ vendorAcknowledgedAt: acknowledgedAt }).where(eq(purchaseOrders.id, row.id))
      }
      return reply.send({ data: { vendorAcknowledgedAt: acknowledgedAt } })
    })
  })

  // ── PRIVATE ────────────────────────────────────────────────────
  app.register(async (priv: FastifyInstance) => {
    priv.addHook('preHandler', authenticate)

    // GET /api/procurement/orders/next-number
    priv.get('/next-number', async (request, reply) => {
      const userId = request.user.sub
      const now = new Date()
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
      const prefix = `PO/${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}/`

      const [row] = await db
        .select({ maxNumber: sql<string>`max(${purchaseOrders.poNumber})` })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.userId, userId), like(purchaseOrders.poNumber, `${prefix}%`)))

      const lastSeq = row?.maxNumber ? parseInt(row.maxNumber.slice(prefix.length), 10) : 0
      const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1
      return reply.send({ data: { poNumber: `${prefix}${String(nextSeq).padStart(3, '0')}` } })
    })

    // GET /api/procurement/orders
    priv.get('/', async (request, reply) => {
      const userId = request.user.sub
      const result = listQuerySchema.safeParse(request.query)
      if (!result.success) return validationError(reply, result.error)
      const { status, projectId, vendorId, page, limit } = result.data

      const conditions = [eq(purchaseOrders.userId, userId)]
      if (status) conditions.push(eq(purchaseOrders.status, status))
      if (projectId) conditions.push(eq(purchaseOrders.projectId, projectId))
      if (vendorId) conditions.push(eq(purchaseOrders.vendorId, vendorId))

      const [rows, [{ total }], [totals]] = await Promise.all([
        db.select({ order: purchaseOrders, projectName: studioProjects.name })
          .from(purchaseOrders)
          .leftJoin(studioProjects, eq(studioProjects.id, purchaseOrders.projectId))
          .where(and(...conditions))
          .orderBy(desc(purchaseOrders.createdAt))
          .limit(limit).offset((page - 1) * limit),
        db.select({ total: count() }).from(purchaseOrders).where(and(...conditions)),
        db.select({
          ordered: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}), 0)`,
          paid: sql<string>`coalesce(sum(${purchaseOrders.amountPaid}), 0)`,
        }).from(purchaseOrders).where(and(...conditions, ne(purchaseOrders.status, 'CANCELLED'))),
      ])

      const ordered = Number(totals?.ordered ?? 0)
      const paid = Number(totals?.paid ?? 0)
      return reply.send({
        data: rows.map((r) => ({ ...serialize(r.order), projectName: r.projectName })),
        summary: { ordered, paid, outstanding: ordered - paid },
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      })
    })

    // POST /api/procurement/orders
    priv.post('/', async (request, reply) => {
      const userId = request.user.sub
      const result = createOrderSchema.safeParse(request.body)
      if (!result.success) return validationError(reply, result.error)

      const { vendorId, projectId, lineItems, status, expectedDelivery, ...rest } = result.data
      const vendor = await ownedVendor(userId, vendorId)
      if (!vendor) return reply.code(404).send({ error: 'Vendor not found' })
      if (projectId && !(await ownedProject(userId, projectId))) return reply.code(404).send({ error: 'Project not found' })
      if (!(await checkItemIds(userId, lineItems))) return reply.code(404).send({ error: 'Requirement not found' })

      const lines: PurchaseOrderLine[] = lineItems.map((l) => ({ ...l, receivedQuantity: 0 }))
      const snapshot = vendorSnapshot(vendor)
      const id = crypto.randomUUID()

      await db.insert(purchaseOrders).values({
        id,
        userId,
        ...rest,
        ...snapshot,
        projectId: projectId || null,
        expectedDelivery: expectedDelivery || null,
        lineItems: lines,
        ...totalsColumns(lines, snapshot.supplierStateCode, rest.placeOfSupplyCode ?? null),
        status: derivedStatus(status, undefined, lines),
      })
      await syncItemStatuses(userId, lines.map((l) => l.itemId))

      return reply.code(201).send({ data: await getOrderWithCompany(eq(purchaseOrders.id, id) as ReturnType<typeof and>) })
    })

    // GET /api/procurement/orders/:id
    priv.get('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }
      const row = await getOrderWithCompany(and(eq(purchaseOrders.id, id), eq(purchaseOrders.userId, userId))!)
      if (!row) return reply.code(404).send({ error: 'Purchase order not found' })
      return reply.send({ data: row })
    })

    // PATCH /api/procurement/orders/:id
    priv.patch('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }
      const result = updateOrderSchema.safeParse(request.body)
      if (!result.success) return validationError(reply, result.error)

      const [existing] = await db.select().from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Purchase order not found' })

      const { vendorId, projectId, lineItems, status, expectedDelivery, ...rest } = result.data

      let snapshot: ReturnType<typeof vendorSnapshot> | null = null
      if (vendorId) {
        const vendor = await ownedVendor(userId, vendorId)
        if (!vendor) return reply.code(404).send({ error: 'Vendor not found' })
        snapshot = vendorSnapshot(vendor)
      }
      if (projectId && !(await ownedProject(userId, projectId))) return reply.code(404).send({ error: 'Project not found' })
      if (lineItems && !(await checkItemIds(userId, lineItems))) return reply.code(404).send({ error: 'Requirement not found' })

      // Edited lines keep what has already been received against them.
      const previous = new Map((existing.lineItems ?? []).map((l) => [l.id, l]))
      const lines: PurchaseOrderLine[] = lineItems
        ? lineItems.map((l) => ({ ...l, receivedQuantity: previous.get(l.id)?.receivedQuantity ?? 0 }))
        : existing.lineItems ?? []

      const supplierCode = snapshot ? snapshot.supplierStateCode : existing.supplierStateCode
      const placeCode = rest.placeOfSupplyCode !== undefined ? rest.placeOfSupplyCode : existing.placeOfSupplyCode

      await db.update(purchaseOrders).set({
        ...rest,
        ...(snapshot ?? {}),
        ...(projectId !== undefined ? { projectId: projectId || null } : {}),
        ...(expectedDelivery !== undefined ? { expectedDelivery: expectedDelivery || null } : {}),
        lineItems: lines,
        ...totalsColumns(lines, supplierCode, placeCode ?? null),
        // Re-opening a cancelled PO (status SENT) goes back to following deliveries.
        status: derivedStatus(status, existing.status, lines),
      }).where(eq(purchaseOrders.id, id))

      await syncItemStatuses(userId, [...(existing.lineItems ?? []), ...lines].map((l) => l.itemId))
      return reply.send({ data: await getOrderWithCompany(eq(purchaseOrders.id, id) as ReturnType<typeof and>) })
    })

    // PATCH /api/procurement/orders/:id/receive — quantities delivered so far, per line
    priv.patch('/:id/receive', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }
      const result = receiveSchema.safeParse(request.body)
      if (!result.success) return validationError(reply, result.error)

      const [existing] = await db.select().from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Purchase order not found' })
      if (existing.status === 'CANCELLED') return reply.code(409).send({ error: 'This purchase order is cancelled' })

      const received = new Map(result.data.lines.map((l) => [l.id, l.receivedQuantity]))
      const lines = (existing.lineItems ?? []).map((l) => ({
        ...l,
        receivedQuantity: received.has(l.id) ? received.get(l.id)! : l.receivedQuantity ?? 0,
      }))

      // Goods arriving means the order went out, even if it was never marked sent.
      await db.update(purchaseOrders).set({
        lineItems: lines,
        status: derivedStatus(existing.status === 'DRAFT' ? 'SENT' : undefined, existing.status, lines),
      }).where(eq(purchaseOrders.id, id))

      await syncItemStatuses(userId, lines.map((l) => l.itemId))
      return reply.send({ data: await getOrderWithCompany(eq(purchaseOrders.id, id) as ReturnType<typeof and>) })
    })

    // PATCH /api/procurement/orders/:id/payment — total paid to the vendor so far
    priv.patch('/:id/payment', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }
      const result = z.object({ amountPaid: z.number().min(0) }).safeParse(request.body)
      if (!result.success) return validationError(reply, result.error)

      const [existing] = await db.select({ id: purchaseOrders.id }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Purchase order not found' })

      await db.update(purchaseOrders).set({ amountPaid: String(result.data.amountPaid) }).where(eq(purchaseOrders.id, id))
      return reply.send({ data: await getOrderWithCompany(eq(purchaseOrders.id, id) as ReturnType<typeof and>) })
    })

    // DELETE /api/procurement/orders/:id
    priv.delete('/:id', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }

      const [existing] = await db.select({ id: purchaseOrders.id, lineItems: purchaseOrders.lineItems })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Purchase order not found' })

      await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id))
      await syncItemStatuses(userId, (existing.lineItems ?? []).map((l) => l.itemId))
      return reply.code(204).send()
    })

    // POST /api/procurement/orders/:id/share — a link for the vendor; sharing issues the PO
    priv.post('/:id/share', async (request, reply) => {
      const userId = request.user.sub
      const { id } = request.params as { id: string }

      const [existing] = await db.select({ id: purchaseOrders.id, shareToken: purchaseOrders.shareToken, status: purchaseOrders.status })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.userId, userId)))
        .limit(1)
      if (!existing) return reply.code(404).send({ error: 'Purchase order not found' })
      if (existing.status === 'CANCELLED') return reply.code(409).send({ error: 'A cancelled purchase order cannot be shared' })

      const token = existing.shareToken ?? crypto.randomUUID()
      await db.update(purchaseOrders).set({
        shareToken: token,
        ...(existing.status === 'DRAFT' ? { status: 'SENT' as const } : {}),
      }).where(eq(purchaseOrders.id, id))

      return reply.send({ data: { shareToken: token } })
    })
  })
}
