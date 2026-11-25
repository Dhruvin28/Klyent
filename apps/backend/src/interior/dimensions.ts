// Dimension text parser (plan §7.4). Pure and deterministic: the AI may point at a
// text token, but the numeric value always comes from here, from the token's own text.

export type DrawingUnits = 'mm' | 'cm' | 'm' | 'ft_in' | 'unknown'

export type ParsedKind = 'length' | 'level' | 'radius' | 'diameter' | 'angle' | 'size' | 'scale'

export interface ParsedDimension {
  ok: true
  kind: ParsedKind
  /** Primary value in millimetres (angle: degrees; scale: ratio denominator). */
  value: number
  /** For "1800 x 600 x 2100" style sizes, every component in mm. */
  values?: number[]
  unit: 'mm' | 'cm' | 'm' | 'ft_in' | 'in' | 'ft' | 'deg' | 'ratio'
  /** The unit came from the drawing context, not from the text itself. */
  unitFromContext: boolean
  original: string
  normalized: string
  /** OCR-style substitutions (O→0, l→1) were needed. Lower authority. */
  corrected: boolean
}

export interface ParseFailure {
  ok: false
  original: string
  reason: 'empty' | 'not_numeric' | 'ambiguous' | 'unitless_unknown_units' | 'out_of_range'
}

export type ParseResult = ParsedDimension | ParseFailure

const INCH = 25.4
const FOOT = 304.8

function fail(original: string, reason: ParseFailure['reason']): ParseFailure {
  return { ok: false, original, reason }
}

/** Unicode fractions and primes to ASCII. */
function normalize(s: string): string {
  return s
    .replace(/[′’´`]/g, "'")
    .replace(/[″”“]/g, '"')
    .replace(/''/g, '"')
    .replace(/½/g, ' 1/2')
    .replace(/¼/g, ' 1/4')
    .replace(/¾/g, ' 3/4')
    .replace(/⅛/g, ' 1/8')
    .replace(/[–—−]/g, '-')
    .replace(/×/g, 'x')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fixes common OCR confusions, but only inside otherwise-numeric runs. */
function ocrRepair(s: string): { text: string; corrected: boolean } {
  let corrected = false
  const text = s.replace(/(?<=[\d.,'"-]|^)[OoIl|](?=[\d.,'" -]|$)|(?<=\d)[OoIl|]/g, (ch) => {
    corrected = true
    return ch === 'O' || ch === 'o' ? '0' : '1'
  })
  return { text, corrected }
}

function fraction(s: string | undefined): number {
  if (!s) return 0
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s.trim())
  if (!m) return NaN
  const d = Number(m[2])
  return d ? Number(m[1]) / d : NaN
}

/** Inches part like `6`, `6 1/2`, `6-1/2`, `1/2`, `6.5`. */
function inchesValue(s: string | undefined): number {
  if (!s || !s.trim()) return 0
  const t = s.trim()
  let m = /^(\d+(?:\.\d+)?)$/.exec(t)
  if (m) return Number(m[1])
  m = /^(\d+)[\s-]+(\d+\s*\/\s*\d+)$/.exec(t)
  if (m) return Number(m[1]) + fraction(m[2])
  m = /^(\d+\s*\/\s*\d+)$/.exec(t)
  if (m) return fraction(m[1])
  return NaN
}

/** Feet-inch forms: 9'-6", 9' 6", 9'6", 9'-6 1/2", 9'-0", 10', 9.5', 9 ft 6 in. */
function parseImperial(t: string): { mm: number; unit: 'ft_in' | 'in' | 'ft' } | null {
  let s = t.replace(/\bft\b\.?/gi, "'").replace(/\b(in|inch|inches)\b\.?/gi, '"').replace(/\s+'/g, "'").replace(/\s+"/g, '"')
  s = s.trim()
  // feet + optional inches
  let m = /^(\d+(?:\.\d+)?)'\s*-?\s*(?:([\d\s/.\-]+)"?)?$/.exec(s)
  if (m) {
    const ft = Number(m[1])
    const inch = inchesValue(m[2]?.replace(/"$/, ''))
    if (!Number.isFinite(ft) || !Number.isFinite(inch) || inch >= 12) return null
    return { mm: ft * FOOT + inch * INCH, unit: m[2] ? 'ft_in' : 'ft' }
  }
  // inches only
  m = /^([\d\s/.\-]+)"$/.exec(s)
  if (m) {
    const inch = inchesValue(m[1])
    if (!Number.isFinite(inch)) return null
    return { mm: inch * INCH, unit: 'in' }
  }
  return null
}

function metricWithUnit(t: string): { mm: number; unit: 'mm' | 'cm' | 'm' } | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*(mm|cm|m|mtr|mtrs|meter|meters|metre|metres)\.?$/i.exec(t)
  if (!m) return null
  const v = Number(m[1].replace(',', '.'))
  const u = m[2].toLowerCase()
  if (u === 'mm') return { mm: v, unit: 'mm' }
  if (u === 'cm') return { mm: v * 10, unit: 'cm' }
  return { mm: v * 1000, unit: 'm' }
}

function unitless(t: string, units: DrawingUnits): { mm: number; unit: 'mm' | 'cm' | 'm' } | 'unknown' | null {
  // Thousands separators like 3,600 are only accepted with a 3-digit group.
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(t)
  if (!m) return null
  const v = Number(m[1].replace(/,/g, '') + (m[2] ? `.${m[2]}` : ''))
  if (units === 'unknown' || units === 'ft_in') return 'unknown'
  if (units === 'mm') return { mm: v, unit: 'mm' }
  if (units === 'cm') return { mm: v * 10, unit: 'cm' }
  return { mm: v * 1000, unit: 'm' }
}

/** Parses one length-like token (no prefixes). */
function parseLength(t: string, units: DrawingUnits): { mm: number; unit: ParsedDimension['unit']; fromContext: boolean } | 'unknown' | null {
  const imp = parseImperial(t)
  if (imp) return { mm: imp.mm, unit: imp.unit, fromContext: false }
  const met = metricWithUnit(t)
  if (met) return { mm: met.mm, unit: met.unit, fromContext: false }
  const u = unitless(t, units)
  if (u === 'unknown') return 'unknown'
  if (u) return { mm: u.mm, unit: u.unit, fromContext: true }
  return null
}

const MAX_MM = 200_000 // 200 m: anything larger is not an interior dimension

export function parseDimension(raw: string, units: DrawingUnits = 'unknown'): ParseResult {
  const original = raw
  if (!raw || !raw.trim()) return fail(original, 'empty')
  let s = normalize(raw)
  let corrected = false
  if (/[OoIl|]/.test(s) && /\d/.test(s)) {
    const r = ocrRepair(s)
    s = r.text
    corrected = r.corrected
  }
  // Drop leading/trailing annotation noise like "(", ")", "TYP", "CLR".
  s = s.replace(/^[([{]+|[)\]}]+$/g, '').replace(/\s*\b(TYP|TYP\.|CLR|CLEAR|APPROX|APPROX\.|NOM)\b\.?/gi, '').trim()
  if (!s) return fail(original, 'empty')

  const base = { ok: true as const, original, corrected }

  // Scale notation 1:50, 1/4" = 1'-0"
  let m = /^(?:scale\s*[:=-]?\s*)?1\s*:\s*(\d+(?:\.\d+)?)$/i.exec(s)
  if (m) return { ...base, kind: 'scale', value: Number(m[1]), unit: 'ratio', unitFromContext: false, normalized: `1:${m[1]}` }

  // Angle
  m = /^(\d+(?:\.\d+)?)\s*(?:°|deg|degrees)$/i.exec(s)
  if (m) return { ...base, kind: 'angle', value: Number(m[1]), unit: 'deg', unitFromContext: false, normalized: `${m[1]}°` }

  // Radius / diameter prefixes
  m = /^(R|RAD\.?|Ø|⌀|DIA\.?|D)\s*=?\s*(.+)$/i.exec(s)
  if (m && /\d/.test(m[2])) {
    const kind: ParsedKind = /^R/i.test(m[1]) ? 'radius' : 'diameter'
    const l = parseLength(m[2].trim(), units)
    if (l === 'unknown') return fail(original, 'unitless_unknown_units')
    if (!l) return fail(original, 'not_numeric')
    return { ...base, kind, value: l.mm, unit: l.unit, unitFromContext: l.fromContext, normalized: `${kind === 'radius' ? 'R' : 'Ø'}${round(l.mm)}mm` }
  }

  // Levels: +2700, FCL 2700, LVL +2.700, +9'-0", 2700 AFFL
  m = /^(?:(?:FFL|FCL|SFL|LVL|LEVEL|EL\.?|ELEV\.?|CH|C\.H\.|CLG\.?\s*HT\.?|HT\.?)\s*[:=]?\s*)?([+-])?\s*([^A-Za-z]*?)\s*(?:AFFL|AFL|FFL|ABOVE FFL)?$/i.exec(s)
  const isLevel = /^(FFL|FCL|SFL|LVL|LEVEL|EL\.?|ELEV|CH\b|C\.H\.|CLG|HT\.?)/i.test(s) || /^[+]/.test(s) || /\b(AFFL|AFL)\b/i.test(s)
  if (isLevel && m && m[2] && /\d/.test(m[2])) {
    const sign = m[1] === '-' ? -1 : 1
    let inner = m[2].trim()
    // "+2.700" in a mm drawing is a level in metres (architectural convention).
    let l: ReturnType<typeof parseLength>
    if (/^\d+\.\d{3}$/.test(inner) && units !== 'ft_in') l = { mm: Number(inner) * 1000, unit: 'm', fromContext: false }
    else l = parseLength(inner, units)
    if (l === 'unknown') return fail(original, 'unitless_unknown_units')
    if (!l) return fail(original, 'not_numeric')
    const v = sign * l.mm
    if (Math.abs(v) > MAX_MM) return fail(original, 'out_of_range')
    inner = `${v >= 0 ? '+' : ''}${round(v)}mm`
    return { ...base, kind: 'level', value: v, unit: l.unit, unitFromContext: l.fromContext, normalized: inner }
  }

  // Sizes: 1800x600, 1800 X 600 X 2100, 6'-0" x 2'-0"
  if (/\s*[xX*]\s*/.test(s) && s.split(/\s*[xX*]\s*/).length >= 2) {
    const parts = s.split(/\s*[xX*]\s*/).filter(Boolean)
    if (parts.length >= 2 && parts.length <= 3) {
      const vals: number[] = []
      let unit: ParsedDimension['unit'] = 'mm'
      let fromCtx = false
      // A trailing unit on the last part ("180x60 cm") applies to all parts.
      const tail = /(mm|cm|m)\.?$/i.exec(parts[parts.length - 1])?.[1]
      for (const p of parts) {
        const withUnit = tail && !/(mm|cm|m)\.?$/i.test(p) ? `${p}${tail}` : p
        const l = parseLength(withUnit.trim(), units)
        if (l === 'unknown') return fail(original, 'unitless_unknown_units')
        if (!l) return fail(original, 'not_numeric')
        vals.push(l.mm)
        unit = l.unit
        fromCtx = fromCtx || l.fromContext
      }
      if (vals.some((v) => v <= 0 || v > MAX_MM)) return fail(original, 'out_of_range')
      return { ...base, kind: 'size', value: vals[0], values: vals, unit, unitFromContext: fromCtx, normalized: vals.map(round).join(' x ') + ' mm' }
    }
    return fail(original, 'ambiguous')
  }

  const l = parseLength(s, units)
  if (l === 'unknown') return fail(original, 'unitless_unknown_units')
  if (!l) return fail(original, /\d/.test(s) ? 'ambiguous' : 'not_numeric')
  if (l.mm <= 0 || l.mm > MAX_MM) return fail(original, 'out_of_range')
  return { ...base, kind: 'length', value: l.mm, unit: l.unit, unitFromContext: l.fromContext, normalized: `${round(l.mm)} mm` }
}

function round(v: number) {
  return Math.round(v * 10) / 10
}

/** Units declared by sheet notes such as "ALL DIMENSIONS ARE IN MM". */
export function unitsFromNotes(texts: string[]): DrawingUnits {
  const joined = texts.join(' ').toUpperCase()
  if (/(ALL\s+)?DIMENSIONS?\s+(ARE\s+)?IN\s+(MM|MILLIMET)/.test(joined)) return 'mm'
  if (/(ALL\s+)?DIMENSIONS?\s+(ARE\s+)?IN\s+(CM|CENTIMET)/.test(joined)) return 'cm'
  if (/(ALL\s+)?DIMENSIONS?\s+(ARE\s+)?IN\s+(M|METRES?|METERS?)\b/.test(joined)) return 'm'
  if (/(ALL\s+)?DIMENSIONS?\s+(ARE\s+)?IN\s+(FEET|FT|INCHES)/.test(joined)) return 'ft_in'
  return 'unknown'
}
