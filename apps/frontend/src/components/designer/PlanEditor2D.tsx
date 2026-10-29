import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { OPENING_DEFAULTS } from '@/lib/designer/defaults'
import {
  EPS,
  add,
  clampOpeningOffset,
  cleanupPlan,
  dist,
  formatMm,
  interiorPoint,
  itemFootprint,
  moveJoint,
  planBounds,
  projectToSegment,
  rectangleWalls,
  roomAreaSqm,
  same,
  scale,
  snapItemToWall,
  snapPoint,
  sub,
  syncRooms,
  uid,
  wallDir,
  wallExtensions,
  wallLeftNormal,
  wallLength,
  type SnapResult,
} from '@/lib/designer/geometry'
import type { Item, Opening, Plan, Vec2, Wall } from '@/lib/designer/types'
import { SQFT_PER_SQM } from '@/lib/visualizer/estimate'
import { SELECT, isTyping, type Tool } from './tools'
import type { DesignerEditor } from './useDesignerEditor'

interface View {
  /** Plan coordinate at the SVG's top-left. */
  x: number
  y: number
  /** Screen pixels per millimetre. */
  k: number
}

type Drag =
  | { kind: 'pan'; start: Vec2; view: View }
  | { kind: 'item'; id: string; offset: Vec2 }
  | { kind: 'joint'; from: Vec2; base: Plan }
  | { kind: 'wall'; id: string; start: Vec2; base: Plan; a: Vec2; b: Vec2 }
  | { kind: 'opening'; id: string }
  | { kind: 'room'; start: Vec2 }

interface Props {
  editor: DesignerEditor
  tool: Tool
  setTool: (t: Tool) => void
  wallThickness: number
  underlayUrl: string | null
  /** Show the furniture in the plan (off while tracing a plan image). */
  showItems?: boolean
}

const SNAP_PX = 12

export function PlanEditor2D({ editor, tool, setTool, wallThickness, underlayUrl, showItems = true }: Props) {
  const { plan, update, commit, selection, setSelection } = editor
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ x: -5000, y: -4000, k: 0.08 })
  const [cursor, setCursor] = useState<SnapResult | null>(null)
  const [chain, setChain] = useState<Vec2[]>([])
  const [typed, setTyped] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [calib, setCalib] = useState<{ points: Vec2[]; length: string }>({ points: [], length: '' })
  const [underlaySize, setUnderlaySize] = useState<{ w: number; h: number } | null>(null)
  const fitted = useRef(false)
  const snapOff = useRef(false)

  // Track container size.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const b = planBounds(plan)
    const ul = plan.underlay && underlaySize ? plan.underlay : null
    const minX = Math.min(b?.min.x ?? Infinity, ul ? ul.x : Infinity)
    const minY = Math.min(b?.min.y ?? Infinity, ul ? ul.y : Infinity)
    const maxX = Math.max(b?.max.x ?? -Infinity, ul && underlaySize ? ul.x + underlaySize.w * ul.mmPerPx : -Infinity)
    const maxY = Math.max(b?.max.y ?? -Infinity, ul && underlaySize ? ul.y + underlaySize.h * ul.mmPerPx : -Infinity)
    if (!Number.isFinite(minX)) {
      const k = Math.min(size.w / 12000, size.h / 9000)
      setView({ x: -size.w / 2 / k, y: -size.h / 2 / k, k })
      return
    }
    const pad = 1500
    const k = Math.min(size.w / (maxX - minX + pad * 2), size.h / (maxY - minY + pad * 2))
    setView({ x: (minX + maxX) / 2 - size.w / 2 / k, y: (minY + maxY) / 2 - size.h / 2 / k, k })
  }, [plan, size, underlaySize])

  useEffect(() => {
    if (!fitted.current && size.w > 0) {
      fitted.current = true
      fit()
    }
  }, [fit, size.w])

  useEffect(() => {
    if (!underlayUrl) return setUnderlaySize(null)
    const img = new Image()
    img.onload = () => setUnderlaySize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = underlayUrl
  }, [underlayUrl])

  // Reset drafts when the tool changes.
  useEffect(() => {
    setChain([])
    setTyped('')
    setCalib({ points: [], length: '' })
  }, [tool])

  const toPlan = useCallback(
    (e: { clientX: number; clientY: number }): Vec2 => {
      const r = svgRef.current!.getBoundingClientRect()
      return { x: (e.clientX - r.left) / view.k + view.x, y: (e.clientY - r.top) / view.k + view.y }
    },
    [view]
  )

  const snap = useCallback(
    (p: Vec2, from?: Vec2 | null) => snapPoint(p, plan.walls, { grid: view.k > 0.2 ? 10 : 50, radius: SNAP_PX / view.k, from, enabled: !snapOff.current }),
    [plan.walls, view.k]
  )

  const finishChain = useCallback(() => {
    setChain([])
    setTyped('')
  }, [])

  const addWall = useCallback(
    (a: Vec2, b: Vec2) => {
      if (dist(a, b) < 50) return
      const w: Wall = { id: uid(), a, b, thickness: wallThickness, height: null, left: null, right: null }
      update((p) => cleanupPlan({ ...p, walls: [...p.walls, w] }))
    },
    [update, wallThickness]
  )

  // Keyboard: drafting keys (Esc, Enter, typed lengths).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      if (e.key === 'Alt') snapOff.current = true
      if (tool.kind === 'wall' && chain.length) {
        if (/^[0-9.]$/.test(e.key)) {
          setTyped((t) => (t + e.key).slice(0, 8))
          e.preventDefault()
          return
        }
        if (e.key === 'Backspace' && typed) {
          setTyped((t) => t.slice(0, -1))
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (e.key === 'Enter' && typed && cursor) {
          const last = chain[chain.length - 1]
          const v = sub(cursor.point, last)
          const L = Math.hypot(v.x, v.y)
          const mm = Number(typed)
          if (L > 0 && mm > 0) {
            const end = { x: Math.round(last.x + (v.x / L) * mm), y: Math.round(last.y + (v.y / L) * mm) }
            addWall(last, end)
            setChain([...chain, end])
          }
          setTyped('')
          e.preventDefault()
          return
        }
      }
      if (e.key === 'Escape') {
        if (chain.length) finishChain()
        else if (tool.kind !== 'select') setTool(SELECT)
        else setSelection(null)
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') snapOff.current = false
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onUp)
    }
  }, [tool, chain, typed, cursor, addWall, finishChain, setTool, setSelection])

  const nearestWall = useCallback(
    (p: Vec2, maxPx = 25) => {
      let best: { w: Wall; t: number; d: number } | null = null
      for (const w of plan.walls) {
        const pr = projectToSegment(p, w.a, w.b)
        if (pr.distance < maxPx / view.k + w.thickness / 2 && (!best || pr.distance < best.d)) best = { w, t: pr.t, d: pr.distance }
      }
      return best
    },
    [plan.walls, view.k]
  )

  // ── Pointer handling ──

  const onWheel = (e: React.WheelEvent) => {
    const p = toPlan(e)
    const factor = Math.exp(-e.deltaY * 0.0015)
    const k = Math.min(2, Math.max(0.005, view.k * factor))
    const r = svgRef.current!.getBoundingClientRect()
    setView({ k, x: p.x - (e.clientX - r.left) / k, y: p.y - (e.clientY - r.top) / k })
  }

  const startPan = (e: React.PointerEvent) => setDrag({ kind: 'pan', start: { x: e.clientX, y: e.clientY }, view })

  const onPointerDown = (e: React.PointerEvent) => {
    svgRef.current?.setPointerCapture(e.pointerId)
    if (e.button === 1 || e.button === 2) return startPan(e)
    const raw = toPlan(e)
    switch (tool.kind) {
      case 'wall': {
        const s = snap(raw, chain[chain.length - 1])
        if (!chain.length) {
          setChain([s.point])
        } else {
          const last = chain[chain.length - 1]
          addWall(last, s.point)
          if (same(s.point, chain[0]) || (s.kind === 'joint' && chain.length > 1)) finishChain()
          else setChain([...chain, s.point])
        }
        setTyped('')
        return
      }
      case 'room':
        setDrag({ kind: 'room', start: snap(raw).point })
        return
      case 'opening': {
        const hit = nearestWall(raw)
        if (!hit) return
        const def = OPENING_DEFAULTS[tool.type]
        const L = wallLength(hit.w)
        const width = Math.min(def.width, L - 40)
        const o: Opening = { id: uid(), wallId: hit.w.id, type: tool.type, offset: clampOpeningOffset(Math.round(hit.t * L), width, L), width, height: def.height, sill: def.sill, flip: false }
        update((p) => ({ ...p, openings: [...p.openings, o] }))
        setSelection({ kind: 'opening', id: o.id })
        return
      }
      case 'place': {
        const item = { ...tool.item, id: uid(), x: Math.round(raw.x), y: Math.round(raw.y) }
        const s = snapItemToWall(item, plan.walls)
        const placed: Item = s ? { ...item, ...s } : item
        update((p) => ({ ...p, items: [...p.items, placed] }))
        setSelection({ kind: 'item', id: placed.id })
        setTool(SELECT)
        return
      }
      case 'calibrate': {
        if (calib.points.length < 2) setCalib({ ...calib, points: [...calib.points, raw] })
        return
      }
      case 'select':
        // Clicks on empty canvas pan and clear the selection.
        setSelection(null)
        startPan(e)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const raw = toPlan(e)
    if (tool.kind === 'wall') setCursor(snap(raw, chain[chain.length - 1]))
    else if (tool.kind === 'room' || tool.kind === 'calibrate') setCursor(tool.kind === 'room' ? snap(raw) : { point: raw, kind: 'none' })
    else setCursor({ point: raw, kind: 'none' })
    if (!drag) return
    switch (drag.kind) {
      case 'pan':
        setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.start.x) / view.k, y: drag.view.y - (e.clientY - drag.start.y) / view.k })
        return
      case 'item': {
        const pos = { x: Math.round(raw.x - drag.offset.x), y: Math.round(raw.y - drag.offset.y) }
        update((p) => ({ ...p, items: p.items.map((i) => (i.id === drag.id ? { ...i, ...pos } : i)) }), { transient: true })
        return
      }
      case 'joint': {
        const others = drag.base.walls.filter((w) => !same(w.a, drag.from) && !same(w.b, drag.from))
        const to = snapPoint(raw, others, { grid: view.k > 0.2 ? 10 : 50, radius: SNAP_PX / view.k, enabled: !e.altKey }).point
        update((p) => {
          const walls = moveJoint(drag.base.walls, drag.from, to)
          return { ...p, walls, rooms: syncRooms(walls, p.rooms) }
        }, { transient: true })
        return
      }
      case 'wall': {
        const grid = view.k > 0.2 ? 10 : 50
        let delta = sub(raw, drag.start)
        // Move perpendicular to the wall only (keeps alignment with neighbours).
        const n = wallLeftNormal({ a: drag.a, b: drag.b })
        const along = delta.x * n.x + delta.y * n.y
        delta = scale(n, e.altKey ? along : Math.round(along / grid) * grid)
        update((p) => {
          let walls = moveJoint(drag.base.walls, drag.a, add(drag.a, delta))
          walls = moveJoint(walls, drag.b, add(drag.b, delta))
          return { ...p, walls, rooms: syncRooms(walls, p.rooms) }
        }, { transient: true })
        return
      }
      case 'opening': {
        update((p) => {
          const o = p.openings.find((x) => x.id === drag.id)
          if (!o) return p
          const hit = nearestWall(raw, 60)
          const w = hit?.w ?? p.walls.find((x) => x.id === o.wallId)
          if (!w) return p
          const L = wallLength(w)
          const t = projectToSegment(raw, w.a, w.b).t
          const offset = clampOpeningOffset(Math.round((t * L) / 10) * 10, o.width, L)
          return { ...p, openings: p.openings.map((x) => (x.id === o.id ? { ...x, wallId: w.id, offset } : x)) }
        }, { transient: true })
        return
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    svgRef.current?.releasePointerCapture(e.pointerId)
    if (!drag) return
    if (drag.kind === 'room') {
      const end = snap(toPlan(e)).point
      if (Math.abs(end.x - drag.start.x) > 300 && Math.abs(end.y - drag.start.y) > 300) {
        const rect = rectangleWalls(drag.start, end, wallThickness)
        update((p) => {
          // Skip edges already covered by an existing wall (rooms drawn against each other).
          const covered = (w: Wall) => p.walls.some((o) => projectToSegment(w.a, o.a, o.b).distance <= EPS && projectToSegment(w.b, o.a, o.b).distance <= EPS)
          return cleanupPlan({ ...p, walls: [...p.walls, ...rect.filter((w) => !covered(w))] })
        })
      }
    } else if (drag.kind === 'item') {
      update(
        (p) => ({
          ...p,
          items: p.items.map((i) => {
            if (i.id !== drag.id) return i
            const s = e.altKey ? null : snapItemToWall(i, p.walls, 150)
            return s ? { ...i, ...s } : i
          }),
        }),
        { transient: true }
      )
      commit()
    } else if (drag.kind === 'joint' || drag.kind === 'wall') {
      update((p) => cleanupPlan(p), { transient: true })
      commit()
    } else if (drag.kind === 'opening') {
      commit()
    }
    setDrag(null)
  }

  const onDoubleClick = () => {
    if (tool.kind === 'wall') finishChain()
  }

  // ── Element handlers (select mode) ──

  const grab = (e: React.PointerEvent, fn: () => void) => {
    if (tool.kind !== 'select' || e.button !== 0) return
    e.stopPropagation()
    svgRef.current?.setPointerCapture(e.pointerId)
    fn()
  }

  const applyCalibration = () => {
    const [p1, p2] = calib.points
    const real = Number(calib.length)
    const ul = plan.underlay
    if (!ul || !p1 || !p2 || !(real > 0)) return
    const f = real / dist(p1, p2)
    update((p) => ({
      ...p,
      underlay: p.underlay && { ...p.underlay, mmPerPx: p.underlay.mmPerPx * f, x: p1.x - (p1.x - p.underlay.x) * f, y: p1.y - (p1.y - p.underlay.y) * f },
    }))
    setCalib({ points: [], length: '' })
    setTool(SELECT)
    fitted.current = false
  }

  // ── Render ──

  const k = view.k
  const px = (n: number) => n / k
  const gridStep = [100, 500, 1000, 5000, 10000].find((s) => s * k >= 10) ?? 10000
  const selectedWall = selection?.kind === 'wall' ? plan.walls.find((w) => w.id === selection.id) : null

  const wallPolys = useMemo(
    () =>
      plan.walls.map((w) => {
        const ext = wallExtensions(w, plan.walls)
        const d = wallDir(w)
        const n = scale(wallLeftNormal(w), w.thickness / 2)
        const a = sub(w.a, scale(d, ext.a))
        const b = add(w.b, scale(d, ext.b))
        return { w, pts: [add(a, n), add(b, n), sub(b, n), sub(a, n)] }
      }),
    [plan.walls]
  )

  const pts = (ps: Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(' ')
  const lastChain = chain[chain.length - 1]

  const cursorStyle =
    tool.kind === 'select' ? (drag?.kind === 'pan' ? 'grabbing' : 'default') : tool.kind === 'place' ? 'copy' : 'crosshair'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f7f7f5] dark:bg-zinc-900">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        style={{ cursor: cursorStyle }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => !drag && setCursor(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="plan-editor"
      >
        <defs>
          <pattern id="plan-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
            <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" className="text-zinc-200 dark:text-zinc-800" />
          </pattern>
        </defs>
        <g transform={`scale(${k}) translate(${-view.x} ${-view.y})`}>
          <rect x={view.x} y={view.y} width={size.w / k} height={size.h / k} fill="url(#plan-grid)" />

          {plan.underlay && underlayUrl && underlaySize && plan.underlay.visible && (
            <image
              href={underlayUrl}
              x={plan.underlay.x}
              y={plan.underlay.y}
              width={underlaySize.w * plan.underlay.mmPerPx}
              height={underlaySize.h * plan.underlay.mmPerPx}
              opacity={plan.underlay.opacity}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Rooms */}
          {plan.rooms.map((r) => {
            const c = interiorPoint(r.points)
            const sel = selection?.kind === 'room' && selection.id === r.id
            const area = roomAreaSqm(r, plan.walls)
            return (
              <g key={r.id}>
                <polygon
                  points={pts(r.points)}
                  className={sel ? 'fill-blue-500/15' : 'fill-white/70 dark:fill-zinc-800/60'}
                  onPointerDown={(e) => grab(e, () => setSelection({ kind: 'room', id: r.id }))}
                />
                {k * 2000 > 40 && (
                  <text x={c.x} y={c.y} textAnchor="middle" fontSize={px(12)} className="pointer-events-none fill-zinc-600 dark:fill-zinc-300">
                    <tspan x={c.x} fontWeight={600}>{r.name}</tspan>
                    <tspan x={c.x} dy={px(14)}>
                      {area.toFixed(1)} m² · {(area * SQFT_PER_SQM).toFixed(0)} sq ft
                    </tspan>
                  </text>
                )}
              </g>
            )
          })}

          {/* Walls */}
          {wallPolys.map(({ w, pts: poly }) => {
            const sel = selectedWall?.id === w.id
            return (
              <polygon
                key={w.id}
                points={pts(poly)}
                className={sel ? 'fill-blue-600' : 'fill-zinc-700 dark:fill-zinc-300'}
                style={{ cursor: tool.kind === 'select' ? 'move' : undefined }}
                onPointerDown={(e) =>
                  grab(e, () => {
                    setSelection({ kind: 'wall', id: w.id })
                    setDrag({ kind: 'wall', id: w.id, start: toPlan(e), base: plan, a: w.a, b: w.b })
                  })
                }
              />
            )
          })}

          {/* Wall dimensions */}
          {k > 0.03 &&
            plan.walls.map((w) => {
              const n = wallLeftNormal(w)
              const mid = scale(add(w.a, w.b), 0.5)
              const pos = add(mid, scale(n, w.thickness / 2 + px(10)))
              let ang = (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI
              if (ang > 90 || ang < -90) ang += 180
              return (
                <text key={`d-${w.id}`} x={pos.x} y={pos.y} fontSize={px(10)} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${pos.x} ${pos.y})`} className="pointer-events-none fill-zinc-500">
                  {Math.round(wallLength(w))}
                </text>
              )
            })}

          {/* Openings */}
          {plan.openings.map((o) => {
            const w = plan.walls.find((x) => x.id === o.wallId)
            if (!w) return null
            const d = wallDir(w)
            const n = wallLeftNormal(w)
            const c = add(w.a, scale(d, o.offset))
            const half = scale(d, o.width / 2)
            const t = scale(n, w.thickness / 2 + 1)
            const s = sub(c, half)
            const e = add(c, half)
            const sel = selection?.kind === 'opening' && selection.id === o.id
            const stroke = sel ? '#2563eb' : '#52525b'
            const hinge = o.flip ? e : s
            const swingDir = scale(n, o.flip ? -1 : 1)
            const leafEnd = add(hinge, scale(swingDir, o.width))
            return (
              <g
                key={o.id}
                style={{ cursor: tool.kind === 'select' ? 'ew-resize' : undefined }}
                onPointerDown={(ev) =>
                  grab(ev, () => {
                    setSelection({ kind: 'opening', id: o.id })
                    setDrag({ kind: 'opening', id: o.id })
                  })
                }
              >
                <polygon points={pts([add(s, t), add(e, t), sub(e, t), sub(s, t)])} className="fill-white dark:fill-zinc-900" stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {o.type === 'window' && (
                  <>
                    <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    <line x1={add(s, scale(t, 0.5)).x} y1={add(s, scale(t, 0.5)).y} x2={add(e, scale(t, 0.5)).x} y2={add(e, scale(t, 0.5)).y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <line x1={sub(s, scale(t, 0.5)).x} y1={sub(s, scale(t, 0.5)).y} x2={sub(e, scale(t, 0.5)).x} y2={sub(e, scale(t, 0.5)).y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  </>
                )}
                {o.type === 'door' && (
                  <>
                    <line x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    <path
                      d={`M ${leafEnd.x} ${leafEnd.y} A ${o.width} ${o.width} 0 0 ${(o.flip ? 1 : 0) ^ (cross2(d, n) > 0 ? 1 : 0)} ${(o.flip ? s : e).x} ${(o.flip ? s : e).y}`}
                      fill="none"
                      stroke={stroke}
                      strokeDasharray="4 3"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}
                {o.type === 'opening' && <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={stroke} strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              </g>
            )
          })}

          {/* Furniture */}
          {showItems &&
            plan.items.map((it) => {
              const sel = selection?.kind === 'item' && selection.id === it.id
              const fp = itemFootprint(it)
              const front = scale(add(fp[2], fp[3]), 0.5)
              return (
                <g
                  key={it.id}
                  style={{ cursor: tool.kind === 'select' ? 'move' : undefined }}
                  onPointerDown={(e) =>
                    grab(e, () => {
                      const p = toPlan(e)
                      setSelection({ kind: 'item', id: it.id })
                      setDrag({ kind: 'item', id: it.id, offset: { x: p.x - it.x, y: p.y - it.y } })
                    })
                  }
                >
                  <polygon
                    points={pts(fp)}
                    className={it.elevation > 1200 ? 'fill-amber-50/60 dark:fill-amber-900/30' : 'fill-white dark:fill-zinc-700'}
                    stroke={sel ? '#2563eb' : '#71717a'}
                    strokeWidth={sel ? 2 : 1}
                    strokeDasharray={it.elevation > 1200 ? '5 3' : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Front edge marker */}
                  <line x1={fp[2].x} y1={fp[2].y} x2={fp[3].x} y2={fp[3].y} stroke={sel ? '#2563eb' : '#a1a1aa'} strokeWidth={3} vectorEffect="non-scaling-stroke" />
                  {Math.min(it.width, it.depth) * k > 36 && (
                    <text x={it.x} y={it.y} fontSize={px(10)} textAnchor="middle" dominantBaseline="middle" className="pointer-events-none fill-zinc-600 dark:fill-zinc-200">
                      {it.name}
                    </text>
                  )}
                  <circle cx={front.x} cy={front.y} r={px(2)} className="pointer-events-none fill-zinc-400" />
                </g>
              )
            })}

          {/* Joint handles for the selected wall */}
          {selectedWall &&
            tool.kind === 'select' &&
            [selectedWall.a, selectedWall.b].map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={px(6)}
                className="fill-white stroke-blue-600"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => grab(e, () => setDrag({ kind: 'joint', from: p, base: plan }))}
              />
            ))}

          {/* Drafting overlays */}
          {tool.kind === 'wall' && lastChain && cursor && (
            <DraftSegment a={lastChain} b={typedEnd(lastChain, cursor.point, typed)} k={k} thickness={wallThickness} label={typed ? `${typed} mm` : formatMm(dist(lastChain, cursor.point))} />
          )}
          {drag?.kind === 'room' && cursor && (
            <rect
              x={Math.min(drag.start.x, cursor.point.x)}
              y={Math.min(drag.start.y, cursor.point.y)}
              width={Math.abs(cursor.point.x - drag.start.x)}
              height={Math.abs(cursor.point.y - drag.start.y)}
              fill="rgba(37,99,235,0.08)"
              stroke="#2563eb"
              strokeWidth={wallThickness}
              strokeOpacity={0.5}
            />
          )}
          {drag?.kind === 'room' && cursor && (
            <text x={(drag.start.x + cursor.point.x) / 2} y={(drag.start.y + cursor.point.y) / 2} fontSize={px(13)} textAnchor="middle" className="pointer-events-none fill-blue-700">
              {Math.round(Math.abs(cursor.point.x - drag.start.x))} × {Math.round(Math.abs(cursor.point.y - drag.start.y))}
            </text>
          )}
          {tool.kind === 'opening' && cursor && (() => {
            const hit = nearestWall(cursor.point)
            if (!hit) return null
            const def = OPENING_DEFAULTS[tool.type]
            const L = wallLength(hit.w)
            const off = clampOpeningOffset(hit.t * L, def.width, L)
            const d = wallDir(hit.w)
            const c = add(hit.w.a, scale(d, off))
            const s = sub(c, scale(d, def.width / 2))
            const e = add(c, scale(d, def.width / 2))
            return <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="#2563eb" strokeWidth={hit.w.thickness} strokeOpacity={0.5} />
          })()}
          {tool.kind === 'place' && cursor && (() => {
            const ghost = { ...tool.item, x: cursor.point.x, y: cursor.point.y }
            const s = snapItemToWall(ghost, plan.walls)
            return <polygon points={pts(itemFootprint(s ? { ...ghost, ...s } : ghost))} fill="rgba(37,99,235,0.12)" stroke="#2563eb" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          })()}
          {tool.kind === 'calibrate' && calib.points.length > 0 && (
            <g>
              {calib.points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={px(5)} fill="#dc2626" />
              ))}
              {(calib.points[1] ?? cursor?.point) && (
                <line x1={calib.points[0].x} y1={calib.points[0].y} x2={(calib.points[1] ?? cursor!.point).x} y2={(calib.points[1] ?? cursor!.point).y} stroke="#dc2626" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              )}
            </g>
          )}
          {cursor && cursor.kind !== 'none' && (tool.kind === 'wall' || tool.kind === 'room') && (
            <circle cx={cursor.point.x} cy={cursor.point.y} r={px(cursor.kind === 'joint' ? 7 : 4)} fill="none" stroke={cursor.kind === 'joint' ? '#16a34a' : cursor.kind === 'wall' ? '#d97706' : '#2563eb'} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          )}
        </g>
      </svg>

      {/* Hints and controls */}
      <div className="pointer-events-none absolute left-3 top-3 max-w-sm rounded-md bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
        {toolHint(tool, chain.length > 0)}
      </div>
      <div className="absolute bottom-3 right-3 flex gap-1">
        <Button size="sm" variant="secondary" onClick={fit}>
          Fit
        </Button>
      </div>
      {tool.kind === 'calibrate' && calib.points.length === 2 && (
        <form
          className="absolute left-1/2 top-14 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-background p-2 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault()
            applyCalibration()
          }}
        >
          <span className="text-sm">Real length of the red line</span>
          <input autoFocus type="number" min={1} className="h-8 w-28 rounded border bg-background px-2 text-sm" value={calib.length} onChange={(e) => setCalib({ ...calib, length: e.target.value })} aria-label="Real length in millimetres" />
          <span className="text-xs text-muted-foreground">mm</span>
          <Button size="sm" type="submit">
            Apply
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setCalib({ points: [], length: '' })}>
            Redo
          </Button>
        </form>
      )}
    </div>
  )
}

const cross2 = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x

function typedEnd(a: Vec2, cursor: Vec2, typed: string): Vec2 {
  const mm = Number(typed)
  if (!typed || !(mm > 0)) return cursor
  const v = sub(cursor, a)
  const L = Math.hypot(v.x, v.y) || 1
  return add(a, scale(v, mm / L))
}

function DraftSegment({ a, b, k, thickness, label }: { a: Vec2; b: Vec2; k: number; thickness: number; label: string }) {
  const mid = scale(add(a, b), 0.5)
  return (
    <g className="pointer-events-none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563eb" strokeOpacity={0.45} strokeWidth={thickness} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563eb" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect x={mid.x - 36 / k} y={mid.y - 22 / k} width={72 / k} height={16 / k} rx={3 / k} fill="#2563eb" />
      <text x={mid.x} y={mid.y - 14 / k} fontSize={11 / k} textAnchor="middle" dominantBaseline="middle" fill="white">
        {label}
      </text>
    </g>
  )
}

function toolHint(tool: Tool, drafting: boolean) {
  switch (tool.kind) {
    case 'wall':
      return drafting
        ? 'Click to add the next corner · type a length + Enter · double-click or Esc to finish · hold Alt to disable snapping'
        : 'Click to start a wall. Snaps to corners, walls, 45° angles and the grid.'
    case 'room':
      return 'Drag to draw a rectangular room (four walls). Rooms are detected automatically from enclosed walls.'
    case 'opening':
      return `Click on a wall to place a ${tool.type}. Esc when done.`
    case 'place':
      return `Click to place ${tool.item.name}. It snaps against nearby walls.`
    case 'calibrate':
      return 'Click the two ends of a known dimension on the plan image, then enter its real length.'
    default:
      return 'Drag walls, corners, doors and furniture · scroll to zoom · drag empty space to pan · R rotates · Del deletes'
  }
}
