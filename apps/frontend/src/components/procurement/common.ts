import type { ProcurementItemStatus, ProcurementQuote, ProcurementQuoteSource, PurchaseOrderStatus } from '@/types'

export const UNITS = ['Nos', 'Sheet', 'Sqft', 'Sqm', 'Rft', 'Kg', 'Ltr', 'Box', 'Roll', 'Set', 'Pair', 'Pcs', 'Lot']

// Suggestions only — any category can be typed.
export const CATEGORIES = [
  'Plywood & Boards', 'Laminates & Veneers', 'Hardware', 'Tiles', 'Stone & Marble', 'Paint', 'Lighting',
  'Electrical', 'Sanitaryware', 'Glass & Mirrors', 'Fabric & Upholstery', 'Wallpaper', 'Furniture',
  'Appliances', 'Flooring', 'False Ceiling',
]

export const ITEM_STATUS_LABELS: Record<ProcurementItemStatus, string> = {
  open: 'Comparing',
  approved: 'Approved',
  ordered: 'Ordered',
  received: 'Received',
  cancelled: 'Cancelled',
}

export const ITEM_STATUS_COLORS: Record<ProcurementItemStatus, string> = {
  open: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  approved: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  ordered: 'border-transparent bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  received: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'border-transparent bg-gray-100 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-500',
}

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PARTIALLY_RECEIVED: 'Part Received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
}

export const PO_STATUS_COLORS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'border-transparent bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SENT: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  PARTIALLY_RECEIVED: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  RECEIVED: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  CANCELLED: 'border-transparent bg-gray-100 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-500',
}

export const QUOTE_SOURCE_LABELS: Record<ProcurementQuoteSource, string> = {
  whatsapp: 'From WhatsApp',
  document: 'From document',
  catalog: 'Price list',
  manual: 'Entered',
}

// What the quote costs for the item's quantity, GST included.
export function landedTotal(quote: Pick<ProcurementQuote, 'price' | 'gstRate'>, quantity: number): number | null {
  if (quote.price === null) return null
  return quote.price * quantity * (1 + (quote.gstRate ?? 0) / 100)
}

// A quote whose validity date has passed.
export function isExpired(validTill?: string | null): boolean {
  return !!validTill && new Date(validTill) < new Date(new Date().toDateString())
}

export function sameUnit(a?: string | null, b?: string | null): boolean {
  return !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function uid(): string {
  return Math.random().toString(36).slice(2)
}
