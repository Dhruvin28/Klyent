import { useMemo, useState } from 'react'
import { DoorOpen, Globe, MousePointer2, PenLine, RectangleHorizontal, Ruler, Square, BoxSelect, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { apiErrorMessage } from '@/api/visualizer'
import { useDeleteDesignModel, useDesignAssetUrl, useDesignModels } from '@/hooks/useDesigner'
import { PARAMETRIC, newParametricItem } from '@/lib/designer/defaults'
import { uid } from '@/lib/designer/geometry'
import { PARAMETRIC_TYPES, type DesignModel, type Item } from '@/lib/designer/types'
import { ModelUploadDialog } from './ModelUploadDialog'
import { PolyHavenDialog } from './PolyHavenDialog'
import type { Tool } from './tools'

interface Props {
  tool: Tool
  setTool: (t: Tool) => void
  hasUnderlay: boolean
}

export function modelItem(m: DesignModel): Item {
  return {
    id: uid(),
    name: m.name,
    source: { kind: 'model', modelId: m.id },
    x: 0,
    y: 0,
    elevation: 0,
    rotation: 0,
    width: m.widthMm,
    depth: m.depthMm,
    height: m.heightMm,
    params: {},
    materials: {},
  }
}

export function CatalogPanel({ tool, setTool, hasUnderlay }: Props) {
  const [q, setQ] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [phOpen, setPhOpen] = useState(false)
  const { data: models } = useDesignModels()
  const filteredModels = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (models ?? []).filter((m) => !s || [m.name, m.category, m.brand].some((x) => x?.toLowerCase().includes(s)))
  }, [models, q])
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const g = new Map<string, (typeof PARAMETRIC)[keyof typeof PARAMETRIC][]>()
    for (const t of PARAMETRIC_TYPES) {
      const spec = PARAMETRIC[t]
      if (s && !`${spec.label} ${spec.group}`.toLowerCase().includes(s)) continue
      g.set(spec.group, [...(g.get(spec.group) ?? []), spec])
    }
    return [...g]
  }, [q])

  const toolBtn = (active: boolean, label: string, icon: React.ReactNode, onClick: () => void, shortcut?: string) => (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn('flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] font-medium transition-colors', active ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/60 hover:bg-muted')}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Build</h3>
        <div className="grid grid-cols-3 gap-1.5">
          {toolBtn(tool.kind === 'select', 'Select', <MousePointer2 className="h-4 w-4" />, () => setTool({ kind: 'select' }), 'V')}
          {toolBtn(tool.kind === 'wall', 'Wall', <PenLine className="h-4 w-4" />, () => setTool({ kind: 'wall' }), 'W')}
          {toolBtn(tool.kind === 'room', 'Room', <Square className="h-4 w-4" />, () => setTool({ kind: 'room' }), 'M')}
          {toolBtn(tool.kind === 'opening' && tool.type === 'door', 'Door', <DoorOpen className="h-4 w-4" />, () => setTool({ kind: 'opening', type: 'door' }), 'D')}
          {toolBtn(tool.kind === 'opening' && tool.type === 'window', 'Window', <RectangleHorizontal className="h-4 w-4" />, () => setTool({ kind: 'opening', type: 'window' }), 'N')}
          {toolBtn(tool.kind === 'opening' && tool.type === 'opening', 'Opening', <BoxSelect className="h-4 w-4" />, () => setTool({ kind: 'opening', type: 'opening' }))}
        </div>
        {hasUnderlay && (
          <Button variant="outline" size="sm" className="w-full gap-1" onClick={() => setTool({ kind: 'calibrate' })}>
            <Ruler className="h-3.5 w-3.5" /> Set plan image scale
          </Button>
        )}
      </div>

      <div className="border-b p-3">
        <Input placeholder="Search furniture…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {groups.map(([group, specs]) => (
          <div key={group} className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {specs.map((s) => {
                const active = tool.kind === 'place' && tool.item.source.kind === 'parametric' && tool.item.source.type === s.type
                return (
                  <button
                    key={s.type}
                    type="button"
                    className={cn('rounded-md border px-2 py-1.5 text-left transition-colors', active ? 'border-primary bg-primary/10' : 'hover:border-primary/60 hover:bg-muted')}
                    onClick={() => setTool({ kind: 'place', item: newParametricItem(s.type, { x: 0, y: 0 }) })}
                  >
                    <p className="truncate text-xs font-medium">{s.label}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {s.size.width}×{s.size.depth}×{s.size.height}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My models</h3>
            <span className="text-[10px] text-muted-foreground">{models?.length ?? 0}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setUploadOpen(true)}>
              <Upload className="h-3.5 w-3.5" /> Upload GLB
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setPhOpen(true)}>
              <Globe className="h-3.5 w-3.5" /> Free CC0
            </Button>
          </div>
          {filteredModels.length ? (
            <div className="grid grid-cols-2 gap-1.5">
              {filteredModels.map((m) => (
                <ModelTile key={m.id} model={m} active={tool.kind === 'place' && tool.item.source.kind === 'model' && tool.item.source.modelId === m.id} onPlace={() => setTool({ kind: 'place', item: modelItem(m) })} />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Import free CC0 furniture from Poly Haven, or upload your own GLB models (from SketchUp, Blender or a vendor).</p>
          )}
        </div>
      </div>
      <ModelUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <PolyHavenDialog open={phOpen} onOpenChange={setPhOpen} />
    </div>
  )
}

function ModelTile({ model, active, onPlace }: { model: DesignModel; active: boolean; onPlace: () => void }) {
  const { url } = useDesignAssetUrl(model.thumbAssetId)
  const del = useDeleteDesignModel()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className={cn('group relative overflow-hidden rounded-md border', active ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/60')}>
      <button type="button" className="block w-full text-left" onClick={onPlace} title={`Place ${model.name}`}>
        {url ? <img src={url} alt="" className="aspect-square w-full bg-white object-contain" draggable={false} /> : <div className="aspect-square w-full bg-muted" />}
        <p className="truncate px-1.5 pt-1 text-[11px] font-medium">{model.name}</p>
        <p className="truncate px-1.5 pb-1 text-[10px] text-muted-foreground">
          {model.price != null ? `₹${model.price.toLocaleString('en-IN')}` : model.category}
        </p>
      </button>
      <button
        type="button"
        className="absolute right-1 top-1 hidden rounded bg-background/90 p-1 text-muted-foreground hover:text-destructive group-hover:block"
        aria-label={`Delete ${model.name}`}
        onClick={() => setConfirm(true)}
      >
        <Trash2 className="h-3 w-3" />
      </button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete “${model.name}”?`}
        description="The model is removed from your catalog. Designs that use it will show a grey placeholder box instead."
        confirmLabel="Delete"
        isLoading={del.isPending}
        onConfirm={() =>
          del.mutate(model.id, {
            onSuccess: () => setConfirm(false),
            onError: (err) => toast({ title: 'Delete failed', description: apiErrorMessage(err), variant: 'destructive' }),
          })
        }
      />
    </div>
  )
}
