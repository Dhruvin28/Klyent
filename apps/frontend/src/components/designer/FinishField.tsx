import { createContext, useContext, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MaterialSwatch, RangeField, Segmented } from '@/components/visualizer/common'
import { cn } from '@/lib/utils'
import { COLOR_PRESETS } from '@/lib/designer/defaults'
import type { DesignModel, MatRef } from '@/lib/designer/types'
import type { VizMaterial } from '@/lib/visualizer/types'

export interface DesignerLibraries {
  materials: VizMaterial[]
  materialMap: Map<string, VizMaterial>
  models: Map<string, DesignModel>
}

export const DesignerLibrariesContext = createContext<DesignerLibraries>({ materials: [], materialMap: new Map(), models: new Map() })

export const useDesignerLibraries = () => useContext(DesignerLibrariesContext)

export function FinishSwatch({ value, className }: { value: MatRef; className?: string }) {
  const { materialMap } = useDesignerLibraries()
  if (value.kind === 'library') return <MaterialSwatch material={materialMap.get(value.materialId)} className={className} />
  return <div className={cn('rounded border', className)} style={{ backgroundColor: value.hex }} />
}

export function finishLabel(value: MatRef, materialMap: Map<string, VizMaterial>) {
  if (value.kind === 'color') return value.hex.toUpperCase()
  const m = materialMap.get(value.materialId)
  return m ? [m.name, m.code].filter(Boolean).join(' · ') : 'Missing material'
}

/** A surface finish control: swatch + name, opens the picker; finish (gloss) slider below. */
export function FinishField({ label, value, fallback, onChange }: { label: string; value: MatRef | null; fallback: MatRef; onChange: (v: MatRef | null) => void }) {
  const [open, setOpen] = useState(false)
  const { materialMap } = useDesignerLibraries()
  const v = value ?? fallback
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      <button type="button" className="flex w-full items-center gap-2 rounded-md border bg-background p-1.5 text-left text-sm hover:border-primary" onClick={() => setOpen(true)}>
        <FinishSwatch value={v} className="h-8 w-8 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{value ? finishLabel(v, materialMap) : 'Default'}</span>
      </button>
      {value && (
        <RangeField
          label="Finish (matte → gloss)"
          value={Math.round((1 - value.roughness) * 100)}
          min={0}
          max={100}
          step={1}
          format={(g) => `${g}%`}
          onChange={(g) => onChange({ ...value, roughness: Math.round((1 - g / 100) * 100) / 100 })}
        />
      )}
      {value?.kind === 'library' && (
        <RangeField label="Pattern rotation" value={value.rotation ?? 0} min={0} max={180} step={90} format={(r) => `${r}°`} onChange={(r) => onChange({ ...value, rotation: r })} />
      )}
      <FinishPicker open={open} onOpenChange={setOpen} title={label} value={value} onPick={(m) => onChange(m)} />
    </div>
  )
}

export function FinishPicker({
  open,
  onOpenChange,
  title,
  value,
  onPick,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  value: MatRef | null
  onPick: (v: MatRef | null) => void
}) {
  const { materials } = useDesignerLibraries()
  const [tab, setTab] = useState<'library' | 'colour'>(materials.length ? 'library' : 'colour')
  const [q, setQ] = useState('')
  const [hex, setHex] = useState(value?.kind === 'color' ? value.hex : '#c8b9a6')
  const roughness = value?.roughness ?? 0.7
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? materials.filter((m) => [m.name, m.brand, m.code, m.category].some((x) => x?.toLowerCase().includes(s))) : materials
  }, [materials, q])

  const pick = (v: MatRef | null) => {
    onPick(v)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Laminates, tiles and paints come from your Visualizer material library and keep their real-world size.</DialogDescription>
        </DialogHeader>
        <div className="max-w-xs">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'library', label: `Library (${materials.length})` },
              { value: 'colour', label: 'Colour' },
            ]}
          />
        </div>
        {tab === 'library' ? (
          <div className="space-y-3">
            <Input placeholder="Search name, brand, code…" value={q} onChange={(e) => setQ(e.target.value)} />
            {filtered.length ? (
              <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
                {filtered.map((m) => {
                  const active = value?.kind === 'library' && value.materialId === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={cn('relative space-y-1 rounded-md border p-1 text-left hover:border-primary', active && 'border-primary ring-2 ring-primary/30')}
                      onClick={() => pick({ kind: 'library', materialId: m.id, roughness: m.category === 'tile' || m.category === 'stone' ? 0.35 : m.kind === 'paint' ? 0.9 : 0.6 })}
                    >
                      <MaterialSwatch material={m} className="aspect-square w-full" />
                      <p className="truncate text-[11px] font-medium">{m.name}</p>
                      <p className="truncate text-[10px] capitalize text-muted-foreground">{m.category}</p>
                      {active && <Check className="absolute right-1.5 top-1.5 h-4 w-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {materials.length ? 'No materials match.' : 'Your library is empty. Add laminate, tile and paint samples in Visualizer → Material library.'}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-7 gap-2">
              {COLOR_PRESETS.map((c) => (
                <button key={c.hex} type="button" title={c.name} className="aspect-square rounded-md border hover:ring-2 hover:ring-primary" style={{ backgroundColor: c.hex }} onClick={() => pick({ kind: 'color', hex: c.hex, roughness })} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-background" aria-label="Custom colour" />
              <Input value={hex} onChange={(e) => setHex(e.target.value)} className="w-32 font-mono" />
              <Button disabled={!/^#[0-9a-f]{6}$/i.test(hex)} onClick={() => pick({ kind: 'color', hex: hex.toLowerCase(), roughness })}>
                Use colour
              </Button>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => pick(null)}>
            Reset to default
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
