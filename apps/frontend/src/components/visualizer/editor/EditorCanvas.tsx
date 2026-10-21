import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PROTECT_KEY } from '@/lib/visualizer/engine'
import { applyHomography, estimateAspectRatio, isConvexQuad, planeToImage, quadFromTuples, quadToTuples } from '@/lib/visualizer/homography'
import { applyMask, brushStroke, closeMask, fillPolygon, maskBBox, removeSmallIslands } from '@/lib/visualizer/mask'
import { upscaleLogitsToMask } from '@/lib/visualizer/resample'
import type { Point, Quad } from '@/lib/visualizer/types'
import type { VizEditor } from './useVizEditor'

export type Tool = 'pan' | 'ai' | 'wand' | 'polygon' | 'brush' | 'corners'
export type ViewMode = 'result' | 'original' | 'split'

export interface ToolSettings {
  brushSize: number
  brushHardness: number
  brushMode: 'add' | 'subtract'
  polygonMode: 'add' | 'subtract'
  wandTolerance: number
  wandContiguous: boolean
  wandLightness: number
}

export interface EditorCanvasHandle {
  fit: () => void
  applyProposal: (op: 'add' | 'subtract') => void
  clearProposal: () => void
  closePolygon: () => void
  cancelPolygon: () => void
  popPolygonPoint: () => void
}

interface Props {
  editor: VizEditor
  tool: Tool
  target: 'surface' | 'protect'
  activeSurfaceId: string | null
  activeColor: string
  settings: ToolSettings
  view: ViewMode
  showSelection: boolean
  onSamStatus: (status: string | null) => void
  onError: (message: string) => void
}

/** Same bounds the server enforces for surface dimensions. */
export const clampMm = (v: number) => (Number.isFinite(v) ? Math.max(1, Math.min(100_000, v)) : 1000)

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const EditorCanvas = forwardRef<EditorCanvasHandle, Props>(function EditorCanvas(
  { editor, tool, target, activeSurfaceId, activeColor, settings, view, showSelection, onSamStatus, onError },
  ref
) {
  const { W, H } = editor
  const containerRef = useRef<HTMLDivElement>(null)
  const originalCanvas = useRef<HTMLCanvasElement>(null)
  const resultCanvas = useRef<HTMLCanvasElement>(null)
  const overlayCanvas = useRef<HTMLCanvasElement>(null)
  const overlayBuf = useRef<ImageData | null>(null)
  const [view2d, setView2d] = useState({ zoom: 0.2, x: 0, y: 0 })
  const viewRef = useRef(view2d)
  viewRef.current = view2d
  const [spaceDown, setSpaceDown] = useState(false)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [split, setSplit] = useState(0.5)

  // Tool-local state
  const [polygon, setPolygon] = useState<Point[]>([])
  const [samPoints, setSamPoints] = useState<{ x: number; y: number; label: 0 | 1 }[]>([])
  const [samBox, setSamBox] = useState<[number, number, number, number] | null>(null)
  const [dragBox, setDragBox] = useState<[number, number, number, number] | null>(null)
  const [proposal, setProposal] = useState<Uint8Array | null>(null)
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'brush'; key: string; before: Uint8Array; last: Point }
    | { kind: 'corner'; index: number; quad: Quad }
    | { kind: 'aibox'; start: Point; sx: number; sy: number }
    | { kind: 'split' }
    | null
  >(null)

  const targetKey = target === 'protect' ? PROTECT_KEY : activeSurfaceId
  const activeSurface = editor.state.surfaces.find((s) => s.id === activeSurfaceId) ?? null

  // ── fit / zoom ───────────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const zoom = Math.min(r.width / W, r.height / H) * 0.96
    setView2d({ zoom, x: (r.width - W * zoom) / 2, y: (r.height - H * zoom) / 2 })
  }, [W, H])

  useEffect(() => {
    fit()
    const ro = new ResizeObserver(() => fit())
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [fit])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      const v = viewRef.current
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      const zoom = Math.max(0.02, Math.min(16, v.zoom * factor))
      setView2d({ zoom, x: mx - ((mx - v.x) * zoom) / v.zoom, y: my - ((my - v.y) * zoom) / v.zoom })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const toImage = (clientX: number, clientY: number): Point => {
    const r = containerRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom }
  }
  const clampPt = (p: Point): Point => ({ x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) })

  // ── draw original + result ───────────────────────────────────────────────
  useEffect(() => {
    const img = editor.original.current
    const c = originalCanvas.current
    if (!editor.ready || !img || !c) return
    c.width = W
    c.height = H
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), W, H), 0, 0)
  }, [editor.ready, editor.original, W, H])

  useEffect(() => {
    const f = editor.frame
    const c = resultCanvas.current
    if (!f || !c) return
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    const ctx = c.getContext('2d')!
    if (f.width === W && f.height === H) {
      ctx.putImageData(new ImageData(f.pixels, W, H), 0, 0)
    } else {
      const tmp = new OffscreenCanvas(f.width, f.height)
      tmp.getContext('2d')!.putImageData(new ImageData(f.pixels, f.width, f.height), 0, 0)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(tmp, 0, 0, W, H)
    }
  }, [editor.frame, W, H])

  // ── selection overlay ────────────────────────────────────────────────────
  const drawOverlay = useCallback(
    (rect?: { x0: number; y0: number; x1: number; y1: number }) => {
      const c = overlayCanvas.current
      if (!c) return
      if (c.width !== W || c.height !== H) {
        c.width = W
        c.height = H
        overlayBuf.current = null
      }
      if (!overlayBuf.current) overlayBuf.current = new ImageData(W, H)
      const buf = overlayBuf.current.data
      const r = rect ?? { x0: 0, y0: 0, x1: W, y1: H }
      const x0 = Math.max(0, Math.floor(r.x0))
      const y0 = Math.max(0, Math.floor(r.y0))
      const x1 = Math.min(W, Math.ceil(r.x1))
      const y1 = Math.min(H, Math.ceil(r.y1))
      if (x1 <= x0 || y1 <= y0) return
      const surf = showSelection && activeSurfaceId ? editor.getMask(activeSurfaceId)?.data : null
      const prot = showSelection || target === 'protect' ? editor.getMask(PROTECT_KEY)?.data : null
      const prop = proposal
      const [sr, sg, sb] = hexToRgb(activeColor)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * W + x
          const i = p * 4
          let r8 = 0, g8 = 0, b8 = 0, a = 0
          const sm = surf ? surf[p] : 0
          if (sm) {
            r8 = sr; g8 = sg; b8 = sb
            a = sm * 0.42
          }
          const pm = prot ? prot[p] : 0
          if (pm) {
            // diagonal hatching so protected areas read clearly over any colour
            const hatch = ((x + y) >> 2) & 1 ? 0.6 : 0.3
            r8 = 239; g8 = 68; b8 = 68
            a = Math.max(a, pm * hatch)
          }
          const qm = prop ? prop[p] : 0
          if (qm) {
            r8 = 34; g8 = 211; b8 = 238
            a = Math.max(a, qm * 0.5)
          }
          buf[i] = r8
          buf[i + 1] = g8
          buf[i + 2] = b8
          buf[i + 3] = a
        }
      }
      c.getContext('2d')!.putImageData(overlayBuf.current, 0, 0, x0, y0, x1 - x0, y1 - y0)
    },
    [W, H, editor, activeSurfaceId, activeColor, proposal, showSelection, target]
  )

  useEffect(() => {
    if (editor.ready) drawOverlay()
  }, [editor.ready, editor.maskTick, drawOverlay])

  // Reset transient tool state when the tool or target changes.
  useEffect(() => {
    setPolygon([])
    setSamPoints([])
    setSamBox(null)
    setDragBox(null)
    setProposal(null)
  }, [tool, target, activeSurfaceId])

  // ── AI select ────────────────────────────────────────────────────────────
  const runSam = useCallback(
    async (points: { x: number; y: number; label: 0 | 1 }[], box: [number, number, number, number] | null) => {
      const sam = editor.sam.current
      const img = editor.original.current
      if (!sam || !img) return
      if (!points.length && !box) {
        setProposal(null)
        return
      }
      setBusy(true)
      try {
        // One SamClient per editor, so a constant key suffices; analyse() is a no-op once done.
        await sam.analyse('render', img, (p) =>
          onSamStatus(p.stage === 'download' ? `Downloading AI model${p.progress != null ? ` ${Math.round(p.progress * 100)}%` : '…'}` : 'Analysing render…')
        )
        onSamStatus('Finding surface…')
        const r = await sam.predict(points, box)
        setProposal(upscaleLogitsToMask(r.logits, r.width, r.height, W, H))
        onSamStatus(null)
      } catch (err) {
        onSamStatus(null)
        onError(`AI selection unavailable: ${err instanceof Error ? err.message : 'unknown error'}. Use Smart select or Polygon instead.`)
      } finally {
        setBusy(false)
      }
    },
    [editor, W, H, onSamStatus, onError]
  )

  // ── proposal / polygon actions ───────────────────────────────────────────
  const applyProposal = useCallback(
    (op: 'add' | 'subtract') => {
      if (!proposal || !targetKey) return
      const prop = proposal
      editor.editMask(targetKey, (m) => applyMask(m, { width: W, height: H, data: prop }, op))
      setProposal(null)
      setSamPoints([])
      setSamBox(null)
    },
    [proposal, targetKey, editor, W, H]
  )

  const closePolygon = useCallback(() => {
    if (polygon.length < 3 || !targetKey) return
    const pts = polygon
    editor.editMask(targetKey, (m) => fillPolygon(m, pts, settings.polygonMode))
    setPolygon([])
  }, [polygon, targetKey, editor, settings.polygonMode])

  useImperativeHandle(
    ref,
    () => ({
      fit,
      applyProposal,
      clearProposal: () => {
        setProposal(null)
        setSamPoints([])
        setSamBox(null)
      },
      closePolygon,
      cancelPolygon: () => setPolygon([]),
      popPolygonPoint: () => setPolygon((p) => p.slice(0, -1)),
    }),
    [fit, applyProposal, closePolygon]
  )

  // ── quad for the corners tool ────────────────────────────────────────────
  const quad: Quad | null = useMemo(() => {
    if (!activeSurface) return null
    if (activeSurface.quad) return quadFromTuples(activeSurface.quad)
    const m = editor.getMask(activeSurface.id)
    const b = m ? maskBBox(m) : null
    if (!b) return null
    return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }]
  }, [activeSurface, editor, editor.maskTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const gridLines = useMemo(() => {
    if (!quad || !activeSurface || !isConvexQuad(quad)) return []
    try {
      const Hm = planeToImage(quad, 1, 1)
      const lines: string[] = []
      const n = 8
      for (let k = 1; k < n; k++) {
        const t = k / n
        const a = applyHomography(Hm, t, 0)
        const b = applyHomography(Hm, t, 1)
        const c = applyHomography(Hm, 0, t)
        const d = applyHomography(Hm, 1, t)
        lines.push(`M${a.x} ${a.y}L${b.x} ${b.y}`, `M${c.x} ${c.y}L${d.x} ${d.y}`)
      }
      return lines
    } catch {
      return []
    }
  }, [quad, activeSurface])

  const setQuad = (q: Quad) => {
    if (!activeSurface) return
    const patch: Parameters<typeof editor.updateSurface>[1] = { quad: quadToTuples(q) }
    if (!activeSurface.heightManual && isConvexQuad(q)) {
      const aspect = estimateAspectRatio(q, W, H)
      if (Number.isFinite(aspect) && aspect > 0) patch.heightMm = clampMm(Math.round(activeSurface.widthMm / aspect))
    }
    editor.updateSurface(activeSurface.id, patch)
  }

  // ── pointer handling ─────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (!editor.ready) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = toImage(e.clientX, e.clientY)
    const v = viewRef.current
    if (e.button === 1 || spaceDown || tool === 'pan') {
      dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }
      return
    }
    if (e.button !== 0 && !(tool === 'ai' && e.button === 2)) return

    if (tool === 'corners' && quad) {
      const radius = 14 / v.zoom
      const idx = quad.findIndex((c) => Math.hypot(c.x - p.x, c.y - p.y) < radius)
      if (idx >= 0) dragRef.current = { kind: 'corner', index: idx, quad }
      return
    }
    if (!targetKey) {
      onError('Add or select a surface first.')
      return
    }
    if (tool === 'brush') {
      const e0 = editor.ensureMask(targetKey)
      const before = e0.data.slice()
      const mode = e.altKey ? (settings.brushMode === 'add' ? 'subtract' : 'add') : settings.brushMode
      const m = { width: W, height: H, data: e0.data }
      brushStroke(m, p, p, settings.brushSize / 2, settings.brushHardness, mode)
      const r = settings.brushSize
      drawOverlay({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r })
      dragRef.current = { kind: 'brush', key: targetKey, before, last: p }
      return
    }
    if (tool === 'ai') {
      dragRef.current = { kind: 'aibox', start: clampPt(p), sx: e.clientX, sy: e.clientY }
      return
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toImage(e.clientX, e.clientY)
    setCursor(p)
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'pan') {
      setView2d((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }))
    } else if (d.kind === 'brush') {
      const e0 = editor.ensureMask(d.key)
      const mode = e.altKey ? (settings.brushMode === 'add' ? 'subtract' : 'add') : settings.brushMode
      brushStroke({ width: W, height: H, data: e0.data }, d.last, p, settings.brushSize / 2, settings.brushHardness, mode)
      const r = settings.brushSize
      drawOverlay({ x0: Math.min(d.last.x, p.x) - r, y0: Math.min(d.last.y, p.y) - r, x1: Math.max(d.last.x, p.x) + r, y1: Math.max(d.last.y, p.y) + r })
      d.last = p
    } else if (d.kind === 'corner') {
      const q = d.quad.map((c, i) => (i === d.index ? clampPt(p) : c)) as Quad
      d.quad = q
      setQuad(q)
    } else if (d.kind === 'aibox') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
        const q = clampPt(p)
        setDragBox([Math.min(d.start.x, q.x), Math.min(d.start.y, q.y), Math.max(d.start.x, q.x), Math.max(d.start.y, q.y)])
      }
    } else if (d.kind === 'split') {
      const r = containerRef.current!.getBoundingClientRect()
      const v = viewRef.current
      setSplit(Math.max(0, Math.min(1, (e.clientX - r.left - v.x) / (W * v.zoom))))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) {
      handleClick(e)
      return
    }
    if (d.kind === 'brush') {
      editor.commitEdit(d.key, d.before)
    } else if (d.kind === 'aibox') {
      if (dragBox && dragBox[2] - dragBox[0] > 4 && dragBox[3] - dragBox[1] > 4) {
        const box = dragBox
        setSamBox(box)
        setDragBox(null)
        void runSam(samPoints, box)
      } else {
        setDragBox(null)
        const label: 0 | 1 = e.altKey || e.button === 2 ? 0 : 1
        const pts = [...samPoints, { ...clampPt(d.start), label }]
        setSamPoints(pts)
        void runSam(pts, samBox)
      }
    }
  }

  const handleClick = (e: React.PointerEvent) => {
    if (!editor.ready || e.button !== 0 || spaceDown) return
    const p = clampPt(toImage(e.clientX, e.clientY))
    if (tool === 'polygon') {
      if (!targetKey) return onError('Add or select a surface first.')
      const v = viewRef.current
      if (polygon.length >= 3 && Math.hypot(polygon[0].x - p.x, polygon[0].y - p.y) < 10 / v.zoom) {
        closePolygon()
      } else setPolygon((pts) => [...pts, p])
    } else if (tool === 'wand') {
      if (!targetKey) return onError('Add or select a surface first.')
      setBusy(true)
      editor.engine.current
        ?.smartSelect(p, { tolerance: settings.wandTolerance, contiguous: settings.wandContiguous, lightnessWeight: settings.wandLightness })
        .then((data) => {
          // tidy speckle from wood grain / noise
          let m = closeMask({ width: W, height: H, data }, 2)
          m = removeSmallIslands(m, 64)
          setProposal(m.data)
        })
        .catch((err) => onError(err instanceof Error ? err.message : 'Smart select failed'))
        .finally(() => setBusy(false))
    }
  }

  useEffect(() => {
    if (editor.ready) drawOverlay()
  }, [proposal]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── render ───────────────────────────────────────────────────────────────
  const { zoom } = view2d
  const sw = 1 / zoom // one screen pixel in image units
  const cursorClass =
    spaceDown || tool === 'pan' ? (dragRef.current?.kind === 'pan' ? 'cursor-grabbing' : 'cursor-grab') : tool === 'corners' ? 'cursor-default' : 'cursor-crosshair'
  const showResult = view !== 'original'

  return (
    <div
      ref={containerRef}
      className={cn('relative h-full w-full touch-none select-none overflow-hidden bg-[repeating-conic-gradient(#e5e7eb_0_25%,#f3f4f6_0_50%)] [background-size:16px_16px] dark:bg-[repeating-conic-gradient(#1f2937_0_25%,#111827_0_50%)]', cursorClass)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        // A cancelled gesture must still commit (or the painted pixels are never saved/undoable).
        const d = dragRef.current
        dragRef.current = null
        if (d?.kind === 'brush') editor.commitEdit(d.key, d.before)
        setDragBox(null)
      }}
      onPointerLeave={() => setCursor(null)}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={() => tool === 'polygon' && closePolygon()}
      data-testid="viz-canvas"
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: W, height: H, transform: `translate(${view2d.x}px, ${view2d.y}px) scale(${zoom})` }}
      >
        <canvas ref={originalCanvas} className="absolute inset-0 h-full w-full" style={{ imageRendering: zoom > 2 ? 'pixelated' : 'auto' }} />
        <canvas
          ref={resultCanvas}
          className="absolute inset-0 h-full w-full"
          style={{
            visibility: showResult && editor.frame ? 'visible' : 'hidden',
            clipPath: view === 'split' ? `inset(0 0 0 ${split * 100}%)` : undefined,
            imageRendering: zoom > 2 ? 'pixelated' : 'auto',
          }}
          data-testid="viz-result-canvas"
        />
        <canvas ref={overlayCanvas} className="pointer-events-none absolute inset-0 h-full w-full" />
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${W} ${H}`}>
          {/* polygon in progress */}
          {polygon.length > 0 && (
            <>
              <polyline
                points={[...polygon, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
                fill={settings.polygonMode === 'add' ? 'rgba(34,211,238,0.15)' : 'rgba(239,68,68,0.15)'}
                stroke="#22d3ee"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              {polygon.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 6 : 4) * sw} fill={i === 0 ? '#fff' : '#22d3ee'} stroke="#0e7490" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
            </>
          )}
          {/* AI prompts */}
          {tool === 'ai' &&
            samPoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={6 * sw} fill={p.label ? '#22c55e' : '#ef4444'} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ))}
          {tool === 'ai' && (dragBox ?? samBox) && (() => {
            const b = (dragBox ?? samBox)!
            return <rect x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} fill="none" stroke="#22d3ee" strokeDasharray="6 4" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          })()}
          {/* brush cursor */}
          {tool === 'brush' && cursor && !spaceDown && (
            <circle cx={cursor.x} cy={cursor.y} r={settings.brushSize / 2} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ mixBlendMode: 'difference' }} />
          )}
          {/* perspective quad */}
          {tool === 'corners' && quad && (
            <>
              <polygon points={quad.map((c) => `${c.x},${c.y}`).join(' ')} fill="rgba(250,204,21,0.08)" stroke="#facc15" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {gridLines.map((d, i) => (
                <path key={i} d={d} stroke="#facc15" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
              {quad.map((c, i) => (
                <g key={i}>
                  <circle cx={c.x} cy={c.y} r={9 * sw} fill="#facc15" fillOpacity={0.4} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  <text x={c.x + 12 * sw} y={c.y - 10 * sw} fontSize={12 * sw} fill="#fff" stroke="#000" strokeWidth={3 * sw} paintOrder="stroke">
                    {['TL', 'TR', 'BR', 'BL'][i]}
                  </text>
                </g>
              ))}
            </>
          )}
        </svg>
      </div>

      {/* Split handle */}
      {view === 'split' && (
        <div
          className="absolute top-0 z-10 h-full w-1 cursor-ew-resize bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{ left: view2d.x + split * W * zoom - 2 }}
          onPointerDown={(e) => {
            e.stopPropagation()
            ;(e.currentTarget.parentElement as Element).setPointerCapture(e.pointerId)
            dragRef.current = { kind: 'split' }
          }}
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-black/70 px-2 py-0.5 text-[11px] text-white">
            ◀ Before · After ▶
          </div>
        </div>
      )}

      {/* Proposal actions */}
      {proposal && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span className="px-1 text-xs text-muted-foreground">Suggested area</span>
          <Button size="sm" onClick={() => applyProposal('add')} className="gap-1" data-testid="viz-proposal-add">
            <Plus className="h-3.5 w-3.5" /> Add <kbd className="ml-1 text-[10px] opacity-70">↵</kbd>
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyProposal('subtract')} className="gap-1">
            <Minus className="h-3.5 w-3.5" /> Subtract
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setProposal(null); setSamPoints([]); setSamBox(null) }} aria-label="Discard suggestion">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      {polygon.length >= 3 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span className="px-1 text-xs text-muted-foreground">{polygon.length} points · click first point or double-click to close</span>
          <Button size="sm" onClick={closePolygon} className="gap-1"><Check className="h-3.5 w-3.5" /> Close</Button>
          <Button size="sm" variant="ghost" onClick={() => setPolygon([])} aria-label="Cancel polygon"><X className="h-3.5 w-3.5" /></Button>
        </div>
      )}
      {busy && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
        </div>
      )}
      {!editor.ready && !editor.loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
    </div>
  )
})
