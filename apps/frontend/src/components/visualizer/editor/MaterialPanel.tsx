import { useState } from 'react'
import { ClipboardCopy, ClipboardPaste, CopyPlus, Plus, RotateCw, Shuffle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FINISHES, PANEL_MODES, TILE_LAYOUTS, type PanelMode, type VizAssignment, type VizMaterial, type VizSurface } from '@/lib/visualizer/types'
import { MaterialSwatch, NumberField, RangeField, Segmented } from '../common'
import { LAYOUT_LABELS, MaterialDialog } from '../MaterialDialog'
import type { VizEditor } from './useVizEditor'

const PANEL_LABELS: Record<PanelMode, { label: string; title: string }> = {
  continuous: { label: 'One sheet', title: 'The material runs continuously across all panels' },
  random: { label: 'Per panel', title: 'Each shutter/panel is cut from a different part of the sheet, as fitted on site' },
  bookmatch: { label: 'Book-match', title: 'Neighbouring panels mirror each other across the joint (veneer book-matching)' },
}

export function MaterialPanel({ editor, surface }: { editor: VizEditor; surface: VizSurface | null }) {
  const [picking, setPicking] = useState(false)
  const [dialog, setDialog] = useState<'texture' | 'paint' | null>(null)
  // Copied application settings (kept while switching surfaces).
  const [clipboard, setClipboard] = useState<{ assignment: VizAssignment; material: VizMaterial } | null>(null)
  const [applyTo, setApplyTo] = useState<Set<string> | null>(null)
  const option = editor.activeOption
  if (!surface || !option) {
    return <p className="text-xs text-muted-foreground">Select a surface to choose its material.</p>
  }
  const a = option.assignments[surface.id]
  const material = a ? editor.materials.get(a.materialId) : undefined
  const set = (patch: Partial<VizAssignment>) => editor.updateAssignment(option.id, surface.id, patch)
  const assign = (m: VizMaterial) => {
    // Keep the designer's alignment when swapping materials of the same kind.
    const keep = a && material?.kind === m.kind ? { rotationDeg: a.rotationDeg, offsetXMm: a.offsetXMm, offsetYMm: a.offsetYMm, shading: a.shading, detail: a.detail, smoothing: a.smoothing, exposure: a.exposure } : {}
    editor.updateAssignment(option.id, surface.id, { materialId: m.id, ...keep }, m)
    setPicking(false)
  }
  const materials = [...editor.materials.values()]
  const loading = a && editor.texturesLoading.includes(a.materialId)
  const others = editor.state.surfaces.filter((s) => s.id !== surface.id)
  const paste = () => {
    if (!clipboard) return
    const { assignment, material: m } = clipboard
    editor.updateAssignment(option.id, surface.id, { ...assignment }, m)
  }
  const applyToSurfaces = () => {
    if (!a || !material || !applyTo) return
    for (const id of applyTo) editor.updateAssignment(option.id, id, { ...a }, material)
    setApplyTo(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Material · {surface.name}</h3>
        <span className="text-[11px] text-muted-foreground">{option.name}</span>
      </div>

      <div className="flex items-center gap-3 rounded-lg border p-2">
        <MaterialSwatch material={material} className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          {material ? (
            <>
              <p className="truncate text-sm font-medium">{material.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {material.kind === 'paint'
                  ? `Paint ${material.colorHex}`
                  : `${material.category} · ${Math.round(material.widthMm ?? 0)}×${Math.round(material.heightMm ?? 0)} mm`}
                {material.brand ? ` · ${material.brand}` : ''}
                {material.code ? ` ${material.code}` : ''}
              </p>
              {loading && <p className="text-[11px] text-amber-600">Loading texture…</p>}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No material — the surface shows the original render.</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Button size="sm" variant={material ? 'outline' : 'default'} className="h-7 text-xs" onClick={() => setPicking((p) => !p)} data-testid="viz-choose-material">
            {material ? 'Change' : 'Choose'}
          </Button>
          {material && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => editor.updateAssignment(option.id, surface.id, null)}>
              <X className="mr-1 h-3 w-3" /> Remove
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!a || !material} onClick={() => a && material && setClipboard({ assignment: { ...a }, material })} title="Copy this surface's material and settings">
          <ClipboardCopy className="h-3 w-3" /> Copy
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!clipboard} onClick={paste} title={clipboard ? `Paste ${clipboard.material.name} with its settings` : 'Nothing copied yet'} data-testid="viz-paste-settings">
          <ClipboardPaste className="h-3 w-3" /> Paste
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!a || !material || !others.length} onClick={() => setApplyTo(applyTo ? null : new Set())} title="Use the same material and settings on other surfaces">
          <CopyPlus className="h-3 w-3" /> Apply to…
        </Button>
      </div>
      {applyTo && (
        <div className="space-y-2 rounded-lg border p-2" data-testid="viz-apply-to">
          <p className="text-[11px] text-muted-foreground">Apply {material?.name} with these settings to:</p>
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {others.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={applyTo.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(applyTo)
                    if (e.target.checked) next.add(s.id)
                    else next.delete(s.id)
                    setApplyTo(next)
                  }}
                />
                {s.name}
                {option.assignments[s.id] && <span className="text-[10px] text-muted-foreground">(replaces {editor.materials.get(option.assignments[s.id].materialId)?.name ?? 'material'})</span>}
              </label>
            ))}
          </div>
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-xs" disabled={!applyTo.size} onClick={applyToSurfaces}>Apply to {applyTo.size}</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setApplyTo(new Set(others.map((s) => s.id)))}>All</Button>
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setApplyTo(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {picking && (
        <div className="space-y-2 rounded-lg border p-2">
          <div className="grid max-h-60 grid-cols-4 gap-1.5 overflow-y-auto">
            {materials.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => assign(m)}
                className={cn('group space-y-0.5 rounded-md border p-1 text-left hover:border-primary', m.id === a?.materialId && 'border-primary ring-1 ring-primary')}
                title={m.name}
                data-testid={`viz-material-${m.name}`}
              >
                <MaterialSwatch material={m} className="aspect-square w-full" />
                <p className="truncate text-[10px]">{m.name}</p>
              </button>
            ))}
          </div>
          {materials.length === 0 && <p className="text-xs text-muted-foreground">Your library is empty.</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDialog('texture')}><Plus className="mr-1 h-3 w-3" /> Upload sample</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDialog('paint')}><Plus className="mr-1 h-3 w-3" /> Paint colour</Button>
          </div>
        </div>
      )}

      {a && material && (
        <div className="space-y-3">
          {material.kind === 'paint' && (
            <div className="space-y-1">
              <span className="text-xs font-medium">Apply as</span>
              <Segmented
                value={a.mode ?? 'replace'}
                onChange={(v) => set({ mode: v })}
                options={[
                  { value: 'replace', label: 'New finish', title: 'Paint over: the old surface pattern is removed' },
                  { value: 'recolor', label: 'Recolour', title: 'Keep the original texture (fabric weave, brushed metal, grain) and change only its colour' },
                ]}
              />
              {a.mode === 'recolor' && <p className="text-[11px] text-muted-foreground">Keeps the original surface's texture and highlights — good for sofa fabric, curtains, handles and profiles.</p>}
            </div>
          )}
          {material.kind === 'texture' && (
            <>
              <div className="space-y-1">
                <span className="text-xs font-medium">Pattern</span>
                <Segmented
                  value={a.pattern}
                  onChange={(v) => set({ pattern: v })}
                  options={[
                    { value: 'continuous', label: 'Continuous sheet' },
                    { value: 'tiles', label: 'Tiles / planks' },
                  ]}
                />
              </div>
              {a.pattern === 'tiles' && (
                <div className="space-y-2 rounded-lg border p-2">
                  <Segmented size="xs" value={a.tile.layout} onChange={(v) => set({ tile: { ...a.tile, layout: v } })} options={TILE_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABELS[l] }))} />
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <NumberField label="Grout / joint" value={a.tile.groutMm} min={0} max={50} step={0.5} suffix="mm" onChange={(v) => set({ tile: { ...a.tile, groutMm: Math.max(0, Math.min(50, v)) } })} />
                    <input type="color" className="h-8 w-12 cursor-pointer rounded border" value={a.tile.groutColor} onChange={(e) => set({ tile: { ...a.tile, groutColor: e.target.value } })} aria-label="Grout colour" />
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={a.tile.variation} onChange={(e) => set({ tile: { ...a.tile, variation: e.target.checked } })} /> Vary tile orientation
                  </label>
                </div>
              )}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Grain direction</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant={a.rotationDeg === 0 ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => set({ rotationDeg: 0 })} title="Grain as in the sample photo">As sample</Button>
                    <Button size="sm" variant={a.rotationDeg === 90 ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => set({ rotationDeg: 90 })} title="Grain turned 90°">90°</Button>
                    <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => set({ rotationDeg: ((a.rotationDeg + 45 + 180) % 360) - 180 })} aria-label="Rotate 45°"><RotateCw className="h-3 w-3" /></Button>
                  </div>
                </div>
                <RangeField label="Rotation" value={a.rotationDeg} min={-180} max={180} step={1} onChange={(v) => set({ rotationDeg: v })} format={(v) => `${v}°`} />
              </div>
              <RangeField
                label="Scale"
                value={a.scale}
                min={0.25}
                max={4}
                step={0.01}
                onChange={(v) => set({ scale: v })}
                format={(v) => (Math.abs(v - 1) < 0.005 ? 'True size' : `${v.toFixed(2)}×`)}
                hint="1.00 = true physical size from the sample and the surface width"
              />
              {Math.abs(a.scale - 1) > 0.005 && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => set({ scale: 1 })}>Reset to true size</Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Offset X" value={a.offsetXMm} step={5} suffix="mm" onChange={(v) => set({ offsetXMm: v })} />
                <NumberField label="Offset Y" value={a.offsetYMm} step={5} suffix="mm" onChange={(v) => set({ offsetYMm: v })} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Across separate panels</span>
                  {a.panelMode === 'random' && (
                    <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => set({ panelSeed: ((a.panelSeed ?? 1) % 999_999) + 1 })} title="Try another arrangement">
                      <Shuffle className="h-3 w-3" /> Shuffle
                    </Button>
                  )}
                </div>
                <Segmented
                  size="xs"
                  value={a.panelMode ?? 'continuous'}
                  onChange={(v) => set({ panelMode: v })}
                  options={PANEL_MODES.map((m) => ({ value: m, label: PANEL_LABELS[m].label, title: PANEL_LABELS[m].title }))}
                />
                <p className="text-[11px] text-muted-foreground">Panels are the separately selected parts of this surface, e.g. shutters split by gaps or protected trims.</p>
              </div>
            </>
          )}

          <div className="space-y-1">
            <span className="text-xs font-medium">Finish</span>
            <Segmented value={a.finish} onChange={(v) => set({ finish: v })} options={FINISHES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
            <p className="text-[11px] text-muted-foreground">Approximate: highlights come from the existing render; true reflections cannot be recreated from one image.</p>
          </div>
          {a.finish !== 'matte' && (
            <RangeField
              label="Floor reflection"
              value={a.reflection ?? 0}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set({ reflection: v })}
              format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
              hint="Mirrors what stands on the surface (furniture, walls) below its contact line and fades it out — for glossy tile, marble or polished floors. Approximate."
            />
          )}

          <div className="space-y-2 border-t pt-3">
            <span className="text-xs font-semibold">Lighting from the render</span>
            <RangeField label="Shadow & light strength" value={a.shading} min={0} max={1.5} step={0.05} onChange={(v) => set({ shading: v })} format={(v) => `${Math.round(v * 100)}%`} hint="100% = keep the render's lighting on the new material" />
            <RangeField label="Keep original detail" value={a.detail} min={0} max={1} step={0.05} onChange={(v) => set({ detail: v })} format={(v) => `${Math.round(v * 100)}%`} hint="Brings back grooves, panel lines and fine shadows — too much shows the old material's pattern" />
            <RangeField label="Ignore old texture" value={a.smoothing} min={0} max={1} step={0.05} onChange={(v) => set({ smoothing: v })} format={(v) => `${Math.round(v * 100)}%`} hint="Higher removes more of the old material's grain from the lighting estimate (softens shadow edges)" />
            <RangeField
              label="Light colour"
              value={a.lightColor ?? 0}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set({ lightColor: v })}
              format={(v) => `${Math.round(v * 100)}%`}
              hint="Carries the render's warm lamp pools and cool daylight onto the new material"
            />
            <RangeField label="Brightness" value={a.exposure} min={0.5} max={2} step={0.01} onChange={(v) => set({ exposure: v })} format={(v) => `${v.toFixed(2)}×`} />
          </div>
        </div>
      )}

      <MaterialDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        defaultKind={dialog ?? 'texture'}
        onSaved={(m) => assign(m)}
      />
    </div>
  )
}
