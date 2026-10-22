import { FastifyReply } from 'fastify'
import { ZodError } from 'zod'
import { eq, and, ne, sql } from 'drizzle-orm'
import { db, studioProjects, studioVendors, procurementItems, purchaseOrders } from '../../db'

export function validationError(reply: FastifyReply, error: ZodError) {
  return reply.code(400).send({ error: 'Validation Error', details: error.flatten().fieldErrors })
}

// MySQL DECIMALs come back as strings; the API always returns numbers.
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function numericFields<T extends Record<string, unknown>>(row: T, fields: readonly string[]) {
  const out: Record<string, unknown> = { ...row }
  for (const f of fields) if (f in out) out[f] = toNum(out[f])
  // Typed as the row so callers keep its other fields; the listed ones are now numbers.
  return out as T & Record<string, unknown>
}

// The first two digits of a GSTIN are its state code.
export function stateCodeFromGstin(gstin?: string | null): string | null {
  const code = gstin?.trim().slice(0, 2)
  return code && /^\d{2}$/.test(code) ? code : null
}

export async function ownedProject(userId: string, projectId: string) {
  const [row] = await db
    .select({ id: studioProjects.id, name: studioProjects.name, siteAddress: studioProjects.siteAddress })
    .from(studioProjects)
    .where(and(eq(studioProjects.id, projectId), eq(studioProjects.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function ownedVendor(userId: string, vendorId: string) {
  const [row] = await db
    .select()
    .from(studioVendors)
    .where(and(eq(studioVendors.id, vendorId), eq(studioVendors.userId, userId)))
    .limit(1)
  return row ?? null
}

// Vendor names are unique per user (case-insensitive under the default collation),
// so a typed name either finds the existing vendor or creates one.
export async function findOrCreateVendor(userId: string, name: string) {
  const trimmed = name.trim()
  const [existing] = await db
    .select({ id: studioVendors.id })
    .from(studioVendors)
    .where(and(eq(studioVendors.userId, userId), eq(studioVendors.name, trimmed)))
    .limit(1)
  if (existing) return { id: existing.id, created: false }
  const id = crypto.randomUUID()
  await db.insert(studioVendors).values({ id, userId, name: trimmed })
  return { id, created: true }
}

// Non-cancelled POs (drafts included, so an item is not ordered twice) whose
// lines reference the item.
export async function ordersForItem(userId: string, itemId: string) {
  return db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      vendorName: purchaseOrders.vendorName,
      lineItems: purchaseOrders.lineItems,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.userId, userId),
        ne(purchaseOrders.status, 'CANCELLED'),
        sql`JSON_SEARCH(${purchaseOrders.lineItems}, 'one', ${itemId}, NULL, '$[*].itemId') IS NOT NULL`
      )
    )
}

// An item's status follows its quotes and purchase orders; only 'cancelled' is
// set by hand. Called after anything that approves, orders or receives.
export async function syncItemStatuses(userId: string, itemIds: Iterable<string | null | undefined>) {
  for (const itemId of new Set(itemIds)) {
    if (!itemId) continue
    const [item] = await db
      .select({ status: procurementItems.status, approvedQuoteId: procurementItems.approvedQuoteId })
      .from(procurementItems)
      .where(and(eq(procurementItems.id, itemId), eq(procurementItems.userId, userId)))
      .limit(1)
    if (!item || item.status === 'cancelled') continue

    const lines = (await ordersForItem(userId, itemId))
      .flatMap((o) => o.lineItems ?? [])
      .filter((l) => l.itemId === itemId)

    let status: 'open' | 'approved' | 'ordered' | 'received'
    if (lines.length > 0) {
      status = lines.every((l) => (l.receivedQuantity ?? 0) >= l.quantity) ? 'received' : 'ordered'
    } else {
      status = item.approvedQuoteId ? 'approved' : 'open'
    }
    if (status !== item.status) {
      await db.update(procurementItems).set({ status }).where(eq(procurementItems.id, itemId))
    }
  }
}
