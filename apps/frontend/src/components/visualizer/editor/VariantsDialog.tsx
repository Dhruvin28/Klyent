import { useEffect, useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { VizOption } from '@/lib/visualizer/types'
import { MaterialSwatch } from '../common'
import { defaultAssignment, type VizEditor } from './useVizEditor'

export const MAX_OPTIONS = 20

/**
 * Quick variants: pick one surface and several materials; one option is created per
 * material, copied from the current option so every other surface stays as it is.
 */
export function VariantsDialog({ open, onOpenChange, editor }: { open: boolean; onOpenChange: (o: boolean) => void; editor: VizEditor }) {
  const { toast } = useToast()
  const { state } = editor
  const [surfaceId, setSurfaceId] = useState<string>('')
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (!open) return
    setSurfaceId(state.surfaces[0]?.id ?? '')
    setPicked([])
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const base = editor.activeOption
  const room = MAX_OPTIONS - state.options.length
  const materials = useMemo(() => [...editor.materials.values()], [editor.materials])

  const create = () => {
    if (!base || !surfaceId || !picked.length) return
    const current = base.assignments[surfaceId]
    const currentMat = current ? editor.materials.get(current.materialId) : undefined
    const used = new Set(state.options.map((o) => o.name))
    const created: VizOption[] = []
    for (const id of picked.slice(0, room)) {
      const m = editor.materials.get(id)
      if (!m) continue
      // Same kind of material: keep the designer's alignment and lighting settings.
      const assignment =
        current && currentMat?.kind === m.kind ? { ...defaultAssignment(m), ...current, materialId: m.id, pattern: defaultAssignment(m).pattern, tile: defaultAssignment(m).tile } : defaultAssignment(m)
      let name = m.name.slice(0, 120)
      for (let k = 2; used.has(name); k++) name = `${m.name.slice(0, 110)} (${k})`
      used.add(name)
      created.push({ id: crypto.randomUUID(), name, notes: base.notes, assignments: { ...structuredClone(base.assignments), [surfaceId]: assignment } })
    }
    if (!created.length) return
    editor.setState((s) => ({ ...s, options: [...s.options, ...created], activeOptionId: created[0].id }))
    toast({ title: `${created.length} option${created.length > 1 ? 's' : ''} created`, description: 'Open Compare to review them side by side.' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="h-5 w-5" /> Quick variants</DialogTitle>
          <DialogDescription>
            Try several materials on one surface at once. Each becomes a new option, copied from “{base?.name}” with only that surface changed.
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Surface</span>
          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={surfaceId} onChange={(e) => setSurfaceId(e.target.value)} aria-label="Surface">
            {state.surfaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="space-y-1">
          <span className="text-xs font-medium">Materials ({picked.length} selected, up to {Math.max(0, room)})</span>
          <div className="grid max-h-[45vh] grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6" data-testid="viz-variants-grid">
            {materials.map((m) => {
              const on = picked.includes(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : p.length < room ? [...p, m.id] : p))}
                  className={cn('space-y-0.5 rounded-md border p-1 text-left hover:border-primary', on && 'border-primary ring-2 ring-primary')}
                  title={m.name}
                  aria-pressed={on}
                >
                  <MaterialSwatch material={m} className="aspect-square w-full" />
                  <p className="truncate text-[10px]">{m.name}</p>
                </button>
              )
            })}
          </div>
          {!materials.length && <p className="text-xs text-muted-foreground">Your material library is empty.</p>}
        </div>
        <DialogFooter>
          {room <= 0 && <span className="mr-auto text-xs text-amber-600">This project already has {MAX_OPTIONS} options.</span>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={!surfaceId || !picked.length || room <= 0} data-testid="viz-variants-create">
            Create {Math.min(picked.length, Math.max(0, room)) || ''} option{picked.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
