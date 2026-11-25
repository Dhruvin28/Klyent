// GST totals for an invoice.
//
// The client computes the same numbers for its live preview, but these are the
// ones that get stored — the request body's totals are never trusted.
// Kept in sync with apps/frontend/src/lib/invoiceTotals.ts.

export interface InvoiceLineItem {
  id: string
  description: string
  hsnSac?: string | null
  quantity: number
  unit?: string | null
  rate: number
  discountPercent?: number
  taxRate?: number
}

export interface InvoiceTotals {
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
  // Per-rate rollup for the tax summary table on the PDF.
  taxBreakup: { taxRate: number; taxableAmount: number; cgst: number; sgst: number; igst: number }[]
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function convertHundreds(n: number): string {
  if (n === 0) return ''
  if (n < 20) return ones[n]
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
  return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertHundreds(n % 100) : '')
}

export function amountToWords(amount: number): string {
  const n = Math.floor(Math.abs(amount))
  if (n === 0) return 'Rupees Zero Only'

  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const rest = n % 1000

  const parts: string[] = []
  if (crore) parts.push(convertHundreds(crore) + ' Crore')
  if (lakh) parts.push(convertHundreds(lakh) + ' Lakh')
  if (thousand) parts.push(convertHundreds(thousand) + ' Thousand')
  if (rest) parts.push(convertHundreds(rest))

  return 'Rupees ' + parts.join(' ') + ' Only'
}

export function computeInvoiceTotals(
  items: InvoiceLineItem[],
  supplierStateCode?: string | null,
  placeOfSupplyCode?: string | null
): InvoiceTotals {
  // Intra-state supply is CGST + SGST; anything else is IGST. When either code
  // is missing we cannot prove the supply is inter-state, so we treat it as
  // intra-state — the conservative default for a domestic invoice.
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
  const taxBreakup: InvoiceTotals['taxBreakup'] = []

  // Tax is summed per rate slab, not per line, so the totals match the tax
  // summary table a GST return expects.
  for (const [taxRate, slabTaxable] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    const tax = round2((slabTaxable * taxRate) / 100)
    if (isInterState) {
      igstAmount += tax
      taxBreakup.push({ taxRate, taxableAmount: slabTaxable, cgst: 0, sgst: 0, igst: tax })
    } else {
      const half = round2(tax / 2)
      // The halves must add back to the slab tax exactly, so the second half
      // absorbs any rounding remainder.
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
    amountInWords: amountToWords(totalAmount),
    taxBreakup,
  }
}
