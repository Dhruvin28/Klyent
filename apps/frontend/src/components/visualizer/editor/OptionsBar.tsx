import { useState } from 'react'
import { BadgeCheck, Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'
import type { VizOption } from '@/lib/visualizer/types'
import type { VizEditor } from './useVizEditor'

const MAX_OPTIONS = 20

function nextName(options: VizOption[]) {
  for (let i = 0; i < 26; i++) {
    const n = `Option ${String.fromCharCode(65 + i)}`
    if (!options.some((o) => o.name === n)) return n
  }
  return `Option ${options.length + 1}`
}

export function OptionsBar({ editor }: { editor: VizEditor }) {
  const { state, setState } = editor
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<VizOption | null>(null)

  const add = (copyFrom?: VizOption) => {
    if (state.options.length >= MAX_OPTIONS) return
    const id = crypto.randomUUID()
    const option: VizOption = {
      id,
      name: copyFrom ? `${copyFrom.name} copy`.slice(0, 120) : nextName(state.options),
      notes: copyFrom?.notes ?? '',
      assignments: copyFrom ? structuredClone(copyFrom.assignments) : {},
    }
    setState((s) => ({ ...s, options: [...s.options, option], activeOptionId: id }))
  }

  const remove = (o: VizOption) =>
    setState((s) => {
      const options = s.options.filter((x) => x.id !== o.id)
      return {
        ...s,
        options,
        activeOptionId: s.activeOptionId === o.id ? options[0].id : s.activeOptionId,
        approvedOptionId: s.approvedOptionId === o.id ? null : s.approvedOptionId,
      }
    })

  const active = editor.activeOption

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {state.options.map((o) => (
        <div key={o.id} className="flex items-center">
          {renaming === o.id ? (
            <Input
              autoFocus
              defaultValue={o.name}
              className="h-8 w-36 text-sm"
              onBlur={(e) => {
                const name = e.target.value.trim().slice(0, 120)
                if (name) setState((s) => ({ ...s, options: s.options.map((x) => (x.id === o.id ? { ...x, name } : x)) }))
                setRenaming(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
              aria-label="Option name"
            />
          ) : (
            <button
              type="button"
              onClick={() => setState((s) => ({ ...s, activeOptionId: o.id }))}
              onDoubleClick={() => setRenaming(o.id)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
                o.id === state.activeOptionId ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'
              )}
              title="Click to view · double-click to rename"
              data-testid={`viz-option-${o.name}`}
            >
              {state.approvedOptionId === o.id && <BadgeCheck className="h-3.5 w-3.5" />}
              {o.name}
            </button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => add()} disabled={state.options.length >= MAX_OPTIONS} data-testid="viz-add-option">
        <Plus className="h-3.5 w-3.5" /> Option
      </Button>
      {active && (
        <>
          <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => add(active)} disabled={state.options.length >= MAX_OPTIONS} title="Duplicate this option">
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </Button>
          <Button
            variant={state.approvedOptionId === active.id ? 'default' : 'ghost'}
            size="sm"
            className="h-8 gap-1"
            onClick={() => setState((s) => ({ ...s, approvedOptionId: s.approvedOptionId === active.id ? null : active.id }))}
            title="Mark as the approved option"
          >
            <BadgeCheck className="h-3.5 w-3.5" /> {state.approvedOptionId === active.id ? 'Approved' : 'Approve'}
          </Button>
          {state.options.length > 1 && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:text-destructive" onClick={() => setConfirm(active)} aria-label="Delete option">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${confirm?.name}?`}
        description="Its material choices are removed. Surfaces and selections are shared by all options and are kept."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirm) remove(confirm)
          setConfirm(null)
        }}
      />
    </div>
  )
}
