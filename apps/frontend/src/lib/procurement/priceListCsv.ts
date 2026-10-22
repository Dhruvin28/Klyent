import { parseCsv } from '@/lib/visualizer/paintCsv'
import type { ProductImportRow } from '@/api/procurement'

export interface ParsedPriceList {
  rows: ProductImportRow[]
  errors: { line: number; message: string }[]
  // True when the file has no vendor column, so a vendor must be chosen for it.
  needsVendor: boolean
}

export const PRICE_LIST_TEMPLATE =
  'vendor,name,brand,sku,category,unit,price,gst,hsn,lead_time_days\r\n' +
  'Sharma Plywood,BWP Plywood 18mm 8x4,Century,CP-18,Plywood & Boards,Sheet,3450,18,4412,3\r\n' +
  'Sharma Plywood,Laminate 1mm Suede,Merino,ML-1021,Laminates & Veneers,Sheet,1650,18,4823,5\r\n'

type Field = keyof ProductImportRow

// Price lists come from many vendors' own spreadsheets, so headers vary.
const HEADERS: Record<string, Field> = {
  vendor: 'vendorName',
  'vendor name': 'vendorName',
  supplier: 'vendorName',
  dealer: 'vendorName',
  name: 'name',
  product: 'name',
  'product name': 'name',
  item: 'name',
  'item name': 'name',
  description: 'name',
  brand: 'brand',
  make: 'brand',
  sku: 'sku',
  code: 'sku',
  'item code': 'sku',
  'product code': 'sku',
  category: 'category',
  unit: 'unit',
  uom: 'unit',
  price: 'price',
  rate: 'price',
  'net rate': 'price',
  'dealer price': 'price',
  cost: 'price',
  gst: 'gstRate',
  'gst %': 'gstRate',
  'gst rate': 'gstRate',
  tax: 'gstRate',
  'tax %': 'gstRate',
  hsn: 'hsnCode',
  'hsn code': 'hsnCode',
  'hsn/sac': 'hsnCode',
  lead_time_days: 'leadTimeDays',
  'lead time': 'leadTimeDays',
  'lead time days': 'leadTimeDays',
  'delivery days': 'leadTimeDays',
}

// "₹3,450.00", "Rs. 3450", "18%" → numbers.
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/₹|rs\.?|inr|%|,|\s/gi, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

const normalise = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, ' ').replace(/\s*\(.*\)$/, '')

export function parsePriceList(text: string, defaultVendorName?: string | null): ParsedPriceList {
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: 'The file is empty.' }], needsVendor: false }

  const columns = table[0].map((h) => HEADERS[normalise(h)] ?? HEADERS[h.trim().toLowerCase()] ?? null)
  const has = (f: Field) => columns.includes(f)
  if (!has('name') || !has('price')) {
    return {
      rows: [],
      errors: [{ line: 1, message: 'The first row must have headers, including a product name and a price column.' }],
      needsVendor: false,
    }
  }
  const needsVendor = !has('vendorName')

  const rows: ProductImportRow[] = []
  const errors: ParsedPriceList['errors'] = []

  table.slice(1).forEach((cells, i) => {
    const line = i + 2
    const get = (f: Field) => {
      const idx = columns.indexOf(f)
      return idx >= 0 ? (cells[idx] ?? '').trim() : ''
    }

    const name = get('name')
    if (!name) return errors.push({ line, message: 'Missing product name.' })
    const price = parseAmount(get('price'))
    if (price === null || price < 0) return errors.push({ line, message: `"${name}": price is missing or not a number.` })
    const vendorName = get('vendorName') || defaultVendorName || ''
    if (!vendorName && !needsVendor) return errors.push({ line, message: `"${name}": vendor is missing.` })

    const gst = get('gstRate') ? parseAmount(get('gstRate')) : null
    const lead = get('leadTimeDays') ? parseAmount(get('leadTimeDays')) : null
    rows.push({
      vendorName,
      name,
      brand: get('brand') || null,
      sku: get('sku') || null,
      category: get('category') || null,
      unit: get('unit') || null,
      price,
      gstRate: gst !== null && gst >= 0 && gst <= 100 ? gst : null,
      hsnCode: get('hsnCode') || null,
      leadTimeDays: lead !== null && lead >= 0 ? Math.round(lead) : null,
    })
  })

  return { rows, errors, needsVendor }
}
