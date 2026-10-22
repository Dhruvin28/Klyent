import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc, inArray, isNull } from 'drizzle-orm'
import {
  db,
  studioProjects,
  studioVendors,
  studioMaterials,
  studioQuotes,
  vendorProducts,
  procurementItems,
} from '../../db'
import {
  validationError,
  numericFields,
  toNum,
  ownedProject,
  ownedVendor,
  findOrCreateVendor,
  ordersForItem,
  syncItemStatuses,
} from './shared'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const itemSchema = z.object({
  projectId: z.string().max(128).optional().nullable(),
  title: z.string().trim().min(1).max(255),
  category: z.string().max(100).optional().nullable(),
  specification: z.string().max(4000).optional().nullable(),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(30),
  clientRate: z.number().min(0).optional().nullable(),
  neededBy: dateStr.optional().nullable().or(z.literal('')),
  notes: z.string().max(2000).optional().nullable(),
})

const updateItemSchema = itemSchema.partial().extend({
  // Only cancelling and re-opening are manual; every other status is derived.
  status: z.enum(['cancelled', 'open']).optional(),
})

const listQuerySchema = z.object({
  projectId: z.string().max(128).optional(),
  status: z.enum(['open', 'approved', 'ordered', 'received', 'cancelled']).optional(),
  ids: z.string().max(4000).optional(),
})

const quoteSchema = z.object({
  productId: z.string().max(128).optional().nullable(),
  vendorId: z.string().max(128).optional().nullable(),
  vendorName: z.string().trim().max(255).optional().nullable(),
  price: z.number().min(0).optional(),
  unit: z.string().max(30).optional().nullable(),
  gstRate: z.number().min(0).max(100).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
  validTill: dateStr.optional().nullable().or(z.literal('')),
  notes: z.string().max(2000).optional().nullable(),
})

const updateQuoteSchema = quoteSchema.omit({ productId: true, vendorName: true }).extend({
  status: z.enum(['quoted', 'revised', 'rejected']).optional(),
})

const ITEM_NUMERIC = ['quantity', 'clientRate'] as const
const QUOTE_NUMERIC = ['price', 'gstRate', 'confidence'] as const

const quoteColumns = {
  id: studioQuotes.id,
  itemId: studioQuotes.itemId,
  projectId: studioQuotes.projectId,
  vendorId: studioQuotes.vendorId,
  vendorName: studioVendors.name,
  vendorPhone: studioVendors.phone,
  vendorGstin: studioVendors.gstin,
  productId: studioQuotes.productId,
  productName: vendorProducts.name,
  productBrand: vendorProducts.brand,
  materialName: studioMaterials.name,
  description: studioQuotes.description,
  price: studioQuotes.price,
  unit: studioQuotes.unit,
  gstRate: studioQuotes.gstRate,
  leadTimeDays: studioQuotes.leadTimeDays,
  validTill: studioQuotes.validTill,
  notes: studioQuotes.notes,
  status: studioQuotes.status,
  quoteDate: studioQuotes.quoteDate,
  sourceMessageId: studioQuotes.sourceMessageId,
  sourceDocumentId: studioQuotes.sourceDocumentId,
  confidence: studioQuotes.confidence,
  createdAt: studioQuotes.createdAt,
}

function quotesQuery() {
  return db.select(quoteColumns).from(studioQuotes)
    .leftJoin(studioVendors, eq(studioVendors.id, studioQuotes.vendorId))
    .leftJoin(vendorProducts, eq(vendorProducts.id, studioQuotes.productId))
    .leftJoin(studioMaterials, eq(studioMaterials.id, studioQuotes.materialId))
}

type QuoteRow = Awaited<ReturnType<typeof quotesQuery>>[number]

// Where the price came from, so the comparison can show an AI-extracted quote
// differently from one typed in or picked from a vendor's catalog.
function serializeQuote(q: QuoteRow) {
  const source = q.sourceMessageId ? 'whatsapp' : q.sourceDocumentId ? 'document' : q.productId ? 'catalog' : 'manual'
  return { ...numericFields(q, QUOTE_NUMERIC), source }
}

const isExtracted = (q: { sourceMessageId: string | null; sourceDocumentId: string | null }) =>
  !!(q.sourceMessageId || q.sourceDocumentId)

async function ownedItem(userId: string, id: string) {
  const [row] = await db.select().from(procurementItems)
    .where(and(eq(procurementItems.id, id), eq(procurementItems.userId, userId)))
    .limit(1)
  return row ?? null
}

async function getItemDetail(userId: string, id: string) {
  const [row] = await db.select({ item: procurementItems, projectName: studioProjects.name })
    .from(procurementItems)
    .leftJoin(studioProjects, eq(studioProjects.id, procurementItems.projectId))
    .where(and(eq(procurementItems.id, id), eq(procurementItems.userId, userId)))
    .limit(1)
  if (!row) return null

  const [quotes, orders] = await Promise.all([
    quotesQuery()
      .where(and(eq(studioQuotes.userId, userId), eq(studioQuotes.itemId, id)))
      .orderBy(desc(studioQuotes.createdAt)),
    ordersForItem(userId, id),
  ])

  return {
    ...numericFields(row.item, ITEM_NUMERIC),
    projectName: row.projectName,
    quotes: quotes.map(serializeQuote),
    orders: orders.map((o) => {
      const lines = (o.lineItems ?? []).filter((l) => l.itemId === id)
      return {
        id: o.id,
        poNumber: o.poNumber,
        status: o.status,
        vendorName: o.vendorName,
        quantity: lines.reduce((s, l) => s + l.quantity, 0),
        receivedQuantity: lines.reduce((s, l) => s + (l.receivedQuantity ?? 0), 0),
      }
    }),
  }
}

export default async function itemRoutes(app: FastifyInstance) {
  // GET /api/procurement/items — requirements with a digest of their quotes
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const result = listQuerySchema.safeParse(request.query)
    if (!result.success) return validationError(reply, result.error)
    const { projectId, status, ids } = result.data

    const conditions = [eq(procurementItems.userId, userId)]
    if (projectId) conditions.push(eq(procurementItems.projectId, projectId))
    if (status) conditions.push(eq(procurementItems.status, status))
    if (ids) {
      const list = ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
      if (list.length === 0) return reply.send({ data: [] })
      conditions.push(inArray(procurementItems.id, list))
    }

    const rows = await db.select({ item: procurementItems, projectName: studioProjects.name })
      .from(procurementItems)
      .leftJoin(studioProjects, eq(studioProjects.id, procurementItems.projectId))
      .where(and(...conditions))
      .orderBy(desc(procurementItems.createdAt))

    const itemIds = rows.map((r) => r.item.id)
    const quotes = itemIds.length
      ? await quotesQuery().where(and(eq(studioQuotes.userId, userId), inArray(studioQuotes.itemId, itemIds)))
      : []
    const byItem = new Map<string, QuoteRow[]>()
    for (const q of quotes) {
      if (!q.itemId) continue
      const list = byItem.get(q.itemId) ?? []
      list.push(q)
      byItem.set(q.itemId, list)
    }

    return reply.send({
      data: rows.map(({ item, projectName }) => {
        const itemQuotes = byItem.get(item.id) ?? []
        const priced = itemQuotes.filter((q) => toNum(q.price) !== null && q.status !== 'rejected')
        const lowest = priced.reduce<QuoteRow | null>(
          (best, q) => (!best || Number(q.price) < Number(best.price) ? q : best), null)
        const approved = itemQuotes.find((q) => q.id === item.approvedQuoteId)
        return {
          ...numericFields(item, ITEM_NUMERIC),
          projectName,
          quoteCount: itemQuotes.length,
          lowestPrice: lowest ? Number(lowest.price) : null,
          lowestVendorName: lowest?.vendorName ?? null,
          highestPrice: priced.length ? Math.max(...priced.map((q) => Number(q.price))) : null,
          approvedQuote: approved ? serializeQuote(approved) : null,
        }
      }),
    })
  })

  // GET /api/procurement/items/unlinked-quotes — quotes not yet attached to a
  // requirement (mostly ones the AI extracted from WhatsApp and documents)
  app.get('/unlinked-quotes', async (request, reply) => {
    const userId = request.user.sub
    const { projectId } = request.query as { projectId?: string }
    const conditions = [eq(studioQuotes.userId, userId), isNull(studioQuotes.itemId)]
    if (projectId) conditions.push(eq(studioQuotes.projectId, projectId))
    const rows = await quotesQuery().where(and(...conditions)).orderBy(desc(studioQuotes.createdAt)).limit(200)
    return reply.send({ data: rows.map(serializeQuote) })
  })

  // POST /api/procurement/items
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = itemSchema.safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const { projectId, quantity, clientRate, neededBy, ...rest } = result.data
    if (projectId && !(await ownedProject(userId, projectId))) {
      return reply.code(404).send({ error: 'Project not found' })
    }

    const id = crypto.randomUUID()
    await db.insert(procurementItems).values({
      id,
      userId,
      ...rest,
      projectId: projectId || null,
      quantity: String(quantity),
      clientRate: clientRate != null ? String(clientRate) : null,
      neededBy: neededBy || null,
    })

    return reply.code(201).send({ data: await getItemDetail(userId, id) })
  })

  // GET /api/procurement/items/:id — the comparison: item, all quotes, its orders
  app.get('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const detail = await getItemDetail(userId, id)
    if (!detail) return reply.code(404).send({ error: 'Item not found' })
    return reply.send({ data: detail })
  })

  // PATCH /api/procurement/items/:id
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = updateItemSchema.safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const existing = await ownedItem(userId, id)
    if (!existing) return reply.code(404).send({ error: 'Item not found' })

    const { projectId, quantity, clientRate, neededBy, status, ...rest } = result.data
    if (projectId && !(await ownedProject(userId, projectId))) {
      return reply.code(404).send({ error: 'Project not found' })
    }

    await db.update(procurementItems).set({
      ...rest,
      ...(projectId !== undefined ? { projectId: projectId || null } : {}),
      ...(quantity !== undefined ? { quantity: String(quantity) } : {}),
      ...(clientRate !== undefined ? { clientRate: clientRate != null ? String(clientRate) : null } : {}),
      ...(neededBy !== undefined ? { neededBy: neededBy || null } : {}),
      // Re-opening hands the status back to the derivation below.
      ...(status ? { status } : {}),
    }).where(eq(procurementItems.id, id))

    // Quotes follow the requirement if it moves to another project.
    if (projectId !== undefined) {
      await db.update(studioQuotes).set({ projectId: projectId || null })
        .where(and(eq(studioQuotes.userId, userId), eq(studioQuotes.itemId, id)))
    }

    if (status !== 'cancelled') await syncItemStatuses(userId, [id])
    return reply.send({ data: await getItemDetail(userId, id) })
  })

  // DELETE /api/procurement/items/:id — refused while it is on a purchase order.
  // Hand-entered quotes go with it; extracted ones are only unlinked.
  app.delete('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    if (!(await ownedItem(userId, id))) return reply.code(404).send({ error: 'Item not found' })
    if ((await ordersForItem(userId, id)).length > 0) {
      return reply.code(409).send({ error: 'This item is on a purchase order. Cancel or edit that order first.' })
    }

    const owned = and(eq(studioQuotes.userId, userId), eq(studioQuotes.itemId, id))
    await db.delete(studioQuotes).where(and(owned, isNull(studioQuotes.sourceMessageId), isNull(studioQuotes.sourceDocumentId)))
    await db.update(studioQuotes).set({ itemId: null, status: 'quoted' }).where(owned)
    await db.delete(procurementItems).where(eq(procurementItems.id, id))
    return reply.code(204).send()
  })

  // POST /api/procurement/items/:id/quotes — add a vendor's price. From a catalog
  // product the vendor, unit, GST and lead time are filled in from the product.
  app.post('/:id/quotes', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = quoteSchema.safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const item = await ownedItem(userId, id)
    if (!item) return reply.code(404).send({ error: 'Item not found' })

    const body = result.data
    let vendorId = body.vendorId ?? null
    let price = body.price
    let unit = body.unit ?? null
    let gstRate = body.gstRate ?? null
    let leadTimeDays = body.leadTimeDays ?? null
    let productId: string | null = null

    if (body.productId) {
      const [product] = await db.select().from(vendorProducts)
        .where(and(eq(vendorProducts.id, body.productId), eq(vendorProducts.userId, userId)))
        .limit(1)
      if (!product) return reply.code(404).send({ error: 'Product not found' })
      productId = product.id
      vendorId = product.vendorId
      price = price ?? Number(product.price)
      unit = unit ?? product.unit
      gstRate = gstRate ?? Number(product.gstRate)
      leadTimeDays = leadTimeDays ?? product.leadTimeDays
    } else if (vendorId) {
      if (!(await ownedVendor(userId, vendorId))) return reply.code(404).send({ error: 'Vendor not found' })
    } else if (body.vendorName) {
      vendorId = (await findOrCreateVendor(userId, body.vendorName)).id
    } else {
      return reply.code(400).send({ error: 'Choose a vendor or a catalog product' })
    }
    if (price === undefined) return reply.code(400).send({ error: 'Price is required' })

    await db.insert(studioQuotes).values({
      id: crypto.randomUUID(),
      userId,
      projectId: item.projectId,
      itemId: id,
      vendorId,
      productId,
      description: item.title,
      price: String(price),
      unit: unit ?? item.unit,
      gstRate: gstRate != null ? String(gstRate) : null,
      leadTimeDays,
      validTill: body.validTill || null,
      notes: body.notes ?? null,
      status: 'quoted',
      quoteDate: new Date(),
    })

    return reply.code(201).send({ data: await getItemDetail(userId, id) })
  })

  // POST /api/procurement/items/:id/link-quotes — attach existing quotes
  app.post('/:id/link-quotes', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = z.object({ quoteIds: z.array(z.string().max(128)).min(1).max(100) }).safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const item = await ownedItem(userId, id)
    if (!item) return reply.code(404).send({ error: 'Item not found' })

    await db.update(studioQuotes).set({ itemId: id, projectId: item.projectId })
      .where(and(
        eq(studioQuotes.userId, userId),
        inArray(studioQuotes.id, result.data.quoteIds),
        isNull(studioQuotes.itemId),
      ))

    return reply.send({ data: await getItemDetail(userId, id) })
  })

  // POST /api/procurement/items/:id/approve — pick the winning quote
  app.post('/:id/approve', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = z.object({ quoteId: z.string().max(128) }).safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const item = await ownedItem(userId, id)
    if (!item) return reply.code(404).send({ error: 'Item not found' })
    if (item.status === 'cancelled') return reply.code(409).send({ error: 'This item is cancelled' })

    const [quote] = await db.select({ id: studioQuotes.id, price: studioQuotes.price, vendorId: studioQuotes.vendorId })
      .from(studioQuotes)
      .where(and(eq(studioQuotes.id, result.data.quoteId), eq(studioQuotes.userId, userId), eq(studioQuotes.itemId, id)))
      .limit(1)
    if (!quote) return reply.code(404).send({ error: 'Quote not found' })
    if (toNum(quote.price) === null) return reply.code(400).send({ error: 'Add a price to this quote before approving it' })
    if (!quote.vendorId) return reply.code(400).send({ error: 'Assign a vendor to this quote before approving it' })

    if (item.approvedQuoteId && item.approvedQuoteId !== quote.id) {
      await db.update(studioQuotes).set({ status: 'quoted' }).where(eq(studioQuotes.id, item.approvedQuoteId))
    }
    await db.update(studioQuotes).set({ status: 'approved' }).where(eq(studioQuotes.id, quote.id))
    await db.update(procurementItems).set({ approvedQuoteId: quote.id }).where(eq(procurementItems.id, id))
    await syncItemStatuses(userId, [id])

    return reply.send({ data: await getItemDetail(userId, id) })
  })

  // POST /api/procurement/items/:id/unapprove
  app.post('/:id/unapprove', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const item = await ownedItem(userId, id)
    if (!item) return reply.code(404).send({ error: 'Item not found' })

    if (item.approvedQuoteId) {
      await db.update(studioQuotes).set({ status: 'quoted' }).where(eq(studioQuotes.id, item.approvedQuoteId))
      await db.update(procurementItems).set({ approvedQuoteId: null }).where(eq(procurementItems.id, id))
      await syncItemStatuses(userId, [id])
    }
    return reply.send({ data: await getItemDetail(userId, id) })
  })

  // PATCH /api/procurement/items/quotes/:quoteId — correct a price or terms
  app.patch('/quotes/:quoteId', async (request, reply) => {
    const userId = request.user.sub
    const { quoteId } = request.params as { quoteId: string }
    const result = updateQuoteSchema.safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const [quote] = await db.select({ id: studioQuotes.id, itemId: studioQuotes.itemId, status: studioQuotes.status })
      .from(studioQuotes)
      .where(and(eq(studioQuotes.id, quoteId), eq(studioQuotes.userId, userId)))
      .limit(1)
    if (!quote) return reply.code(404).send({ error: 'Quote not found' })

    const { vendorId, price, gstRate, validTill, status, ...rest } = result.data
    if (vendorId && !(await ownedVendor(userId, vendorId))) return reply.code(404).send({ error: 'Vendor not found' })
    if (status === 'rejected' && quote.status === 'approved') {
      return reply.code(409).send({ error: 'Un-approve this quote before rejecting it' })
    }

    await db.update(studioQuotes).set({
      ...rest,
      ...(vendorId !== undefined ? { vendorId } : {}),
      ...(price !== undefined ? { price: String(price) } : {}),
      ...(gstRate !== undefined ? { gstRate: gstRate != null ? String(gstRate) : null } : {}),
      ...(validTill !== undefined ? { validTill: validTill || null } : {}),
      // The approved quote keeps its status; a new price on it is still the approved one.
      ...(status && quote.status !== 'approved' ? { status } : {}),
    }).where(eq(studioQuotes.id, quoteId))

    const detail = quote.itemId ? await getItemDetail(userId, quote.itemId) : null
    return reply.send({ data: detail })
  })

  // DELETE /api/procurement/items/quotes/:quoteId — removes a hand-entered
  // quote; an extracted one is only taken out of the comparison.
  app.delete('/quotes/:quoteId', async (request, reply) => {
    const userId = request.user.sub
    const { quoteId } = request.params as { quoteId: string }

    const [quote] = await db.select().from(studioQuotes)
      .where(and(eq(studioQuotes.id, quoteId), eq(studioQuotes.userId, userId)))
      .limit(1)
    if (!quote) return reply.code(404).send({ error: 'Quote not found' })

    if (quote.itemId) {
      await db.update(procurementItems).set({ approvedQuoteId: null })
        .where(and(eq(procurementItems.id, quote.itemId), eq(procurementItems.approvedQuoteId, quoteId)))
    }
    if (isExtracted(quote)) {
      await db.update(studioQuotes).set({ itemId: null, status: 'quoted' }).where(eq(studioQuotes.id, quoteId))
    } else {
      await db.delete(studioQuotes).where(eq(studioQuotes.id, quoteId))
    }
    await syncItemStatuses(userId, [quote.itemId])

    return reply.code(204).send()
  })
}
