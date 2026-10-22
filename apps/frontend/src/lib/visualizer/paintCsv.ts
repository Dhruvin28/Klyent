/** Parses RFC-4180 CSV (quoted fields, "" escapes, CRLF/LF) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export interface PaintRow {
  name: string
  brand: string | null
  code: string | null
  colorHex: string
  rate: number | null
  coverageSqmPerLitre: number | null
  coats: number | null
}

export interface ParsedPaints {
  rows: PaintRow[]
  errors: { line: number; message: string }[]
}

export const PAINT_CSV_TEMPLATE =
  'name,brand,code,hex,rate_per_litre,coverage_sqm_per_litre,coats\r\n' +
  'Warm Linen,Your brand,AB-1234,#E8DCC8,450,10,2\r\n' +
  'Sage Mist,Your brand,AB-5678,#A9B8A0,,,\r\n'

const HEADERS: Record<string, keyof PaintRow | 'hex'> = {
  name: 'name',
  shade: 'name',
  'shade name': 'name',
  colour: 'name',
  color: 'name',
  brand: 'brand',
  manufacturer: 'brand',
  code: 'code',
  'shade code': 'code',
  hex: 'hex',
  'hex code': 'hex',
  colorhex: 'hex',
  rate: 'rate',
  rate_per_litre: 'rate',
  'rate per litre': 'rate',
  price: 'rate',
  coverage: 'coverageSqmPerLitre',
  coverage_sqm_per_litre: 'coverageSqmPerLitre',
  coats: 'coats',
}

function normaliseHex(v: string): string | null {
  const t = v.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t.toLowerCase()}`
  if (/^[0-9a-f]{3}$/i.test(t)) return `#${t.split('').map((c) => c + c).join('').toLowerCase()}`
  // "R,G,B" / "R G B"
  const m = /^(\d{1,3})[\s,;/]+(\d{1,3})[\s,;/]+(\d{1,3})$/.exec(v.trim())
  if (m) {
    const n = m.slice(1).map(Number)
    if (n.every((x) => x <= 255)) return '#' + n.map((x) => x.toString(16).padStart(2, '0')).join('')
  }
  return null
}

const num = (v: string | undefined) => {
  if (v == null || v.trim() === '') return null
  const n = Number(v.replace(/[₹,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

/**
 * Reads a paint shade list (name, brand, code, hex, optional rate / coverage / coats).
 * Header names are matched loosely; the hex column also accepts "R,G,B".
 */
export function parsePaintCsv(text: string, maxRows = 500): ParsedPaints {
  const table = parseCsv(text)
  const errors: ParsedPaints['errors'] = []
  if (!table.length) return { rows: [], errors: [{ line: 1, message: 'The file is empty' }] }
  const header = table[0].map((h) => HEADERS[h.trim().toLowerCase()])
  if (!header.includes('name') || !header.includes('hex')) {
    return { rows: [], errors: [{ line: 1, message: 'Header must include at least "name" and "hex" columns' }] }
  }
  const rows: PaintRow[] = []
  for (let r = 1; r < table.length; r++) {
    const line = r + 1
    const get = (k: string) => {
      const i = header.indexOf(k as never)
      return i >= 0 ? table[r][i] ?? '' : ''
    }
    const name = get('name').trim().slice(0, 255)
    const hex = normaliseHex(get('hex'))
    if (!name) {
      errors.push({ line, message: 'Missing name' })
      continue
    }
    if (!hex) {
      errors.push({ line, message: `"${get('hex')}" is not a hex colour` })
      continue
    }
    const rate = num(get('rate'))
    const coverage = num(get('coverageSqmPerLitre'))
    const coats = num(get('coats'))
    if ([rate, coverage, coats].some((v) => Number.isNaN(v))) {
      errors.push({ line, message: 'Rate, coverage and coats must be numbers' })
      continue
    }
    if (rows.length >= maxRows) {
      errors.push({ line, message: `Only the first ${maxRows} shades are imported` })
      break
    }
    rows.push({
      name,
      brand: get('brand').trim().slice(0, 255) || null,
      code: get('code').trim().slice(0, 255) || null,
      colorHex: hex,
      rate,
      coverageSqmPerLitre: coverage && coverage >= 0.1 ? Math.min(100, coverage) : null,
      coats: coats ? Math.max(1, Math.min(10, Math.round(coats))) : null,
    })
  }
  return { rows, errors }
}

/** A few generic neutrals to start with (not a manufacturer's range). */
export const STARTER_NEUTRALS: PaintRow[] = [
  ['Gallery White', '#f2efe8'],
  ['Soft Ivory', '#ece4d4'],
  ['Warm Linen', '#e3d7c3'],
  ['Sandstone', '#d4c4a8'],
  ['Greige', '#c9c1b4'],
  ['Pebble Grey', '#b8b5ae'],
  ['Sage', '#a7b39c'],
  ['Dusty Blue', '#9fb0bd'],
  ['Terracotta', '#c27b5d'],
  ['Charcoal', '#4b4d50'],
].map(([name, colorHex]) => ({ name, colorHex, brand: null, code: null, rate: null, coverageSqmPerLitre: null, coats: null }))
