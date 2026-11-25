import { useRef } from 'react'
import { Camera, Copy, Eye, EyeOff, FlipHorizontal, ImageUp, Ruler, RotateCw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberField, RangeField, Segmented } from '@/components/visualizer/common'
import { useToast } from '@/components/ui/toast'
import { designerApi } from '@/api/designer'
import { apiErrorMessage } from '@/api/visualizer'
import { DEFAULT_FINISH, LIGHTING_LOOKS, OPENING_DEFAULTS, PARAMETRIC } from '@/lib/designer/defaults'
import { cleanupPlan, clampOpeningOffset, formatMm, roomAreaSqm, uid, wallDir, wallLength } from '@/lib/designer/geometry'
import { SQFT_PER_SQM } from '@/lib/visualizer/estimate'
import { LIGHTING_PRESETS, OPENING_TYPES, type Item, type LightingPreset, type Opening, type Plan, type Room, type Wall } from '@/lib/designer/types'
import { FinishField, useDesignerLibraries } from './FinishField'
import { SELECT, type Tool } from './tools'
import type { DesignerEditor } from './useDesignerEditor'

interface Props {
  projectId: string
  editor: DesignerEditor
  wallThickness: number
  setWallThickness: (t: number) => void
  setTool: (t: Tool) => void
  /** Saves the current 3D view (only when the 3D view is open). */
  onSaveView: (() => void) | null
  onGoToView: (id: string) => void
}

export function Inspector(props: Props) {
  const { editor } = props
  const { plan, selection } = editor
  const sel = selection
  if (sel?.kind === 'wall') {
    const w = plan.walls.find((x) => x.id === sel.id)
    if (w) return <WallPanel wall={w} {...props} />
  }
  if (sel?.kind === 'opening') {
    const o = plan.openings.find((x) => x.id === sel.id)
    if (o) return <OpeningPanel opening={o} {...props} />
  }
  if (sel?.kind === 'room') {
    const r = plan.rooms.find((x) => x.id === sel.id)
    if (r) return <RoomPanel room={r} {...props} />
  }
  if (sel?.kind === 'item') {
    const it = plan.items.find((x) => x.id === sel.id)
    if (it) return <ItemPanel item={it} {...props} />
  }
  return <ProjectPanel {...props} />
}

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b p-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Header({ title, onDelete, onClose, extra }: { title: string; onDelete: () => void; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 border-b p-3">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
      {extra}
      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={onDelete} aria-label="Delete">
        <Trash2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

// ── Wall ──

function WallPanel({ wall: w, editor }: Props & { wall: Wall }) {
  const { update, setSelection, plan } = editor
  const set = (patch: Partial<Wall>, clean = false) =>
    update((p) => {
      const next = { ...p, walls: p.walls.map((x) => (x.id === w.id ? { ...x, ...patch } : x)) }
      return clean ? cleanupPlan(next) : next
    })
  const L = wallLength(w)
  return (
    <div>
      <Header
        title="Wall"
        onClose={() => setSelection(null)}
        onDelete={() => {
          update((p) => cleanupPlan({ ...p, walls: p.walls.filter((x) => x.id !== w.id) }))
          setSelection(null)
        }}
      />
      <Section title="Size">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Length"
            value={Math.round(L)}
            min={50}
            step={10}
            suffix="mm"
            onChange={(len) => {
              const d = wallDir(w)
              set({ b: { x: Math.round(w.a.x + d.x * len), y: Math.round(w.a.y + d.y * len) } }, true)
            }}
          />
          <NumberField label="Thickness" value={w.thickness} min={50} max={600} step={10} suffix="mm" onChange={(t) => set({ thickness: t }, true)} />
          <NumberField label="Height" value={w.height ?? plan.wallHeight} min={300} max={6000} step={10} suffix="mm" onChange={(h) => set({ height: h === plan.wallHeight ? null : h })} />
        </div>
        <p className="text-[11px] text-muted-foreground">Changing the length moves the end you drew last. Connected walls follow when you drag corners in the plan.</p>
      </Section>
      <Section title="Finishes">
        <FinishField label="Side A (left)" value={w.left} fallback={DEFAULT_FINISH.wall} onChange={(v) => set({ left: v })} />
        <FinishField label="Side B (right)" value={w.right} fallback={DEFAULT_FINISH.wall} onChange={(v) => set({ right: v })} />
        <Button variant="outline" size="sm" className="w-full" onClick={() => set({ right: w.left, left: w.right })}>
          Swap sides
        </Button>
      </Section>
    </div>
  )
}

// ── Opening ──

function OpeningPanel({ opening: o, editor }: Props & { opening: Opening }) {
  const { update, setSelection, plan } = editor
  const w = plan.walls.find((x) => x.id === o.wallId)
  const L = w ? wallLength(w) : 0
  const set = (patch: Partial<Opening>) =>
    update((p) => ({
      ...p,
      openings: p.openings.map((x) => {
        if (x.id !== o.id) return x
        const n = { ...x, ...patch }
        const width = Math.min(n.width, Math.max(100, L - 20))
        return { ...n, width, offset: clampOpeningOffset(n.offset, width, L) }
      }),
    }))
  return (
    <div>
      <Header
        title={OPENING_DEFAULTS[o.type].label}
        onClose={() => setSelection(null)}
        onDelete={() => {
          update((p) => ({ ...p, openings: p.openings.filter((x) => x.id !== o.id) }))
          setSelection(null)
        }}
        extra={
          o.type === 'door' ? (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Flip swing" onClick={() => set({ flip: !o.flip })}>
              <FlipHorizontal className="h-4 w-4" />
            </Button>
          ) : undefined
        }
      />
      <Section title="Type">
        <Segmented
          value={o.type}
          onChange={(t) => set({ type: t, sill: OPENING_DEFAULTS[t].sill, height: OPENING_DEFAULTS[t].height })}
          options={OPENING_TYPES.map((t) => ({ value: t, label: OPENING_DEFAULTS[t].label }))}
        />
      </Section>
      <Section title="Size and position">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Width" value={o.width} min={100} step={10} suffix="mm" onChange={(v) => set({ width: v })} />
          <NumberField label="Height" value={o.height} min={100} step={10} suffix="mm" onChange={(v) => set({ height: v })} />
          <NumberField label="Sill height" value={o.sill} min={0} step={10} suffix="mm" onChange={(v) => set({ sill: v })} />
          <NumberField label="From wall start" value={Math.round(o.offset - o.width / 2)} min={0} step={10} suffix="mm" onChange={(v) => set({ offset: v + o.width / 2 })} />
        </div>
        <p className="text-[11px] text-muted-foreground">Wall length {formatMm(L)}. Drag the opening along the wall in the plan to move it.</p>
      </Section>
    </div>
  )
}

// ── Room ──

function RoomPanel({ room: r, editor }: Props & { room: Room }) {
  const { update, setSelection, plan } = editor
  const set = (patch: Partial<Room>) => update((p) => ({ ...p, rooms: p.rooms.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) }))
  const area = roomAreaSqm(r, plan.walls)
  const roomWalls = (side: (w: Wall) => 'left' | 'right' | null) => (v: Wall['left']) =>
    update((p) => ({
      ...p,
      walls: p.walls.map((w) => {
        const s = side(w)
        return s ? { ...w, [s]: v } : w
      }),
    }))
  // Which side of each wall faces into this room.
  const facing = (w: Wall): 'left' | 'right' | null => {
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }
    const d = wallDir(w)
    const probe = (s: number) => ({ x: mid.x + d.y * s * (w.thickness / 2 + 60), y: mid.y - d.x * s * (w.thickness / 2 + 60) })
    const inside = (p: { x: number; y: number }) => {
      let c = false
      const pts = r.points
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if (pts[i].y > p.y !== pts[j].y > p.y && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c
      }
      return c
    }
    return inside(probe(1)) ? 'left' : inside(probe(-1)) ? 'right' : null
  }
  return (
    <div>
      <div className="flex items-center gap-1 border-b p-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Room</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelection(null)} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Section title="Details">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Name</span>
          <Input value={r.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} className="h-8" />
        </label>
        <p className="text-sm">
          {area.toFixed(2)} m² <span className="text-muted-foreground">· {(area * SQFT_PER_SQM).toFixed(0)} sq ft carpet area</span>
        </p>
      </Section>
      <Section title="Finishes">
        <FinishField label="Floor" value={r.floor} fallback={DEFAULT_FINISH.floor} onChange={(v) => set({ floor: v })} />
        <FinishField label="Ceiling" value={r.ceiling} fallback={DEFAULT_FINISH.ceiling} onChange={(v) => set({ ceiling: v })} />
        <FinishField label="All walls in this room" value={null} fallback={DEFAULT_FINISH.wall} onChange={roomWalls(facing)} />
      </Section>
    </div>
  )
}

// ── Item ──

function ItemPanel({ item: it, editor }: Props & { item: Item }) {
  const { update, setSelection } = editor
  const { models } = useDesignerLibraries()
  const set = (patch: Partial<Item>) => update((p) => ({ ...p, items: p.items.map((x) => (x.id === it.id ? { ...x, ...patch } : x)) }))
  const spec = it.source.kind === 'parametric' ? PARAMETRIC[it.source.type] : null
  const model = it.source.kind === 'model' ? models.get(it.source.modelId) : null
  return (
    <div>
      <Header
        title={it.name}
        onClose={() => setSelection(null)}
        onDelete={() => {
          update((p) => ({ ...p, items: p.items.filter((x) => x.id !== it.id) }))
          setSelection(null)
        }}
        extra={
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Rotate 90° (R)" onClick={() => set({ rotation: (it.rotation + 90) % 360 })}>
              <RotateCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Duplicate (Ctrl+D)"
              onClick={() => {
                const copy = { ...it, id: uid(), x: it.x + 200, y: it.y + 200 }
                update((p) => ({ ...p, items: [...p.items, copy] }))
                setSelection({ kind: 'item', id: copy.id })
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </>
        }
      />
      <Section title="Details">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Name</span>
          <Input value={it.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} className="h-8" />
        </label>
        {model && (
          <p className="text-[11px] text-muted-foreground">
            {[model.brand, model.license, model.price != null ? `₹${model.price.toLocaleString('en-IN')}` : null].filter(Boolean).join(' · ') || 'Uploaded model'}
          </p>
        )}
        {it.source.kind === 'model' && !model && <p className="text-[11px] text-destructive">This model was removed from the catalog.</p>}
      </Section>
      <Section title="Size">
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Width" value={it.width} min={10} step={10} suffix="mm" onChange={(v) => set({ width: v })} />
          <NumberField label="Depth" value={it.depth} min={10} step={10} suffix="mm" onChange={(v) => set({ depth: v })} />
          <NumberField label="Height" value={it.height} min={10} step={10} suffix="mm" onChange={(v) => set({ height: v })} />
        </div>
        {model && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => set({ width: model.widthMm, depth: model.depthMm, height: model.heightMm })}>
            Reset to model size
          </Button>
        )}
      </Section>
      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={it.x} step={10} suffix="mm" onChange={(v) => set({ x: v })} />
          <NumberField label="Y" value={it.y} step={10} suffix="mm" onChange={(v) => set({ y: v })} />
          <NumberField label="Height from floor" value={it.elevation} min={0} step={10} suffix="mm" onChange={(v) => set({ elevation: v })} />
          <NumberField label="Rotation" value={it.rotation} step={15} suffix="°" onChange={(v) => set({ rotation: ((v % 360) + 360) % 360 })} />
        </div>
      </Section>
      {spec && spec.paramSpecs.length > 0 && (
        <Section title="Configuration">
          {spec.paramSpecs.map((ps) => {
            const v = it.params[ps.key] ?? spec.params[ps.key]
            if (ps.kind === 'int')
              return <NumberField key={ps.key} label={ps.label} value={Number(v)} min={ps.min} max={ps.max} onChange={(n) => set({ params: { ...it.params, [ps.key]: Math.max(ps.min ?? 0, Math.min(ps.max ?? 99, Math.round(n))) } })} />
            if (ps.kind === 'bool')
              return (
                <label key={ps.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!v} onChange={(e) => set({ params: { ...it.params, [ps.key]: e.target.checked } })} className="accent-primary" />
                  {ps.label}
                </label>
              )
            return (
              <div key={ps.key} className="space-y-1">
                <span className="text-xs font-medium">{ps.label}</span>
                <Segmented value={String(v)} onChange={(s) => set({ params: { ...it.params, [ps.key]: s } })} options={(ps.options ?? []).map((o) => ({ value: o.value, label: o.label }))} />
              </div>
            )
          })}
        </Section>
      )}
      {spec && (
        <Section title="Finishes">
          {Object.entries(spec.slots).map(([slot, s]) => (
            <FinishField
              key={slot}
              label={s.label}
              value={it.materials[slot] ?? null}
              fallback={s.default}
              onChange={(v) => {
                const materials = { ...it.materials }
                if (v) materials[slot] = v
                else delete materials[slot]
                set({ materials })
              }}
            />
          ))}
        </Section>
      )}
    </div>
  )
}

// ── Project (nothing selected) ──

function ProjectPanel({ projectId, editor, wallThickness, setWallThickness, setTool, onSaveView, onGoToView }: Props) {
  const { plan, update } = editor
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const setLighting = (patch: Partial<Plan['lighting']>) => update((p) => ({ ...p, lighting: { ...p.lighting, ...patch } }))

  const uploadUnderlay = async (file: File) => {
    try {
      const res = await designerApi.uploadUnderlay(projectId, file)
      // Assume a typical scanned plan width of ~12 m until calibrated.
      const mmPerPx = res.width ? 12000 / res.width : 10
      update((p) => ({ ...p, underlay: { assetId: res.assetId, x: 0, y: 0, mmPerPx, opacity: 0.5, visible: true } }))
      setTool({ kind: 'calibrate' })
      toast({ title: 'Plan image added', description: 'Now click the two ends of a known dimension to set the scale.' })
    } catch (err) {
      toast({ title: 'Upload failed', description: apiErrorMessage(err), variant: 'destructive' })
    }
  }

  return (
    <div>
      <Section title="Building">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Wall height" value={plan.wallHeight} min={2000} max={6000} step={10} suffix="mm" onChange={(v) => update((p) => ({ ...p, wallHeight: v }))} />
          <NumberField label="New wall thickness" value={wallThickness} min={50} max={600} step={10} suffix="mm" onChange={setWallThickness} />
        </div>
      </Section>

      <Section title="Lighting">
        <Segmented<LightingPreset> value={plan.lighting.preset} onChange={(v) => setLighting({ preset: v })} options={LIGHTING_PRESETS.map((p) => ({ value: p, label: LIGHTING_LOOKS[p].label }))} />
        <RangeField label="Sun direction" value={plan.lighting.sunAzimuth} min={0} max={359} step={1} format={(v) => `${v}°`} onChange={(v) => setLighting({ sunAzimuth: v })} />
        <RangeField label="Exposure" value={plan.lighting.exposure} min={0.3} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setLighting({ exposure: v })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={plan.lighting.ceilingLights} onChange={(e) => setLighting({ ceilingLights: e.target.checked })} />
          Ceiling lights on
        </label>
        <RangeField label="Light colour" value={plan.lighting.lightTemp} min={2200} max={6500} step={100} format={(v) => `${v} K`} onChange={(v) => setLighting({ lightTemp: v })} />
      </Section>

      <Section
        title="Saved views"
        actions={
          onSaveView ? (
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={onSaveView}>
              <Camera className="h-3.5 w-3.5" /> Save view
            </Button>
          ) : undefined
        }
      >
        {plan.cameras.length ? (
          <ul className="space-y-1">
            {plan.cameras.map((c) => (
              <li key={c.id} className="flex items-center gap-1">
                <button type="button" className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => onGoToView(c.id)}>
                  {c.name}
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" aria-label={`Delete ${c.name}`} onClick={() => update((p) => ({ ...p, cameras: p.cameras.filter((x) => x.id !== c.id) }))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{onSaveView ? 'Frame a shot in 3D and save it to render it later.' : 'Open the 3D view to save camera views for rendering.'}</p>
        )}
      </Section>

      <Section title="Plan image">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadUnderlay(e.target.files[0])} />
        {plan.underlay ? (
          <div className="space-y-2">
            <RangeField label="Opacity" value={plan.underlay.opacity} min={0.1} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((p) => ({ ...p, underlay: p.underlay && { ...p.underlay, opacity: v } }))} />
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setTool({ kind: 'calibrate' })}>
                <Ruler className="h-3.5 w-3.5" /> Set scale
              </Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => update((p) => ({ ...p, underlay: p.underlay && { ...p.underlay, visible: !p.underlay.visible } }))}>
                {plan.underlay.visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {plan.underlay.visible ? 'Hide' : 'Show'}
              </Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => fileRef.current?.click()}>
                <ImageUp className="h-3.5 w-3.5" /> Replace
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 hover:text-destructive"
                onClick={() => {
                  update((p) => ({ ...p, underlay: null }))
                  setTool(SELECT)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Upload a floor plan (JPG/PNG), set its scale from one known dimension, then trace walls over it.</p>
            <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => fileRef.current?.click()}>
              <ImageUp className="h-3.5 w-3.5" /> Upload plan image
            </Button>
          </div>
        )}
      </Section>
    </div>
  )
}
