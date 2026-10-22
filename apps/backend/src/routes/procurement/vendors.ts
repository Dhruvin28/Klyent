import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, ne, asc, like, inArray, isNull, count, sql } from 'drizzle-orm'
import {
  db,
  studioVendors,
  studioQuotes,
  vendorProducts,
  vendorProductPrices,
  procurementItems,
  purchaseOrders,
} from '../../db'
import { validationError, syncItemStatuses } from './shared'

const vendorSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable().or(z.literal('')),
  gstin: z.string().max(20).optional().nullable(),
  address: z.string().max(1000).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
})

function isDuplicateKey(err: unknown) {
  return (err as { code?: string })?.code === 'ER_DUP_ENTRY'
}

export default async function vendorRoutes(app: FastifyInstance) {
  // GET /api/procurement/vendors — with catalog size and order totals per vendor
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const result = listQuerySchema.safeParse(request.query)
    if (!result.success) return validationError(reply, result.error)

    const conditions = [eq(studioVendors.userId, userId)]
    if (result.data.q) conditions.push(like(studioVendors.name, `%${result.data.q}%`))

    const [vendors, productCounts, quoteCounts, orderTotals] = await Promise.all([
      db.select().from(studioVendors).where(and(...conditions)).orderBy(asc(studioVendors.name)),
      db.select({ vendorId: vendorProducts.vendorId, n: count() })
        .from(vendorProducts)
        .where(eq(vendorProducts.userId, userId))
        .groupBy(vendorProducts.vendorId),
      db.select({ vendorId: studioQuotes.vendorId, n: count() })
        .from(studioQuotes)
        .where(eq(studioQuotes.userId, userId))
        .groupBy(studioQuotes.vendorId),
      db.select({
        vendorId: purchaseOrders.vendorId,
        n: count(),
        total: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}), 0)`,
        paid: sql<string>`coalesce(sum(${purchaseOrders.amountPaid}), 0)`,
      })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.userId, userId), ne(purchaseOrders.status, 'CANCELLED')))
        .groupBy(purchaseOrders.vendorId),
    ])

    const products = new Map(productCounts.map((r) => [r.vendorId, Number(r.n)]))
    const quotes = new Map(quoteCounts.map((r) => [r.vendorId, Number(r.n)]))
    const orders = new Map(orderTotals.map((r) => [r.vendorId, r]))

    return reply.send({
      data: vendors.map((v) => {
        const o = orders.get(v.id)
        const total = Number(o?.total ?? 0)
        const paid = Number(o?.paid ?? 0)
        return {
          ...v,
          productCount: products.get(v.id) ?? 0,
          quoteCount: quotes.get(v.id) ?? 0,
          orderCount: Number(o?.n ?? 0),
          totalOrdered: total,
          totalPaid: paid,
          balanceDue: total - paid,
        }
      }),
    })
  })

  // POST /api/procurement/vendors
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = vendorSchema.safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const { email, gstin, ...rest } = result.data
    const id = crypto.randomUUID()
    try {
      await db.insert(studioVendors).values({
        id,
        userId,
        ...rest,
        email: email || null,
        gstin: gstin ? gstin.toUpperCase() : null,
      })
    } catch (err) {
      if (isDuplicateKey(err)) return reply.code(409).send({ error: 'A vendor with this name already exists' })
      throw err
    }

    const [created] = await db.select().from(studioVendors).where(eq(studioVendors.id, id)).limit(1)
    return reply.code(201).send({ data: created })
  })

  // PATCH /api/procurement/vendors/:id
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = vendorSchema.partial().safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const [existing] = await db.select({ id: studioVendors.id }).from(studioVendors)
      .where(and(eq(studioVendors.id, id), eq(studioVendors.userId, userId)))
      .limit(1)
    if (!existing) return reply.code(404).send({ error: 'Vendor not found' })

    const { email, gstin, ...rest } = result.data
    try {
      await db.update(studioVendors).set({
        ...rest,
        ...(email !== undefined ? { email: email || null } : {}),
        ...(gstin !== undefined ? { gstin: gstin ? gstin.toUpperCase() : null } : {}),
      }).where(eq(studioVendors.id, id))
    } catch (err) {
      if (isDuplicateKey(err)) return reply.code(409).send({ error: 'A vendor with this name already exists' })
      throw err
    }

    const [updated] = await db.select().from(studioVendors).where(eq(studioVendors.id, id)).limit(1)
    return reply.send({ data: updated })
  })

  // DELETE /api/procurement/vendors/:id
  // Refused while the vendor has purchase orders — those are business records.
  // Their catalog goes with them; quotes entered by hand are removed, and quotes
  // the AI extracted from conversations stay, without a vendor.
  app.delete('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [existing] = await db.select({ id: studioVendors.id }).from(studioVendors)
      .where(and(eq(studioVendors.id, id), eq(studioVendors.userId, userId)))
      .limit(1)
    if (!existing) return reply.code(404).send({ error: 'Vendor not found' })

    const [{ n: orderCount }] = await db.select({ n: count() }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.userId, userId), eq(purchaseOrders.vendorId, id)))
    if (Number(orderCount) > 0) {
      return reply.code(409).send({ error: 'This vendor has purchase orders and cannot be deleted' })
    }

    const quotes = await db.select({ id: studioQuotes.id, itemId: studioQuotes.itemId })
      .from(studioQuotes)
      .where(and(eq(studioQuotes.userId, userId), eq(studioQuotes.vendorId, id)))
    const quoteIds = quotes.map((q) => q.id)

    if (quoteIds.length > 0) {
      // Items that had one of these quotes approved go back to comparing.
      const affected = await db.select({ id: procurementItems.id }).from(procurementItems)
        .where(and(eq(procurementItems.userId, userId), inArray(procurementItems.approvedQuoteId, quoteIds)))
      if (affected.length > 0) {
        await db.update(procurementItems).set({ approvedQuoteId: null })
          .where(inArray(procurementItems.id, affected.map((i) => i.id)))
      }

      await db.delete(studioQuotes).where(and(
        inArray(studioQuotes.id, quoteIds),
        isNull(studioQuotes.sourceMessageId),
        isNull(studioQuotes.sourceDocumentId),
      ))
      await db.update(studioQuotes).set({ vendorId: null }).where(inArray(studioQuotes.id, quoteIds))
      await syncItemStatuses(userId, [...affected.map((i) => i.id), ...quotes.map((q) => q.itemId)])
    }

    const products = await db.select({ id: vendorProducts.id }).from(vendorProducts)
      .where(and(eq(vendorProducts.userId, userId), eq(vendorProducts.vendorId, id)))
    if (products.length > 0) {
      const productIds = products.map((p) => p.id)
      await db.delete(vendorProductPrices).where(inArray(vendorProductPrices.productId, productIds))
      await db.delete(vendorProducts).where(inArray(vendorProducts.id, productIds))
    }

    await db.delete(studioVendors).where(eq(studioVendors.id, id))
    return reply.code(204).send()
  })
}
