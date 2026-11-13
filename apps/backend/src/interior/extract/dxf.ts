import { config } from '../../config'
import type { CadDimension, PageExtraction, TextToken } from '../contracts'
import { unitsFromNotes } from '../dimensions'
import { ExtractionError, SegmentSink, loadMupdf, numberTokens, renderPage, type ExtractedPage } from './common'

// ASCII DXF reader (plan §7.1). Native geometry is exact: walls are later snapped to
// these lines, CAD DIMENSION entities give measured values directly, and $INSUNITS
// fixes the scale. Analytic arcs/circles are tessellated only for this preview with a
// bounded chord error; the raw values stay in the DXF.

interface Pair {
  code: number
  value: string
}

type M = [number, number, number, number, number, number] // a b c d e f : x' = a x + c y + e

const IDENT: M = [1, 0, 0, 1, 0, 0]
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
]
const ap = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
const det = (m: M) => m[0] * m[3] - m[1] * m[2]

// $INSUNITS → millimetres per drawing unit.
const INSUNITS_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 14: 100 }

interface Entity {
  type: string
  pairs: Pair[]
  children?: Entity[] // POLYLINE vertices
}

function readPairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/)
  const out: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10)
    if (!Number.isFinite(code)) throw new ExtractionError('CORRUPT_INPUT', `Malformed DXF near line ${i + 1}.`)
    out.push({ code, value: lines[i + 1].replace(/\s+$/, '') })
  }
  return out
}

const num = (e: Entity, code: number, d = 0) => {
  const p = e.pairs.find((x) => x.code === code)
  const v = p ? Number(p.value) : NaN
  return Number.isFinite(v) ? v : d
}
const str = (e: Entity, code: number) => e.pairs.find((x) => x.code === code)?.value.trim() ?? null

/** Splits a section's pairs into entities at every code-0 marker; folds POLYLINE vertices. */
function toEntities(pairs: Pair[]): Entity[] {
  const raw: Entity[] = []
  for (const p of pairs) {
    if (p.code === 0) raw.push({ type: p.value.trim(), pairs: [] })
    else raw[raw.length - 1]?.pairs.push(p)
  }
  const out: Entity[] = []
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i]
    if (e.type === 'POLYLINE') {
      e.children = []
      while (i + 1 < raw.length && raw[i + 1].type === 'VERTEX') e.children.push(raw[++i])
      if (raw[i + 1]?.type === 'SEQEND') i++
    }
    out.push(e)
  }
  return out
}

function cleanMText(s: string) {
  return s
    .replace(/\\P/g, ' ')
    .replace(/\\[ACFHQTWfch][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*?)[#^/]([^;]*?);/g, '$1/$2')
    .replace(/[{}]/g, '')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[pP]/g, '±')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Parsed {
  segs: number[] // x1 y1 x2 y2 layer
  texts: { text: string; x: number; y: number; h: number; rot: number; w: number; anchorX: number; anchorY: number }[]
  dims: { measured: number; text: string | null; p1: [number, number]; p2: [number, number]; layer: string }[]
  layers: string[]
  unsupported: Record<string, number>
  insUnits: number
  warnings: string[]
}

export function parseDxf(text: string): Parsed {
  if (text.startsWith('AutoCAD Binary DXF')) throw new ExtractionError('UNSUPPORTED_FORMAT', 'Binary DXF is not supported. Save as ASCII DXF.')
  const pairs = readPairs(text)
  const sections = new Map<string, Pair[]>()
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 0 && pairs[i].value.trim() === 'SECTION' && pairs[i + 1]?.code === 2) {
      const name = pairs[i + 1].value.trim()
      const body: Pair[] = []
      let j = i + 2
      while (j < pairs.length && !(pairs[j].code === 0 && pairs[j].value.trim() === 'ENDSEC')) body.push(pairs[j++])
      sections.set(name, body)
      i = j
    }
  }
  const ents = sections.get('ENTITIES')
  if (!ents) throw new ExtractionError('CORRUPT_INPUT', 'The DXF has no ENTITIES section.')

  // Header units.
  let insUnits = 0
  const header = sections.get('HEADER') ?? []
  for (let i = 0; i < header.length; i++) {
    if (header[i].code === 9 && header[i].value.trim() === '$INSUNITS') insUnits = parseInt(header[i + 1]?.value ?? '0', 10) || 0
  }

  // Layer visibility.
  const hidden = new Set<string>()
  const layerNames = new Set<string>()
  for (const e of toEntities(sections.get('TABLES') ?? [])) {
    if (e.type !== 'LAYER') continue
    const name = str(e, 2)
    if (!name) continue
    layerNames.add(name)
    if ((num(e, 70) & 1) === 1 || num(e, 62, 7) < 0) hidden.add(name)
  }

  // Blocks.
  const blocks = new Map<string, { base: [number, number]; ents: Entity[]; xref: boolean }>()
  const bl = toEntities(sections.get('BLOCKS') ?? [])
  for (let i = 0; i < bl.length; i++) {
    if (bl[i].type !== 'BLOCK') continue
    const b = bl[i]
    const name = str(b, 2) ?? ''
    const list: Entity[] = []
    while (i + 1 < bl.length && bl[i + 1].type !== 'ENDBLK') list.push(bl[++i])
    blocks.set(name, { base: [num(b, 10), num(b, 20)], ents: list, xref: (num(b, 70) & 4) === 4 })
  }

  const out: Parsed = { segs: [], texts: [], dims: [], layers: [], unsupported: {}, insUnits, warnings: [] }
  const layerIdx = new Map<string, number>()
  const li = (name: string) => {
    let i = layerIdx.get(name)
    if (i === undefined) {
      i = out.layers.length
      layerIdx.set(name, i)
      out.layers.push(name)
    }
    return i
  }
  const MAX = config.interior.maxVectorSegments
  const seg = (m: M, ocs: number, x1: number, y1: number, x2: number, y2: number, layer: string) => {
    if (out.segs.length / 5 >= MAX) return
    const a = ap(m, ocs * x1, y1)
    const b = ap(m, ocs * x2, y2)
    out.segs.push(a[0], a[1], b[0], b[1], li(layer))
  }
  const poly = (m: M, ocs: number, pts: [number, number][], layer: string) => {
    for (let k = 0; k + 1 < pts.length; k++) seg(m, ocs, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], layer)
  }
  const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number): [number, number][] => {
    let sweep = a1 - a0
    while (sweep <= 0) sweep += Math.PI * 2
    // Chord error ≤ 0.1% of radius, 4°..10° steps.
    const n = Math.max(2, Math.ceil(sweep / Math.min((10 * Math.PI) / 180, Math.max((4 * Math.PI) / 180, 2 * Math.acos(1 - 0.001)))))
    return Array.from({ length: n + 1 }, (_, k) => {
      const t = a0 + (sweep * k) / n
      return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as [number, number]
    })
  }
  const bulgePts = (a: [number, number], b: [number, number], bulge: number): [number, number][] => {
    if (Math.abs(bulge) < 1e-9) return [a, b]
    const theta = 4 * Math.atan(bulge)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const chord = Math.hypot(dx, dy)
    if (chord < 1e-9) return [a, b]
    const r = chord / (2 * Math.sin(theta / 2))
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const h = r * Math.cos(theta / 2)
    // Centre lies to the left of a→b for positive bulge (CCW arc).
    const cx = mx - (h * dy) / chord
    const cy = my + (h * dx) / chord
    const a0 = Math.atan2(a[1] - cy, a[0] - cx)
    const steps = Math.max(2, Math.ceil(Math.abs(theta) / ((8 * Math.PI) / 180)))
    return Array.from({ length: steps + 1 }, (_, k) => {
      const t = a0 + (theta * k) / steps
      return [cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)] as [number, number]
    })
  }
  const count = (k: string) => (out.unsupported[k] = (out.unsupported[k] ?? 0) + 1)

  const emit = (e: Entity, m: M, depth: number, inheritedLayer: string) => {
    if (num(e, 67) === 1) return // paper space
    let layer = str(e, 8) ?? inheritedLayer
    if (layer === '0') layer = inheritedLayer // BYBLOCK-ish: block contents on layer 0 take the insert's layer
    if (hidden.has(layer)) return
    const ocs = num(e, 230, 1) < 0 ? -1 : 1
    switch (e.type) {
      case 'LINE':
        seg(m, 1, num(e, 10), num(e, 20), num(e, 11), num(e, 21), layer)
        break
      case 'LWPOLYLINE': {
        const verts: { p: [number, number]; bulge: number }[] = []
        for (const p of e.pairs) {
          if (p.code === 10) verts.push({ p: [Number(p.value), 0], bulge: 0 })
          else if (p.code === 20 && verts.length) verts[verts.length - 1].p[1] = Number(p.value)
          else if (p.code === 42 && verts.length) verts[verts.length - 1].bulge = Number(p.value)
        }
        const closed = (num(e, 70) & 1) === 1
        const n = verts.length
        for (let k = 0; k < (closed ? n : n - 1); k++) poly(m, ocs, bulgePts(verts[k].p, verts[(k + 1) % n].p, verts[k].bulge), layer)
        break
      }
      case 'POLYLINE': {
        const flags = num(e, 70)
        if (flags & (16 | 64)) {
          count('POLYFACE/MESH')
          break
        }
        const verts = (e.children ?? []).map((v) => ({ p: [num(v, 10), num(v, 20)] as [number, number], bulge: num(v, 42) }))
        const closed = (flags & 1) === 1
        const n = verts.length
        for (let k = 0; k < (closed ? n : n - 1); k++) poly(m, ocs, bulgePts(verts[k].p, verts[(k + 1) % n].p, verts[k].bulge), layer)
        break
      }
      case 'ARC': {
        const d2r = Math.PI / 180
        poly(m, ocs, arcPts(num(e, 10), num(e, 20), num(e, 40), num(e, 50) * d2r, num(e, 51) * d2r), layer)
        break
      }
      case 'CIRCLE':
        poly(m, ocs, arcPts(num(e, 10), num(e, 20), num(e, 40), 0, Math.PI * 2), layer)
        break
      case 'ELLIPSE': {
        const cx = num(e, 10)
        const cy = num(e, 20)
        const mx = num(e, 11)
        const my = num(e, 21)
        const ratio = num(e, 40, 1)
        let t0 = num(e, 41, 0)
        let t1 = num(e, 42, Math.PI * 2)
        if (t1 <= t0) t1 += Math.PI * 2
        const n = Math.max(8, Math.ceil(((t1 - t0) / (Math.PI * 2)) * 48))
        const pts: [number, number][] = []
        for (let k = 0; k <= n; k++) {
          const t = t0 + ((t1 - t0) * k) / n
          pts.push([cx + mx * Math.cos(t) - my * ratio * Math.sin(t), cy + my * Math.cos(t) + mx * ratio * Math.sin(t)])
        }
        poly(m, 1, pts, layer)
        break
      }
      case 'SPLINE': {
        const fit: [number, number][] = []
        const ctrl: [number, number][] = []
        for (let k = 0; k < e.pairs.length; k++) {
          const p = e.pairs[k]
          if (p.code === 11) fit.push([Number(p.value), Number(e.pairs[k + 1]?.value ?? 0)])
          if (p.code === 10) ctrl.push([Number(p.value), Number(e.pairs[k + 1]?.value ?? 0)])
        }
        poly(m, 1, fit.length >= 2 ? fit : ctrl, layer)
        count('SPLINE (approximated)')
        break
      }
      case 'SOLID':
      case 'TRACE':
      case '3DFACE': {
        const q: [number, number][] = [
          [num(e, 10), num(e, 20)],
          [num(e, 11), num(e, 21)],
          [num(e, 13), num(e, 23)],
          [num(e, 12), num(e, 22)],
        ]
        poly(m, ocs, [...q, q[0]], layer)
        break
      }
      case 'TEXT':
      case 'ATTRIB':
      case 'MTEXT': {
        let t = e.type === 'MTEXT' ? cleanMText([...e.pairs.filter((p) => p.code === 3).map((p) => p.value), str(e, 1) ?? ''].join('')) : (str(e, 1) ?? '').replace(/%%[dD]/g, '°').replace(/%%[cC]/g, 'Ø')
        t = t.trim()
        if (!t) break
        const h = num(e, 40, 1)
        let x = num(e, 10)
        let y = num(e, 20)
        let rot = (num(e, 50) * Math.PI) / 180
        let ax = 0 // 0 left, 0.5 centre, 1 right
        let ay = 0 // 0 baseline, 0.5 middle, 1 top
        if (e.type === 'MTEXT') {
          const dx = num(e, 11, NaN)
          if (Number.isFinite(dx)) rot = Math.atan2(num(e, 21), dx)
          const att = num(e, 71, 1)
          ax = [0, 0.5, 1][(att - 1) % 3]
          ay = [1, 0.5, 0][Math.floor((att - 1) / 3)]
        } else if (num(e, 72) || num(e, 73)) {
          x = num(e, 11, x)
          y = num(e, 21, y)
          ax = [0, 0.5, 1, 0, 0.5, 0][num(e, 72)] ?? 0
          ay = [0, 0, 0.5, 1][num(e, 73)] ?? 0
        }
        const [wx, wy] = ap(m, ocs * x, y)
        const sc = Math.sqrt(Math.abs(det(m)))
        const mrot = Math.atan2(m[1], m[0])
        out.texts.push({ text: t.slice(0, 300), x: wx, y: wy, h: h * sc, rot: rot + mrot, w: 0.6 * h * sc * t.length, anchorX: ax, anchorY: ay })
        break
      }
      case 'INSERT': {
        const name = str(e, 2) ?? ''
        const b = blocks.get(name)
        if (!b) {
          count('missing block')
          break
        }
        if (b.xref) {
          count('XREF (not supplied)')
          break
        }
        if (depth > 8) {
          count('block nesting too deep')
          break
        }
        const sx = num(e, 41, 1)
        const sy = num(e, 42, 1)
        const r = (num(e, 50) * Math.PI) / 180
        const cols = Math.max(1, num(e, 70, 1))
        const rows = Math.max(1, num(e, 71, 1))
        for (let ci = 0; ci < cols; ci++) {
          for (let ri = 0; ri < rows; ri++) {
            // In the insert's OCS: translate to the insertion point, rotate, offset the
            // MINSERT cell, scale, and move the block base point to the origin.
            const local: M = mul(
              [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), num(e, 10), num(e, 20)],
              mul([1, 0, 0, 1, num(e, 44) * ci, num(e, 45) * ri], mul([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -b.base[0], -b.base[1]]))
            )
            // Extrusion (0,0,-1) OCS maps x → −x in world coordinates (arbitrary axis algorithm).
            const full = mul(m, ocs < 0 ? mul([-1, 0, 0, 1, 0, 0], local) : local)
            for (const child of b.ents) emit(child, full, depth + 1, layer)
          }
        }
        break
      }
      case 'DIMENSION': {
        const type = num(e, 70) & 7
        if (type !== 0 && type !== 1) {
          count('angular/radial dimension')
          break
        }
        const p13: [number, number] = [num(e, 13), num(e, 23)]
        const p14: [number, number] = [num(e, 14), num(e, 24)]
        let dir: [number, number]
        if (type === 0) {
          const a = (num(e, 50) * Math.PI) / 180
          dir = [Math.cos(a), Math.sin(a)]
        } else {
          const l = Math.hypot(p14[0] - p13[0], p14[1] - p13[1]) || 1
          dir = [(p14[0] - p13[0]) / l, (p14[1] - p13[1]) / l]
        }
        const along = (p14[0] - p13[0]) * dir[0] + (p14[1] - p13[1]) * dir[1]
        const p2: [number, number] = [p13[0] + dir[0] * along, p13[1] + dir[1] * along]
        const raw42 = num(e, 42, NaN)
        const text = str(e, 1)
        const a = ap(m, p13[0], p13[1])
        const b = ap(m, p2[0], p2[1])
        const sc = Math.sqrt(Math.abs(det(m)))
        const measured = Number.isFinite(raw42) ? raw42 * sc : Math.abs(along) * sc
        // "" or "<>" show the measurement; anything else is an override to preserve and reconcile.
        const shown = text && text !== '<>' ? cleanMText(text.replace('<>', String(Math.round(measured * 100) / 100))) : ''
        out.dims.push({
          measured,
          text: shown || null,
          p1: a,
          p2: b,
          layer,
        })
        break
      }
      case 'HATCH':
      case 'POINT':
      case 'VIEWPORT':
      case 'ATTDEF':
      case 'SEQEND':
        break
      default:
        count(e.type)
    }
  }

  for (const e of toEntities(ents)) emit(e, IDENT, 0, '0')
  if (out.segs.length / 5 >= MAX) out.warnings.push(`Line work was capped at ${MAX.toLocaleString()} segments.`)
  for (const k of Object.keys(out.unsupported)) out.warnings.push(`${out.unsupported[k]} × ${k} not imported.`)
  return out
}

function pdfEscape(s: string) {
  return s
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[i]
}

export async function extractDxf(buffer: Buffer): Promise<ExtractedPage[]> {
  const text = buffer.toString('utf8')
  const parsed = parseDxf(text)
  const n = parsed.segs.length / 5
  if (n === 0) throw new ExtractionError('EMPTY_INPUT', 'The DXF contains no model-space line work.')

  // Extents with stray-geometry protection.
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < n; i++) {
    xs.push(parsed.segs[i * 5], parsed.segs[i * 5 + 2])
    ys.push(parsed.segs[i * 5 + 1], parsed.segs[i * 5 + 3])
  }
  xs.sort((a, b) => a - b)
  ys.sort((a, b) => a - b)
  let minX = xs[0]
  let maxX = xs[xs.length - 1]
  let minY = ys[0]
  let maxY = ys[ys.length - 1]
  const warnings = [...parsed.warnings]
  const pX0 = percentile(xs, 0.005)
  const pX1 = percentile(xs, 0.995)
  const pY0 = percentile(ys, 0.005)
  const pY1 = percentile(ys, 0.995)
  if (maxX - minX > 3 * (pX1 - pX0) || maxY - minY > 3 * (pY1 - pY0)) {
    const mx = (pX1 - pX0) * 0.05
    const my = (pY1 - pY0) * 0.05
    minX = pX0 - mx
    maxX = pX1 + mx
    minY = pY0 - my
    maxY = pY1 + my
    warnings.push('Stray geometry far from the main drawing was excluded from the page.')
  }
  const ext = Math.max(maxX - minX, maxY - minY, 1e-9)
  const long = config.interior.pageLongSide
  const margin = Math.round(long * 0.02)
  const k = (long - 2 * margin) / ext // px per drawing unit
  const W = Math.ceil((maxX - minX) * k + 2 * margin)
  const H = Math.ceil((maxY - minY) * k + 2 * margin)
  const toPx = (x: number, y: number): [number, number] => [(x - minX) * k + margin, (maxY - y) * k + margin]
  const inside = (x: number, y: number) => x >= -W * 0.05 && x <= W * 1.05 && y >= -H * 0.05 && y <= H * 1.05

  // Page-space segments and a PDF content stream to rasterise them (with text) via MuPDF.
  const sink = new SegmentSink(config.interior.maxVectorSegments, 0.5)
  const stream: string[] = ['1 J 1 j 0 0 0 RG 0 0 0 rg 0.9 w']
  for (let i = 0; i < n; i++) {
    const [ax, ay] = toPx(parsed.segs[i * 5], parsed.segs[i * 5 + 1])
    const [bx, by] = toPx(parsed.segs[i * 5 + 2], parsed.segs[i * 5 + 3])
    if (!inside(ax, ay) && !inside(bx, by)) continue
    sink.push(ax, ay, bx, by, 1)
    stream.push(`${ax.toFixed(2)} ${(H - ay).toFixed(2)} m ${bx.toFixed(2)} ${(H - by).toFixed(2)} l S`)
  }
  const raw: Omit<TextToken, 'id'>[] = []
  for (const t of parsed.texts) {
    const [px, py] = toPx(t.x, t.y)
    if (!inside(px, py)) continue
    const h = t.h * k
    const w = t.w * k
    if (h < 2) continue
    const c = Math.cos(t.rot)
    const s = Math.sin(t.rot)
    // Text box corners (PDF/DXF y-up local frame), offset by the attachment anchor.
    const ox = -t.anchorX * w
    const oy = -t.anchorY * h
    const corners = [
      [ox, oy],
      [ox + w, oy],
      [ox + w, oy + h],
      [ox, oy + h],
    ].map(([lx, ly]) => [px + lx * c - ly * s, py - (lx * s + ly * c)])
    const bx = corners.map((p) => p[0])
    const by = corners.map((p) => p[1])
    raw.push({ text: t.text, bbox: [Math.min(...bx), Math.min(...by), Math.max(...bx), Math.max(...by)], source: 'dxf', confidence: 1, vertical: Math.abs(s) > 0.7 })
    const bxPdf = px + ox * c - oy * s
    const byPdf = H - py + (ox * s + oy * c)
    stream.push(`BT /F1 ${h.toFixed(2)} Tf ${c.toFixed(4)} ${s.toFixed(4)} ${(-s).toFixed(4)} ${c.toFixed(4)} ${bxPdf.toFixed(2)} ${byPdf.toFixed(2)} Tm (${pdfEscape(t.text)}) Tj ET`)
  }

  const mmPerUnit = INSUNITS_MM[parsed.insUnits] ?? null
  if (!mmPerUnit) warnings.push('The DXF does not declare drawing units ($INSUNITS). Confirm the units to fix the scale.')
  const cadDimensions: CadDimension[] = parsed.dims
    .map((d, i) => {
      const p1 = toPx(d.p1[0], d.p1[1])
      const p2 = toPx(d.p2[0], d.p2[1])
      return { id: `D${i + 1}`, measured: d.measured, measuredMm: mmPerUnit ? d.measured * mmPerUnit : null, displayText: d.text, p1: { x: p1[0], y: p1[1] }, p2: { x: p2[0], y: p2[1] }, layer: d.layer }
    })
    .filter((d) => inside(d.p1.x, d.p1.y) && inside(d.p2.x, d.p2.y))

  // Rasterise through MuPDF so text is rendered too.
  const mupdf = await loadMupdf()
  const pdf = new mupdf.PDFDocument()
  try {
    const font = pdf.addSimpleFont(new mupdf.Font('Helvetica'))
    const res = pdf.addObject({ Font: { F1: font } })
    const page = pdf.addPage([0, 0, W, H], 0, res, stream.join('\n'))
    pdf.insertPage(-1, page)
    const bytes = pdf.saveToBuffer('compress').asUint8Array()
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
    try {
      const p = doc.loadPage(0)
      try {
        const full = renderPage(mupdf, p, 1, 'png')
        const ps = Math.min(1, config.interior.previewLongSide / Math.max(full.width, full.height))
        const prev = renderPage(mupdf, p, ps, 'jpeg')
        const texts = numberTokens(raw)
        const extraction: PageExtraction = {
          version: 1,
          source: 'dxf',
          width: full.width,
          height: full.height,
          previewScale: prev.width / full.width,
          pdf: null,
          dxf: { insUnits: parsed.insUnits, mmPerUnit, pxPerUnit: k, mmPerPx: mmPerUnit ? mmPerUnit / k : null, layers: parsed.layers.slice(0, 300), unsupported: parsed.unsupported },
          texts,
          cadDimensions,
          vectorCount: sink.count,
          unitsFromNotes: unitsFromNotes(texts.map((t) => t.text)),
          warnings,
        }
        return [{ pageIndex: 0, width: full.width, height: full.height, image: full.data, preview: prev.data, previewWidth: prev.width, previewHeight: prev.height, vectors: sink.toBuffer(), extraction }]
      } finally {
        p.destroy?.()
      }
    } finally {
      doc.destroy?.()
    }
  } finally {
    pdf.destroy?.()
  }
}
