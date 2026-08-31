// Client-side mirror of the server's GST calculation, used for the live totals
// panel and the PDF preview while an invoice is being edited. The server
// recomputes and stores its own numbers on save — these are never sent as
// authoritative values.
// Kept in sync with apps/backend/src/routes/invoices/totals.ts.
import { numberToWords } from '@/lib/numberToWords'

export interface CalcLineItem {
  quantity: number
  rate: number
  discountPercent?: number
  taxRate?: number
}

export interface CalcTotals {
  isInterState: boolean
  subtotal: number
  discountTotal: number
  taxableAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  totalTax: number
  roundOff: number
  totalAmount: number
  amountInWords: string
  taxBreakup: { taxRate: number; taxableAmount: number; cgst: number; sgst: number; igst: number }[]
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function computeInvoiceTotals(
  items: CalcLineItem[],
  supplierStateCode?: string | null,
  placeOfSupplyCode?: string | null
): CalcTotals {
  const isInterState =
    !!supplierStateCode && !!placeOfSupplyCode && supplierStateCode !== placeOfSupplyCode

  let subtotal = 0
  let discountTotal = 0
  const byRate = new Map<number, number>()

  for (const item of items) {
    const gross = round2((item.quantity || 0) * (item.rate || 0))
    const discount = round2((gross * (item.discountPercent || 0)) / 100)
    const taxable = round2(gross - discount)

    subtotal += gross
    discountTotal += discount

    const rate = item.taxRate || 0
    byRate.set(rate, round2((byRate.get(rate) ?? 0) + taxable))
  }

  subtotal = round2(subtotal)
  discountTotal = round2(discountTotal)
  const taxableAmount = round2(subtotal - discountTotal)

  let cgstAmount = 0
  let sgstAmount = 0
  let igstAmount = 0
  const taxBreakup: CalcTotals['taxBreakup'] = []

  for (const [taxRate, slabTaxable] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    const tax = round2((slabTaxable * taxRate) / 100)
    if (isInterState) {
      igstAmount += tax
      taxBreakup.push({ taxRate, taxableAmount: slabTaxable, cgst: 0, sgst: 0, igst: tax })
    } else {
      const half = round2(tax / 2)
      const otherHalf = round2(tax - half)
      cgstAmount += half
      sgstAmount += otherHalf
      taxBreakup.push({ taxRate, taxableAmount: slabTaxable, cgst: half, sgst: otherHalf, igst: 0 })
    }
  }

  cgstAmount = round2(cgstAmount)
  sgstAmount = round2(sgstAmount)
  igstAmount = round2(igstAmount)
  const totalTax = round2(cgstAmount + sgstAmount + igstAmount)

  const beforeRounding = round2(taxableAmount + totalTax)
  const totalAmount = Math.round(beforeRounding)
  const roundOff = round2(totalAmount - beforeRounding)

  return {
    isInterState,
    subtotal,
    discountTotal,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTax,
    roundOff,
    totalAmount,
    amountInWords: numberToWords(totalAmount),
    taxBreakup,
  }
}
