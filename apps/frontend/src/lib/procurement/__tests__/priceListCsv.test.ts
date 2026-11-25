import { describe, it, expect } from 'vitest'
import { parsePriceList, parseAmount, PRICE_LIST_TEMPLATE } from '../priceListCsv'

describe('parseAmount', () => {
  it('strips currency, separators and percent signs', () => {
    expect(parseAmount('₹3,450.50')).toBe(3450.5)
    expect(parseAmount('Rs. 1200')).toBe(1200)
    expect(parseAmount('18%')).toBe(18)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('n/a')).toBeNull()
  })
})

describe('parsePriceList', () => {
  it('reads the template', () => {
    const { rows, errors, needsVendor } = parsePriceList(PRICE_LIST_TEMPLATE)
    expect(errors).toEqual([])
    expect(needsVendor).toBe(false)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      vendorName: 'Sharma Plywood', name: 'BWP Plywood 18mm 8x4', brand: 'Century', sku: 'CP-18',
      unit: 'Sheet', price: 3450, gstRate: 18, hsnCode: '4412', leadTimeDays: 3,
    })
  })

  it('accepts a vendor\'s own headers and quoted prices', () => {
    const csv = 'Item Name,Make,Rate,GST %,UOM\n"Hinge, soft close",Hettich,"₹1,250",18%,Pair\n'
    const { rows, errors, needsVendor } = parsePriceList(csv, 'Hardware World')
    expect(errors).toEqual([])
    expect(needsVendor).toBe(true)
    expect(rows[0]).toMatchObject({ vendorName: 'Hardware World', name: 'Hinge, soft close', brand: 'Hettich', price: 1250, gstRate: 18, unit: 'Pair' })
  })

  it('reports rows it cannot use without dropping the rest', () => {
    const csv = 'vendor,name,price\nA,Tile 600x600,85\nA,,90\nA,Grout,abc\n,Adhesive,400\n'
    const { rows, errors } = parsePriceList(csv)
    expect(rows.map((r) => r.name)).toEqual(['Tile 600x600'])
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5])
  })

  it('needs a name and a price column', () => {
    const { rows, errors } = parsePriceList('vendor,brand\nA,B\n')
    expect(rows).toEqual([])
    expect(errors[0].line).toBe(1)
  })
})
