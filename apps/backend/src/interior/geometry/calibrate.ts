import { parseDimension, type DrawingUnits } from '../dimensions'
import type { Calibration, CalibrationOverride, PageExtraction, PageInterpretation, Pt } from '../contracts'

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const MIN_PX = 15
const INLIER = 0.02 // 2% from the median ratio

const UNIT_MM: Record<Exclude<DrawingUnits, 'unknown'>, number> = { mm: 1, cm: 10, m: 1000, ft_in: 25.4 }

/** Ratio implied by a printed scale note on a vector PDF (mm per page px), if parseable. */
export function scaleNoteMmPerPx(note: string | null, ex: PageExtraction): number | null {
  if (!note || !ex.pdf) return null
  const m = /1\s*:\s*(\d+(?:\.\d+)?)/.exec(note)
  if (m) {
    const denom = Number(m[1])
    // 1 pt = 25.4/72 mm on paper; × denom real mm; ÷ px per pt.
    return (denom * 25.4) / 72 / ex.pdf.pxPerPt
  }
  const imp = /(\d+)\s*\/\s*(\d+)\s*"\s*=\s*1\s*'\s*-?\s*0?\s*"?/.exec(note) // 1/4" = 1'-0"
  if (imp) {
    const paperIn = Number(imp[1]) / Number(imp[2])
    const ratio = 12 / paperIn
    return (ratio * 25.4) / 72 / ex.pdf.pxPerPt
  }
  return null
}

interface Sample {
  textId: string | null
  text: string
  mm: number
  px: number
  authority: 'cad' | 'text' | 'vision'
  unitless: boolean
}

function collectSamples(ex: PageExtraction, it: PageInterpretation | null, units: DrawingUnits): { samples: Sample[]; unitlessFailures: number } {
  const samples: Sample[] = []
  let unitlessFailures = 0
  const byId = new Map(ex.texts.map((t) => [t.id, t]))
  for (const d of ex.cadDimensions) {
    const px = dist(d.p1, d.p2)
    if (px < MIN_PX) continue
    const mm = d.measuredMm ?? (units !== 'unknown' ? d.measured * UNIT_MM[units] : null)
    if (mm) samples.push({ textId: d.id, text: d.displayText ?? `${Math.round(d.measured * 100) / 100}`, mm, px, authority: 'cad', unitless: d.measuredMm === null })
  }
  const dims = [...(it?.dimensions ?? []), ...(it?.elevation?.heightDimensions ?? [])]
  for (const d of dims) {
    const px = dist(d.p1, d.p2)
    if (px < MIN_PX) continue
    const token = d.textId ? byId.get(d.textId) : undefined
    const text = token?.text ?? d.readText
    const r = parseDimension(text, units)
    if (!r.ok) {
      if (r.reason === 'unitless_unknown_units') unitlessFailures++
      continue
    }
    if (r.kind !== 'length') continue
    samples.push({ textId: token?.id ?? null, text, mm: r.value, px, authority: token && token.source !== 'ocr' ? 'text' : token ? 'text' : 'vision', unitless: r.unitFromContext })
  }
  return { samples, unitlessFailures }
}

/**
 * Infers units for unitless dimension numbers only when the evidence is unambiguous;
 * the result is marked `inferred` and must be confirmed by the designer in strict mode.
 */
function inferUnits(ex: PageExtraction, it: PageInterpretation | null, noteRatio: number | null): DrawingUnits {
  const byId = new Map(ex.texts.map((t) => [t.id, t]))
  const values: { text: string; px: number }[] = []
  for (const d of it?.dimensions ?? []) {
    const t = d.textId ? byId.get(d.textId)?.text : d.readText
    if (t && /^\s*\d[\d,]*(\.\d+)?\s*$/.test(t)) values.push({ text: t.trim(), px: dist(d.p1, d.p2) })
  }
  if (values.length < 2) return 'unknown'
  // With a scale note on a vector PDF, the unit that matches the printed scale wins.
  if (noteRatio) {
    for (const u of ['mm', 'cm', 'm'] as const) {
      const ratios = values.map((v) => (Number(v.text.replace(/,/g, '')) * UNIT_MM[u]) / v.px).sort((a, b) => a - b)
      const med = ratios[Math.floor(ratios.length / 2)]
      if (Math.abs(med / noteRatio - 1) < 0.05) return u
    }
  }
  const nums = values.map((v) => Number(v.text.replace(/,/g, '')))
  const decimals = values.filter((v) => /\.\d{1,3}$/.test(v.text)).length
  if (decimals / values.length > 0.6 && nums.every((n) => n < 60)) return 'm'
  if (nums.filter((n) => Number.isInteger(n) && n >= 300).length / nums.length > 0.7) return 'mm'
  return 'unknown'
}

export function calibratePage(ex: PageExtraction, it: PageInterpretation | null, override: CalibrationOverride | null): Calibration {
  const notes: string[] = []
  const noteRatio = scaleNoteMmPerPx(it?.sheet.scaleNote ?? null, ex)

  // Units resolution: designer > CAD header > sheet notes > model hint > inference.
  let units: DrawingUnits = 'unknown'
  let unitsSource: Calibration['unitsSource'] = 'unknown'
  if (override?.units && override.units !== 'unknown') {
    units = override.units
    unitsSource = 'manual'
  } else if (ex.dxf?.mmPerUnit) {
    units = ex.dxf.mmPerUnit === 1 ? 'mm' : ex.dxf.mmPerUnit === 10 ? 'cm' : ex.dxf.mmPerUnit === 1000 ? 'm' : ex.dxf.mmPerUnit === 25.4 ? 'ft_in' : 'mm'
    unitsSource = 'cad'
  } else if (ex.unitsFromNotes !== 'unknown') {
    units = ex.unitsFromNotes
    unitsSource = 'notes'
  } else if (it?.sheet.unitsHint && it.sheet.unitsHint !== 'unknown') {
    units = it.sheet.unitsHint
    unitsSource = 'ai'
  } else {
    const inferred = inferUnits(ex, it, noteRatio)
    if (inferred !== 'unknown') {
      units = inferred
      unitsSource = 'inferred'
      notes.push(`Unitless dimensions look like ${inferred === 'mm' ? 'millimetres' : inferred === 'm' ? 'metres' : inferred}; confirm the drawing units.`)
    }
  }

  const { samples, unitlessFailures } = collectSamples(ex, it, units)
  if (unitlessFailures) notes.push(`${unitlessFailures} dimension value(s) have no unit and the drawing units are unknown.`)
  const base = (partial: Partial<Calibration>): Calibration => ({
    mmPerPx: null,
    method: 'none',
    status: 'missing',
    units,
    unitsSource,
    samples: [],
    spread: null,
    scaleNoteRatio: noteRatio,
    notes,
    ...partial,
  })

  // 1) Designer's two-point calibration.
  if (override?.manual && override.manual.distanceMm > 0) {
    const px = dist(override.manual.p1, override.manual.p2)
    if (px >= 10) {
      const mmPerPx = override.manual.distanceMm / px
      const scored = samples.map((s) => ({ ...s, ratio: s.mm / s.px, inlier: Math.abs(s.mm / s.px / mmPerPx - 1) <= INLIER }))
      return base({ mmPerPx, method: 'manual', status: 'verified', samples: scored, spread: null })
    }
  }

  // 2) CAD units fix the scale exactly.
  const cadMmPerPx = ex.dxf ? (ex.dxf.mmPerPx ?? (units !== 'unknown' && unitsSource === 'manual' ? UNIT_MM[units] / ex.dxf.pxPerUnit : null)) : null
  if (cadMmPerPx) {
    const scored = samples.map((s) => ({ ...s, ratio: s.mm / s.px, inlier: Math.abs(s.mm / s.px / cadMmPerPx - 1) <= INLIER }))
    const off = scored.filter((s) => s.authority === 'cad' && !s.inlier)
    if (off.length) notes.push(`${off.length} CAD dimension(s) display values that differ from their measured geometry (text overrides).`)
    return base({ mmPerPx: cadMmPerPx, method: 'cad_units', status: 'verified', samples: scored, spread: 0 })
  }

  // 3) Robust fit over dimension samples. Text/CAD evidence outranks vision-only reads.
  const strong = samples.filter((s) => s.authority !== 'vision')
  const pool = strong.length >= 3 ? strong : samples
  if (pool.length) {
    const ratios = pool.map((s) => s.mm / s.px).sort((a, b) => a - b)
    const med = ratios[Math.floor(ratios.length / 2)]
    const inl = pool.filter((s) => Math.abs(s.mm / s.px / med - 1) <= INLIER)
    // Longer dimensions locate their end points with less relative error: weight by px.
    const wsum = inl.reduce((a, s) => a + s.px, 0)
    const mmPerPx = inl.reduce((a, s) => a + (s.mm / s.px) * s.px, 0) / (wsum || 1)
    const scored = samples.map((s) => ({ ...s, ratio: s.mm / s.px, inlier: Math.abs(s.mm / s.px / mmPerPx - 1) <= INLIER }))
    const spread = inl.length ? Math.max(...inl.map((s) => Math.abs(s.mm / s.px / mmPerPx - 1))) : null
    const outliers = scored.filter((s) => !s.inlier).length
    if (outliers) notes.push(`${outliers} dimension(s) disagree with the drawn length (not-to-scale, overridden text or misread); they are excluded from the scale.`)
    if (noteRatio && Math.abs(mmPerPx / noteRatio - 1) > 0.03) notes.push(`The printed scale (${it?.sheet.scaleNote}) disagrees with the dimensions by ${Math.round(Math.abs(mmPerPx / noteRatio - 1) * 100)}%; the sheet may have been resized. Dimensions are used.`)
    const status: Calibration['status'] = inl.length >= 3 && (spread ?? 1) <= 0.01 ? 'verified' : inl.length >= 2 ? 'provisional' : 'provisional'
    if (inl.length < 2) notes.push('Only one usable dimension: the scale cannot be cross-checked.')
    return base({ mmPerPx, method: 'dimensions', status, samples: scored, spread })
  }

  // 4) Printed scale on a vector PDF (provisional: prints can be resized).
  if (noteRatio) {
    notes.push('Scale taken from the printed scale note only; verify with a known dimension.')
    return base({ mmPerPx: noteRatio, method: 'scale_note', status: 'provisional' })
  }
  return base({})
}
