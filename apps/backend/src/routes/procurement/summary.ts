import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, ne, inArray } from 'drizzle-orm'
import { db, procurementItems, studioProjects, studioQuotes, purchaseOrders } from '../../db'
import { validationError, toNum } from './shared'

const querySchema = z.object({ projectId: z.string().max(128).optional() })

export default async function summaryRoutes(app: FastifyInstance) {
  // GET /api/procurement/summary — the money picture for one project or all of them.
  // Item figures are before GST (what the client is quoted against); order
  // figures are PO totals including GST (what will actually be paid out).
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const result = querySchema.safeParse(request.query)
    if (!result.success) return validationError(reply, result.error)
    const { projectId } = result.data

    let budget: number | null = null
    if (projectId) {
      const [project] = await db.select({ budget: studioProjects.budget }).from(studioProjects)
        .where(and(eq(studioProjects.id, projectId), eq(studioProjects.userId, userId)))
        .limit(1)
      if (!project) return reply.code(404).send({ error: 'Project not found' })
      budget = toNum(project.budget)
    }

    const itemConditions = [eq(procurementItems.userId, userId), ne(procurementItems.status, 'cancelled')]
    const orderConditions = [eq(purchaseOrders.userId, userId), ne(purchaseOrders.status, 'CANCELLED')]
    if (projectId) {
      itemConditions.push(eq(procurementItems.projectId, projectId))
      orderConditions.push(eq(purchaseOrders.projectId, projectId))
    }

    const [items, orders] = await Promise.all([
      db.select().from(procurementItems).where(and(...itemConditions)),
      db.select({
        status: purchaseOrders.status,
        totalAmount: purchaseOrders.totalAmount,
        amountPaid: purchaseOrders.amountPaid,
      }).from(purchaseOrders).where(and(...orderConditions)),
    ])

    const itemIds = items.map((i) => i.id)
    const quotes = itemIds.length
      ? await db.select({ id: studioQuotes.id, itemId: studioQuotes.itemId, price: studioQuotes.price, status: studioQuotes.status })
          .from(studioQuotes)
          .where(and(eq(studioQuotes.userId, userId), inArray(studioQuotes.itemId, itemIds)))
      : []

    const counts = { open: 0, approved: 0, ordered: 0, received: 0 }
    let approvedCost = 0
    let clientValue = 0
    let marginBase = 0
    let margin = 0
    let savings = 0
    let unpricedForClient = 0

    for (const item of items) {
      counts[item.status as keyof typeof counts]++
      const qty = Number(item.quantity)
      const clientRate = toNum(item.clientRate)
      if (clientRate !== null) clientValue += clientRate * qty

      const itemQuotes = quotes.filter((q) => q.itemId === item.id && q.status !== 'rejected' && toNum(q.price) !== null)
      const approved = itemQuotes.find((q) => q.id === item.approvedQuoteId)
      if (!approved) continue

      const cost = Number(approved.price) * qty
      approvedCost += cost
      if (clientRate !== null) {
        marginBase += clientRate * qty
        margin += clientRate * qty - cost
      } else {
        unpricedForClient++
      }
      // Saved against the dearest competing quote for the same item.
      if (itemQuotes.length > 1) {
        savings += (Math.max(...itemQuotes.map((q) => Number(q.price))) - Number(approved.price)) * qty
      }
    }

    const committed = orders.reduce((s, o) => s + Number(o.totalAmount), 0)
    const paid = orders.reduce((s, o) => s + Number(o.amountPaid), 0)

    return reply.send({
      data: {
        budget,
        items: { total: items.length, ...counts },
        approvedCost,
        clientValue,
        margin,
        marginPercent: marginBase > 0 ? (margin / marginBase) * 100 : null,
        itemsWithoutClientRate: unpricedForClient,
        savings,
        orders: {
          count: orders.length,
          committed,
          paid,
          outstanding: committed - paid,
          awaitingDelivery: orders.filter((o) => o.status === 'SENT' || o.status === 'PARTIALLY_RECEIVED').length,
        },
      },
    })
  })
}
