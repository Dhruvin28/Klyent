import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Box, Calibration, PageDetail, Pt } from '@/lib/interior/types'

export const LAYERS = ['walls', 'openings', 'rooms', 'furniture', 'dimensions', 'ceilings', 'lights', 'elevation', 'text', 'issues'] as const
export type Layer = (typeof LAYERS)[number]

interface Props {
  page: PageDetail
  imageUrl: string | null
  layers: Set<Layer>
  calibration?: Calibration | null
  highlight?: Box | null
  /** When set, clicks report page-px points instead of panning. */
  picking?: boolean
  picks?: Pt[]
  onPick?: (p: Pt) => void
  className?: string
}

/** Zoom/pan SVG viewer of one drawing page with interpretation overlays (page px space). */
export function PageCanvas({ page, imageUrl, layers, calibration, highlight, picking, picks, onPick, className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const W = page.width
  const H = page.height
  const [vb, setVb] = useState<[number, number, number, number]>([0, 0, W, H])
  const drag = useRef<{ x: number; y: number; vb: [number, number, number, number]; moved: boolean } | null>(null)

  useEffect(() => setVb([0, 0, W, H]), [page.id, W, H])

  // Zoom to the highlighted source region.
  useEffect(() => {
    if (!highlight) return
    const [x0, y0, x1, y1] = highlight
    const pad = Math.max(120, (x1 - x0) * 0.8, (y1 - y0) * 0.8)
    const w = Math.max(x1 - x0 + pad * 2, 300)
    const h = Math.max(y1 - y0 + pad * 2, 300 * (H / W))
    setVb([(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h])
  }, [highlight, W, H])

  const toPage = useCallback((cx: number, cy: number): Pt | null => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }, [])

  const onWheel = (e: React.WheelEvent) => {
    const p = toPage(e.clientX, e.clientY)
    if (!p) return
    const f = Math.exp(e.deltaY * 0.0015)
    setVb(([x, y, w, h]) => {
      const nw = Math.min(W * 4, Math.max(40, w * f))
      const nh = (nw * h) / w
      return [p.x - ((p.x - x) * nw) / w, p.y - ((p.y - y) * nh) / h, nw, nh]
    })
  }

  // Non-passive wheel listener so the page doesn't scroll while zooming.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const stop = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const rect = svgRef.current!.getBoundingClientRect()
    const dx = ((e.clientX - d.x) / rect.width) * d.vb[2]
    const dy = ((e.clientY - d.y) / rect.height) * d.vb[3]
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
    if (d.moved) setVb([d.vb[0] - dx, d.vb[1] - dy, d.vb[2], d.vb[3]])
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved && picking && onPick) {
      const p = toPage(e.clientX, e.clientY)
      if (p) onPick(p)
    }
  }

  const it = page.interpretation
  const tokens = useMemo(() => new Map(page.extraction.texts.map((t) => [t.id, t])), [page.extraction.texts])
  const inlierText = useMemo(() => new Set((calibration?.samples ?? []).filter((s) => s.inlier && s.textId).map((s) => s.textId!)), [calibration])
  const outlierText = useMemo(() => new Set((calibration?.samples ?? []).filter((s) => !s.inlier && s.textId).map((s) => s.textId!)), [calibration])
  const scale = vb[2] / W // >1 when zoomed out
  const label = Math.max(10, 13 * scale * (W / 1600))

  const wallsById = useMemo(() => new Map((it?.walls ?? []).map((w) => [w.id, w])), [it])

  return (
    <div className={className}>
      <svg
        ref={svgRef}
        viewBox={vb.join(' ')}
        className={`h-full w-full select-none bg-neutral-100 dark:bg-neutral-900 ${picking ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={() => setVb([0, 0, W, H])}
      >
        <rect x={0} y={0} width={W} height={H} fill="white" />
        {imageUrl && <image href={imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}

        {layers.has('text') &&
          page.extraction.texts.map((t) => (
            <rect key={t.id} x={t.bbox[0]} y={t.bbox[1]} width={t.bbox[2] - t.bbox[0]} height={t.bbox[3] - t.bbox[1]} fill="rgba(59,130,246,0.08)" stroke="rgba(59,130,246,0.55)" strokeWidth={1} vectorEffect="non-scaling-stroke">
              <title>{`${t.id}: ${t.text}${t.source === 'ocr' ? ` (OCR ${Math.round(t.confidence * 100)}%)` : ''}`}</title>
            </rect>
          ))}

        {it && layers.has('rooms') &&
          it.rooms.map((r, i) =>
            r.polygon.length >= 3 ? (
              <g key={`r${i}`}>
                <polygon points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(16,185,129,0.07)" stroke="rgba(16,185,129,0.7)" strokeDasharray="6 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              </g>
            ) : null
          )}

        {it && layers.has('ceilings') &&
          it.ceilingZones.map((z, i) => (
            <polygon key={`c${i}`} points={z.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(168,85,247,0.08)" stroke="rgba(147,51,234,0.9)" strokeDasharray="10 5" strokeWidth={2} vectorEffect="non-scaling-stroke">
              <title>{`${z.label || z.kind} · level ${z.levelText ?? '?'}${z.hasCoveLight ? ' · cove' : ''}`}</title>
            </polygon>
          ))}

        {it && layers.has('walls') &&
          it.walls.map((w) => (
            <g key={w.id}>
              <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="rgba(239,68,68,0.28)" strokeWidth={Math.max(2, w.thicknessPx)} strokeLinecap="butt" />
              <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={w.confidence < 0.6 ? '#f59e0b' : '#dc2626'} strokeWidth={1.5} vectorEffect="non-scaling-stroke">
                <title>{`Wall ${w.id} · ${w.kind} · confidence ${Math.round(w.confidence * 100)}%`}</title>
              </line>
            </g>
          ))}

        {it && layers.has('openings') &&
          it.openings.map((o, i) => {
            const w = o.wallRef ? wallsById.get(o.wallRef) : undefined
            const d = w ? { x: (w.b.x - w.a.x) / Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), y: (w.b.y - w.a.y) / Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) } : { x: 1, y: 0 }
            const h = o.widthPx / 2
            return (
              <line key={`o${i}`} x1={o.center.x - d.x * h} y1={o.center.y - d.y * h} x2={o.center.x + d.x * h} y2={o.center.y + d.y * h} stroke={o.type === 'window' ? '#0ea5e9' : '#16a34a'} strokeWidth={5} vectorEffect="non-scaling-stroke" strokeLinecap="round">
                <title>{`${o.type} · ${Math.round(o.widthPx)} px wide`}</title>
              </line>
            )
          })}

        {it && layers.has('furniture') &&
          it.furniture.map((f, i) => (
            <g key={`f${i}`} transform={`translate(${f.center.x} ${f.center.y}) rotate(${f.rotationDeg})`}>
              <rect x={-f.widthPx / 2} y={-f.depthPx / 2} width={f.widthPx} height={f.depthPx} fill="rgba(234,88,12,0.10)" stroke="#ea580c" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <line x1={-f.widthPx / 2} y1={f.depthPx / 2} x2={f.widthPx / 2} y2={f.depthPx / 2} stroke="#ea580c" strokeWidth={3} vectorEffect="non-scaling-stroke" />
              <title>{`${f.label} (${f.category}) · confidence ${Math.round(f.confidence * 100)}% · front edge thick`}</title>
            </g>
          ))}

        {it && layers.has('lights') &&
          it.lights.map((l, i) => (
            <circle key={`l${i}`} cx={l.at.x} cy={l.at.y} r={Math.max(6, 9 * scale)} fill="rgba(250,204,21,0.6)" stroke="#a16207" strokeWidth={1.5} vectorEffect="non-scaling-stroke">
              <title>{l.kind}</title>
            </circle>
          ))}

        {it && layers.has('dimensions') &&
          [...it.dimensions, ...(it.elevation?.heightDimensions ?? [])].map((d, i) => {
            const ok = d.textId && inlierText.has(d.textId)
            const bad = d.textId && outlierText.has(d.textId)
            const color = ok ? '#059669' : bad ? '#dc2626' : '#d97706'
            const t = d.textId ? tokens.get(d.textId) : undefined
            return (
              <g key={`d${i}`}>
                <line x1={d.p1.x} y1={d.p1.y} x2={d.p2.x} y2={d.p2.y} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <circle cx={d.p1.x} cy={d.p1.y} r={4 * scale} fill={color} />
                <circle cx={d.p2.x} cy={d.p2.y} r={4 * scale} fill={color} />
                {t && <rect x={t.bbox[0] - 2} y={t.bbox[1] - 2} width={t.bbox[2] - t.bbox[0] + 4} height={t.bbox[3] - t.bbox[1] + 4} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                <title>{`${t?.text ?? d.readText}${ok ? ' · used for scale' : bad ? ' · disagrees with drawn length' : d.textId ? '' : ' · read by vision only (not authoritative)'}`}</title>
              </g>
            )
          })}

        {it?.elevation && layers.has('elevation') && (
          <g>
            <rect x={it.elevation.leftX} y={it.elevation.ceilingY} width={it.elevation.rightX - it.elevation.leftX} height={it.elevation.floorY - it.elevation.ceilingY} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="8 4" vectorEffect="non-scaling-stroke" />
            {it.elevation.features.map((f, i) => (
              <rect key={`ef${i}`} x={f.x0} y={f.yTop} width={f.x1 - f.x0} height={f.yBottom - f.yTop} fill="rgba(37,99,235,0.08)" stroke="#2563eb" strokeWidth={1.2} vectorEffect="non-scaling-stroke">
                <title>{`${f.kind}${f.divisions ? ` · ${f.divisions} divisions` : ''}${f.label ? ` · ${f.label}` : ''}`}</title>
              </rect>
            ))}
          </g>
        )}

        {it && layers.has('issues') &&
          it.issues
            .filter((i) => i.at)
            .map((i, k) => (
              <g key={`i${k}`}>
                <circle cx={i.at!.x} cy={i.at!.y} r={Math.max(10, 14 * scale)} fill="rgba(239,68,68,0.15)" stroke="#dc2626" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <text x={i.at!.x} y={i.at!.y + label * 0.35} textAnchor="middle" fontSize={label} fill="#dc2626" fontWeight={700}>
                  !
                </text>
                <title>{i.message}</title>
              </g>
            ))}

        {highlight && (
          <rect x={highlight[0]} y={highlight[1]} width={highlight[2] - highlight[0]} height={highlight[3] - highlight[1]} fill="rgba(37,99,235,0.12)" stroke="#2563eb" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        )}

        {picks?.map((p, i) => (
          <g key={`p${i}`}>
            <circle cx={p.x} cy={p.y} r={6 * scale} fill="#2563eb" />
            {i === 1 && <line x1={picks[0].x} y1={picks[0].y} x2={p.x} y2={p.y} stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </g>
        ))}
      </svg>
    </div>
  )
}
