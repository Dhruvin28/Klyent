import type { PageInterpretation, PageRole, Pt, Registration, RegistrationOverride } from '../contracts'

// Registration of plan-view sheets (RCP, electrical, furniture) onto the reference
// floor plan (plan §8.2). Each sheet is already in mm by its own calibration; this
// estimates the translation between them from shared anchors and reports residuals
// measured on anchors that were not used for the fit. Rotation/mirroring is never
// assumed: sheets are expected to share orientation and a large residual flags it.

export const normLabel = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .replace(/^(THE)/, '')

const centroid = (pts: Pt[]) => {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const f = p.x * q.y - q.x * p.y
    a += f
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  if (Math.abs(a) < 1e-9) {
    const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
    return { x: s.x / pts.length, y: s.y / pts.length }
  }
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

function wallExtents(it: PageInterpretation, s: number) {
  const pts = it.walls.flatMap((w) => [w.a, w.b])
  if (pts.length < 4) return null
  const xs = pts.map((p) => p.x * s)
  const ys = pts.map((p) => p.y * s)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

export function registerPage(
  ref: { it: PageInterpretation; mmPerPx: number },
  page: { pageId: string; role: PageRole; it: PageInterpretation; mmPerPx: number },
  override: RegistrationOverride | null
): Registration {
  if (override) {
    return { pageId: page.pageId, role: page.role, offsetMm: { x: override.dxMm, y: override.dyMm }, method: 'manual', anchors: 0, residualMm: null, status: 'verified' }
  }
  // Anchors: rooms with the same label on both sheets.
  const refRooms = new Map<string, Pt>()
  for (const r of ref.it.rooms) {
    if (r.polygon.length < 3 || !r.label) continue
    const k = normLabel(r.label)
    if (k && !refRooms.has(k)) refRooms.set(k, centroid(r.polygon.map((p) => ({ x: p.x * ref.mmPerPx, y: p.y * ref.mmPerPx }))))
  }
  const deltas: Pt[] = []
  const seen = new Set<string>()
  for (const r of page.it.rooms) {
    if (r.polygon.length < 3 || !r.label) continue
    const k = normLabel(r.label)
    const target = refRooms.get(k)
    if (!target || seen.has(k)) continue
    seen.add(k)
    const c = centroid(r.polygon.map((p) => ({ x: p.x * page.mmPerPx, y: p.y * page.mmPerPx })))
    deltas.push({ x: target.x - c.x, y: target.y - c.y })
  }
  if (deltas.length >= 1) {
    // Median translation; residual = worst leave-one-out disagreement.
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
    const off = { x: med(deltas.map((d) => d.x)), y: med(deltas.map((d) => d.y)) }
    let residual: number | null = null
    if (deltas.length >= 2) {
      residual = 0
      for (let i = 0; i < deltas.length; i++) {
        const rest = deltas.filter((_, j) => j !== i)
        const o = { x: med(rest.map((d) => d.x)), y: med(rest.map((d) => d.y)) }
        residual = Math.max(residual, Math.hypot(deltas[i].x - o.x, deltas[i].y - o.y))
      }
    }
    // Room-label centroids drift with how each sheet outlines a room; confirm with walls.
    const re = wallExtents(ref.it, ref.mmPerPx)
    const pe = wallExtents(page.it, page.mmPerPx)
    if (re && pe) {
      const wallOff = { x: re.minX - pe.minX, y: re.minY - pe.minY }
      const sizeDiff = Math.max(Math.abs(re.maxX - re.minX - (pe.maxX - pe.minX)), Math.abs(re.maxY - re.minY - (pe.maxY - pe.minY)))
      const agree = Math.hypot(wallOff.x - off.x, wallOff.y - off.y)
      // When both sheets show the same shell, wall extents are the sharper anchor.
      if (sizeDiff < 50 && agree < 400) {
        return { pageId: page.pageId, role: page.role, offsetMm: wallOff, method: 'extents', anchors: deltas.length + 2, residualMm: Math.max(sizeDiff, residual ?? 0), status: sizeDiff <= 25 ? 'verified' : 'unverified' }
      }
    }
    return {
      pageId: page.pageId,
      role: page.role,
      offsetMm: off,
      method: 'room_labels',
      anchors: deltas.length,
      residualMm: residual,
      status: residual !== null && residual <= 50 ? 'verified' : 'unverified',
    }
  }
  const re = wallExtents(ref.it, ref.mmPerPx)
  const pe = wallExtents(page.it, page.mmPerPx)
  if (re && pe) {
    const sizeDiff = Math.max(Math.abs(re.maxX - re.minX - (pe.maxX - pe.minX)), Math.abs(re.maxY - re.minY - (pe.maxY - pe.minY)))
    return {
      pageId: page.pageId,
      role: page.role,
      offsetMm: { x: re.minX - pe.minX, y: re.minY - pe.minY },
      method: 'extents',
      anchors: 2,
      residualMm: sizeDiff,
      status: sizeDiff <= 25 ? 'verified' : 'unverified',
    }
  }
  return { pageId: page.pageId, role: page.role, offsetMm: { x: 0, y: 0 }, method: 'none', anchors: 0, residualMm: null, status: 'failed' }
}
