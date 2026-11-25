import { describe, expect, it } from 'vitest'
import { estimateOption } from '../estimate'
import { parseCsv, parsePaintCsv, PAINT_CSV_TEMPLATE } from '../paintCsv'
import { buildProposalPrefill } from '../proposalPrefill'
import { resizeMask } from '../resample'
import type { VizMaterial } from '../types'

const mat = (m: Partial<VizMaterial>): VizMaterial => ({
  id: 'm', name: 'M', kind: 'texture', category: 'laminate', colorHex: null, sourceAssetId: null, textureAssetId: null,
  textureWidth: null, textureHeight: null, widthMm: null, heightMm: null, brand: null, code: null, notes: null, settings: null,
  createdAt: '', updatedAt: '', ...m,
})

describe('paint CSV import', () => {
  it('parses quoted fields, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']])
  })

  it('reads the template and loosely-named headers', () => {
    const t = parsePaintCsv(PAINT_CSV_TEMPLATE)
    expect(t.errors).toEqual([])
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0]).toMatchObject({ name: 'Warm Linen', colorHex: '#e8dcc8', rate: 450, coverageSqmPerLitre: 10, coats: 2 })
    const r = parsePaintCsv('Shade Name,Manufacturer,Shade Code,Hex Code,Price\nLagoon,Acme,AC 12,"20, 120, 160","₹ 1,250"\nPearl,,,FFF,\n')
    expect(r.errors).toEqual([])
    expect(r.rows[0]).toMatchObject({ name: 'Lagoon', brand: 'Acme', code: 'AC 12', colorHex: '#1478a0', rate: 1250 })
    expect(r.rows[1].colorHex).toBe('#ffffff')
  })

  it('reports bad rows by line and keeps the good ones', () => {
    const r = parsePaintCsv('name,hex,rate\nGood,#112233,\nBad hex,#zz1122,\n,#112233,\nBad rate,#112233,abc\n')
    expect(r.rows.map((x) => x.name)).toEqual(['Good'])
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5])
  })

  it('requires name and hex columns', () => {
    expect(parsePaintCsv('title,colour code\nA,#fff\n').errors[0].message).toMatch(/name/)
  })
})

describe('send to proposal', () => {
  it('builds material lines and priced cost lines from an option estimate', () => {
    const lam = mat({ id: 'lam', name: 'Walnut', brand: 'Acme', code: 'W-1', settings: { estimate: { unit: 'sheet', wastagePct: 10, rate: 2400 } } })
    const paint = mat({ id: 'p', kind: 'paint', category: 'paint', name: 'Linen', colorHex: '#eeeeee' })
    const est = estimateOption(
      [
        { surfaceId: 'a', surfaceName: 'Wardrobe', materialId: 'lam', areaSqm: 5 },
        { surfaceId: 'b', surfaceName: 'Wall', materialId: 'p', areaSqm: 12 },
      ],
      new Map([['lam', lam], ['p', paint]])
    )
    const pre = buildProposalPrefill('Sharma 3BHK', 'Option B', 'c1', est)
    expect(pre.source).toEqual({ projectName: 'Sharma 3BHK', optionName: 'Option B', clientId: 'c1' })
    expect(pre.materialSection.title).toBe('Materials — Option B')
    expect(pre.materialSection.items).toHaveLength(2)
    expect(pre.materialSection.items[0].description).toContain('Wardrobe — Walnut (Acme W-1)')
    expect(pre.materialSection.items[0].description).toContain('2 sheets') // 5 m² × 1.1 / 2.977 → 1.85 → 2
    expect(pre.materialSection.items[0].rate).toBe('₹2,400 / sheet')
    // only priced materials become cost lines
    expect(pre.costBreakupItems).toEqual([expect.objectContaining({ item: 'Walnut', amount: 4800 })])
  })
})

describe('replace render', () => {
  it('resizes selections to the new resolution without shifting them', () => {
    const w = 40, h = 20
    const m = new Uint8Array(w * h)
    for (let y = 5; y < 15; y++) for (let x = 10; x < 30; x++) m[y * w + x] = 255
    const up = resizeMask(m, w, h, 80, 40)
    expect(up[20 * 80 + 40]).toBe(255)
    expect(up[20 * 80 + 10]).toBe(0)
    let sum = 0
    for (const v of up) sum += v / 255
    expect(sum / 4).toBeCloseTo(200, -1) // area scales with resolution
    const down = resizeMask(up, 80, 40, w, h)
    expect(down[10 * w + 20]).toBe(255)
    expect(down[2 * w + 2]).toBe(0)
  })
})
