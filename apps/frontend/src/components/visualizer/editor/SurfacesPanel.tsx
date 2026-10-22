import { useMemo, useState } from 'react'
import { Eraser, Expand, Lock, Magnet, ScanSearch, Shrink, Sparkle, Square, Trash2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'
import { closeMask, growMask, maskArea, maskBBox } from '@/lib/visualizer/mask'
import { estimateAspectRatio, isConvexQuad, quadFromTuples } from '@/lib/visualizer/homography'
import { SURFACE_TYPES, type SurfaceType, type VizSurface } from '@/lib/visualizer/types'
import { SQFT_PER_SQM } from '@/lib/visualizer/estimate'
import { NumberField, RangeField, surfaceColor } from '../common'
import { RoomDetectDialog } from './RoomDetectDialog'
import { DEFAULT_SIZE, MAX_SURFACES } from './surfaceDefaults'
import { clampMm } from './EditorCanvas'

import type { VizEditor } from './useVizEditor'

export function SurfacesPanel({
  editor,
  activeId,
  onSelect,
  onEditCorners,
}: {
  editor: VizEditor
  activeId: string | null
  onSelect: (id: string | null) => void
  onEditCorners: () => void
}) {
  const { state, setState } = editor
  const { toast } = useToast()
  const [confirmDelete, setConfirmDelete] = useState<VizSurface | null>(null)
  const [detectOpen, setDetectOpen] = useState(false)
  const [fitting, setFitting] = useState(false)
  const active = state.surfaces.find((s) => s.id === activeId) ?? null

  const addSurface = (type: SurfaceType) => {
    if (state.surfaces.length >= MAX_SURFACES) return
    const id = crypto.randomUUID()
    const n = state.surfaces.filter((s) => s.type === type).length + 1
    const [w, h] = DEFAULT_SIZE[type]
    const surface: VizSurface = {
      id,
      name: `${type[0].toUpperCase() + type.slice(1)}${n > 1 ? ` ${n}` : ''}`,
      type,
      maskAssetId: null,
      quad: null,
      widthMm: w,
      heightMm: h,
      heightManual: false,
      feather: 1,
      edgeSnap: true,
    }
    setState((s) => ({ ...s, surfaces: [...s.surfaces, surface] }))
    editor.ensureMask(id)
    onSelect(id)
  }

  const removeSurface = (surface: VizSurface) => {
    setState((s) => ({
      ...s,
      surfaces: s.surfaces.filter((x) => x.id !== surface.id),
      options: s.options.map((o) => {
        const assignments = { ...o.assignments }
        delete assignments[surface.id]
        return { ...o, assignments }
      }),
    }))
    editor.removeMask(surface.id)
    if (activeId === surface.id) onSelect(null)
  }

  const stats = useMemo(() => {
    if (!active) return null
    const m = editor.getMask(active.id)
    if (!m) return null
    const area = maskArea(m)
    return { area, pct: (area / (editor.W * editor.H)) * 100, bbox: maskBBox(m) }
  }, [active, editor, editor.maskTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateDims = (patch: Partial<VizSurface>) => {
    if (!active) return
    const next = { ...active, ...patch }
    next.widthMm = clampMm(next.widthMm)
    next.heightMm = clampMm(next.heightMm)
    if (!next.heightManual && next.quad && 'widthMm' in patch) {
      const q = quadFromTuples(next.quad)
      if (isConvexQuad(q)) next.heightMm = clampMm(Math.round(next.widthMm / estimateAspectRatio(q, editor.W, editor.H)))
    }
    editor.updateSurface(active.id, next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Surfaces</h3>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 gap-1 px-2 text-xs"
          onClick={() => setDetectOpen(true)}
          disabled={!editor.ready || state.surfaces.length >= MAX_SURFACES}
          title="Find walls, floor, ceiling, wardrobes, cabinets, doors and countertops automatically"
          data-testid="viz-detect-room"
        >
          <ScanSearch className="h-3.5 w-3.5" /> Detect
        </Button>
        <select
          className="h-7 rounded-md border bg-background px-1.5 text-xs"
          value=""
          onChange={(e) => e.target.value && addSurface(e.target.value as SurfaceType)}
          aria-label="Add surface"
          disabled={state.surfaces.length >= MAX_SURFACES}
          title={state.surfaces.length >= MAX_SURFACES ? `Maximum ${MAX_SURFACES} surfaces` : undefined}
          data-testid="viz-add-surface"
        >
          <option value="">+ Add surface</option>
          {SURFACE_TYPES.map((t) => (
            <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>

      {state.surfaces.length === 0 && (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Click <span className="font-medium text-foreground">Detect</span> to find the room’s surfaces automatically, or add one (e.g. Wardrobe) and select it on the render with AI select, Smart select, Polygon or Brush.
        </div>
      )}

      <ul className="space-y-1">
        {state.surfaces.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              data-testid="viz-surface-row"
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors',
                s.id === activeId ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-accent'
              )}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: surfaceColor(i) }} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {editor.activeOption?.assignments[s.id] ? (
                <span className="text-[10px] text-muted-foreground">assigned</span>
              ) : (
                <span className="text-[10px] text-amber-600">no material</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {active && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={active.name}
              onChange={(e) => editor.updateSurface(active.id, { name: e.target.value.slice(0, 120) || 'Surface' })}
              className="h-8 text-sm"
              aria-label="Surface name"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 hover:text-destructive" onClick={() => setConfirmDelete(active)} aria-label="Delete surface">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={active.type}
            onChange={(e) => editor.updateSurface(active.id, { type: e.target.value as SurfaceType })}
            aria-label="Surface type"
          >
            {SURFACE_TYPES.map((t) => (
              <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
            ))}
          </select>

          <div className="text-[11px] text-muted-foreground" data-testid="viz-surface-area">
            {stats && stats.area > 0 ? (
              <>
                {(() => {
                  const m = editor.areas.get(active.id)
                  return m && m.areaSqm > 0 ? (
                    <span className="font-medium text-foreground">
                      {(m.areaSqm * SQFT_PER_SQM).toLocaleString('en-IN', { maximumFractionDigits: 1 })} sq ft ({m.areaSqm.toFixed(2)} m²) ·{' '}
                    </span>
                  ) : null
                })()}
                {stats.pct.toFixed(1)}% of render
              </>
            ) : (
              'Nothing selected yet'
            )}
          </div>

          <div className="grid grid-cols-5 gap-1">
            <MaskOp label="Grow" icon={Expand} onClick={() => editor.editMask(active.id, (m) => m.data.set(growMask(m, 1).data))} />
            <MaskOp label="Shrink" icon={Shrink} onClick={() => editor.editMask(active.id, (m) => m.data.set(growMask(m, -1).data))} />
            <MaskOp label="Fill holes" icon={Sparkle} onClick={() => editor.editMask(active.id, (m) => m.data.set(closeMask(m, 3).data))} />
            <MaskOp label="Snap" icon={Magnet} onClick={() => void editor.snapSelection(active.id)} title="Snap the outline to edges in the render (±3px)" />
            <MaskOp label="Clear" icon={Eraser} onClick={() => editor.editMask(active.id, (m) => m.data.fill(0))} />
          </div>

          <label className="flex items-center gap-2 text-xs" title="Refines the soft edge against the render on every preview and export (stays within 3px of the selection)">
            <input type="checkbox" checked={!!active.edgeSnap} onChange={(e) => editor.updateSurface(active.id, { edgeSnap: e.target.checked })} data-testid="viz-edge-snap" />
            Snap soft edges to the render
          </label>

          <RangeField label="Edge softness" value={active.feather} min={0} max={6} step={0.25} onChange={(v) => editor.updateSurface(active.id, { feather: v })} format={(v) => `${v}px`} hint="Blends the new material into the outline. 0.5–1.5px matches rendered anti-aliasing." />

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Real size & perspective</span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={fitting || !stats || stats.area === 0}
                  onClick={async () => {
                    setFitting(true)
                    try {
                      const ok = await editor.fitCorners(active.id)
                      toast(ok ? { title: 'Corners fitted to the selection', description: 'Enter the real width of this rectangle so scale and quantities are right.' } : { title: 'The selection is not four-sided — place the corners by hand', variant: 'destructive' })
                    } finally {
                      setFitting(false)
                    }
                  }}
                  title="Fit the perspective corners to the selection's outline"
                  data-testid="viz-autofit"
                >
                  <Sparkle className="h-3 w-3" /> Auto-fit
                </Button>
                <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onEditCorners}>
                  <Square className="h-3 w-3" /> Edit
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Drag the 4 corners onto a rectangle on this plane (e.g. the wardrobe front), then enter its real width.
              {!active.quad && ' Currently using the selection’s bounding box (no perspective).'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Width" value={active.widthMm} min={1} suffix="mm" onChange={(v) => updateDims({ widthMm: v })} />
              <div className="relative">
                <NumberField label="Height" value={active.heightMm} min={1} suffix="mm" onChange={(v) => updateDims({ heightMm: v, heightManual: true })} />
                <button
                  type="button"
                  className="absolute right-0 top-0 text-muted-foreground hover:text-foreground"
                  onClick={() => updateDims({ heightManual: !active.heightManual, widthMm: active.widthMm })}
                  title={active.heightManual ? 'Height entered manually — click to estimate from perspective' : 'Height estimated from perspective — click to lock'}
                  aria-label="Toggle height estimation"
                >
                  {active.heightManual ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                </button>
              </div>
            </div>
            {!active.heightManual && active.quad && <p className="text-[11px] text-muted-foreground">Height is estimated from the corner perspective. Type a value to override.</p>}
            {active.quad && (
              <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => editor.updateSurface(active.id, { quad: null })}>
                Reset corners to selection bounds
              </Button>
            )}
          </div>
        </div>
      )}

      <RoomDetectDialog open={detectOpen} onOpenChange={setDetectOpen} editor={editor} onCreated={(id) => onSelect(id)} />
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.name}”?`}
        description="Its selection and its material in every option are removed."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDelete) removeSurface(confirmDelete)
          setConfirmDelete(null)
        }}
      />
    </div>
  )
}

function MaskOp({ label, icon: Icon, onClick, title }: { label: string; icon: typeof Expand; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[10px] hover:bg-accent" title={title ?? label}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
