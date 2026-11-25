import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, GitFork, Loader2, MapPin, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { interiorApi, type InteriorCommand } from '@/api/interior'
import { apiErrorMessage } from '@/api/visualizer'
import { interiorKeys } from '@/hooks/useInterior'
import { Viewport3D, type ViewportApi } from '@/components/designer/Viewport3D'
import type { PickTarget } from '@/lib/designer/scene'
import { EVIDENCE_LABEL, type Box, type Issue, type RevisionDetail, type Severity } from '@/lib/interior/types'
import { SeverityIcon, ValidationChip, useSceneContext } from './common'

interface Props {
  revision: RevisionDetail
  workspaceId: string
  onShowSource: (pageId: string, region: Box | null) => void
  onRevisionChange: (id: string) => void
}

export function ModelTab({ revision, workspaceId, onShowSource, onRevisionChange }: Props) {
  const { ctx, version } = useSceneContext()
  const viewport = useRef<ViewportApi>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<Severity | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const qc = useQueryClient()
  const { toast } = useToast()
  const scene = revision.scene
  const v = revision.validation
  const editable = revision.status === 'draft'

  const issues = useMemo(() => (v?.issues ?? []).filter((i) => filter === 'all' || i.severity === filter), [v, filter])
  const objectName = useMemo(() => {
    const m = new Map<string, string>()
    scene.plan.items.forEach((i) => m.set(i.id, i.name))
    scene.plan.openings.forEach((o) => m.set(o.id, `${o.type} (${Math.round(o.width)} mm)`))
    scene.plan.walls.forEach((w, k) => m.set(w.id, `Wall ${k + 1}`))
    scene.plan.rooms.forEach((r) => m.set(r.id, r.name))
    ;(scene.plan.ceilings ?? []).forEach((c) => m.set(c.id, c.name))
    ;(scene.plan.panels ?? []).forEach((p) => m.set(p.id, p.name))
    ;(scene.plan.fixtures ?? []).forEach((f) => m.set(f.id, f.name))
    m.set('plan', 'Ceiling height')
    return m
  }, [scene])

  const run = async (key: string, commands: InteriorCommand[], ok: string) => {
    setBusy(key)
    try {
      const r = await interiorApi.applyCommands(revision.id, revision.lockVersion, commands)
      await qc.invalidateQueries({ queryKey: interiorKeys.revision(revision.id) })
      await qc.invalidateQueries({ queryKey: interiorKeys.workspace(workspaceId) })
      toast({ title: ok, description: r.rebuildQueued ? 'Rebuilding from the drawings with the new units…' : `${r.validation.summary.blocking} blocking · ${r.validation.summary.warnings} warnings remain` })
    } catch (err) {
      toast({ title: 'Not applied', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const fork = async () => {
    setBusy('fork')
    try {
      const r = await interiorApi.fork(revision.id)
      await qc.invalidateQueries({ queryKey: interiorKeys.workspace(workspaceId) })
      onRevisionChange(r.revisionId)
      toast({ title: 'New draft created', description: 'The frozen revision and its renders stay unchanged.' })
    } catch (err) {
      toast({ title: 'Fork failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const onPick = (t: PickTarget | null) => {
    if (!t) return setSelected(null)
    setSelected(t.kind === 'floor' || t.kind === 'ceiling' ? t.id : t.id)
  }

  const ev = selected ? scene.evidence[selected] : null
  const sources = selected ? (scene.objectSources[selected] ?? []) : []
  const pageName = (id: string) => {
    const s = scene.sources.find((x) => x.pageId === id)
    return s ? `${s.title ?? s.documentName}${s.title ? '' : ` p${s.pageIndex + 1}`}` : 'drawing'
  }
  const deletable = selected && (scene.plan.items.some((i) => i.id === selected) || scene.plan.openings.some((o) => o.id === selected) || (scene.plan.fixtures ?? []).some((f) => f.id === selected) || (scene.plan.panels ?? []).some((p) => p.id === selected) || (scene.plan.ceilings ?? []).some((c) => c.id === selected))
  const assumptionsFor = selected ? scene.assumptions.filter((a) => a.objectIds.includes(selected)) : []

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <span className="font-semibold">Revision {revision.revisionNo}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-xs', editable ? 'bg-slate-100 dark:bg-slate-800' : 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200')}>{editable ? 'Draft' : 'Frozen'}</span>
          {v && <ValidationChip status={v.status} blocking={v.summary.blocking} warnings={v.summary.warnings} />}
          {!editable && (
            <Button size="sm" variant="outline" className="ml-auto h-7 gap-1" onClick={fork} disabled={busy === 'fork'}>
              {busy === 'fork' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitFork className="h-3.5 w-3.5" />} Edit as new draft
            </Button>
          )}
        </div>

        <div className="flex gap-1 text-xs">
          {(['all', 'blocking', 'warning', 'info'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn('rounded-full border px-2 py-0.5 capitalize', filter === f ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}>
              {f} {f !== 'all' && `(${(v?.issues ?? []).filter((i) => i.severity === f).length})`}
            </button>
          ))}
        </div>

        <div className="space-y-2 xl:max-h-[70vh] xl:overflow-y-auto xl:pr-1">
          {!issues.length && <p className="rounded-lg border p-4 text-center text-sm text-muted-foreground">Nothing to resolve here.</p>}
          {issues.map((i) => (
            <IssueCard
              key={i.id}
              issue={i}
              editable={editable}
              busy={busy === i.id}
              names={i.objectIds.map((id) => objectName.get(id) ?? id).slice(0, 6)}
              onSelect={() => i.objectIds[0] && setSelected(i.objectIds[0])}
              onShowSource={i.pageId ? () => onShowSource(i.pageId!, i.region ?? null) : undefined}
              onCommand={(cmds, ok) => run(i.id, cmds, ok)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="relative h-[55vh] overflow-hidden rounded-lg border">
          <Viewport3D ref={viewport} plan={scene.plan} ctx={ctx} ctxVersion={version} selectionId={selected} mode="orbit" onPick={onPick} />
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">Click any object to see where each of its dimensions came from</div>
          <Button size="sm" variant="secondary" className="absolute bottom-3 right-3" onClick={() => viewport.current?.resetView()}>
            Reset view
          </Button>
        </div>

        {selected && (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{objectName.get(selected) ?? selected}</p>
              <div className="flex gap-1">
                {sources.map((s, k) => (
                  <Button key={k} variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onShowSource(s.pageId, s.region)}>
                    <MapPin className="h-3.5 w-3.5" /> {pageName(s.pageId)}
                  </Button>
                ))}
                {editable && deletable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-destructive"
                    onClick={() => {
                      const why = window.prompt('Why remove it? (recorded as a designer decision)', 'False detection – not in the design')
                      if (why && why.trim().length >= 3) void run('delete', [{ type: 'delete_objects', objectIds: [selected], rationale: why.trim() }], 'Removed')
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                )}
              </div>
            </div>
            {!ev && !assumptionsFor.length && <p className="text-xs text-muted-foreground">No recorded evidence (added in the designer or derived).</p>}
            {ev &&
              Object.entries(ev).map(([prop, list]) => (
                <div key={prop} className="text-xs">
                  <p className="font-medium capitalize">{prop.replace(/([A-Z])/g, ' $1')}</p>
                  {list.map((e, k) => (
                    <p key={k} className="flex flex-wrap items-center gap-1 text-muted-foreground">
                      <span className={cn('rounded px-1', e.kind === 'extracted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : e.kind === 'designer_decision' || e.kind === 'designer_edit' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : e.kind === 'default_assumption' ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200')}>
                        {EVIDENCE_LABEL[e.kind]}
                      </span>
                      {e.text && <span>“{e.text}”</span>}
                      {e.value !== undefined && typeof e.value !== 'object' && <span>= {String(e.value)}</span>}
                      {e.note && <span>· {e.note}</span>}
                      {e.pageId && (
                        <button type="button" className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline" onClick={() => onShowSource(e.pageId!, e.region ?? null)}>
                          <ExternalLink className="h-3 w-3" /> {pageName(e.pageId)}
                        </button>
                      )}
                    </p>
                  ))}
                </div>
              ))}
            {assumptionsFor.map((a) => (
              <p key={a.id} className="rounded bg-amber-50 p-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Provisional {a.property}: {a.value} {a.unit} — {a.reason}
              </p>
            ))}
          </div>
        )}

        {scene.buildLog.length > 0 && (
          <details className="rounded-lg border p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Build log</summary>
            <ul className="mt-2 list-disc space-y-0.5 pl-4">
              {scene.buildLog.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

/** Fills the 0-placeholders of a command template with the designer's answer. */
function fill(template: Record<string, unknown>, value: number): InteriorCommand {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(template)) out[k] = v === 0 && k !== 'type' ? value : v
  return out as InteriorCommand
}

function IssueCard({
  issue,
  editable,
  busy,
  names,
  onSelect,
  onShowSource,
  onCommand,
}: {
  issue: Issue
  editable: boolean
  busy: boolean
  names: string[]
  onSelect: () => void
  onShowSource?: () => void
  onCommand: (cmds: InteriorCommand[], ok: string) => void
}) {
  const q = issue.question
  const [value, setValue] = useState(q?.defaultValue !== undefined ? String(q.defaultValue) : '')
  const [choice, setChoice] = useState(q?.options?.[0]?.value ?? '')
  const [why, setWhy] = useState('')
  const accepted = issue.severity === 'info' && issue.acceptKey
  const assumptionId = issue.code === 'ASSUMED_VALUE' ? issue.id.slice('ASSUMED_VALUE:'.length) : null
  const rationale = why.trim() || 'Confirmed by the designer'

  const submit = () => {
    if (!q) return
    if (q.kind === 'number') {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) return
      onCommand([{ ...fill(q.command, n), rationale }], 'Answer recorded')
    } else if (q.kind === 'choice') {
      if ((q.command as { type?: string }).type === 'set_page_units') onCommand([{ ...(q.command as InteriorCommand), units: choice }], 'Units confirmed')
      else if (choice === 'accept') onCommand([{ type: 'accept', key: issue.acceptKey!, rationale }], 'Deviation recorded')
      else onCommand([{ ...(q.command as InteriorCommand), rationale }], 'Change applied')
    } else {
      onCommand([{ type: 'accept', key: issue.acceptKey!, rationale }], 'Confirmed')
    }
  }

  return (
    <div className={cn('space-y-2 rounded-lg border p-3 text-sm', issue.severity === 'blocking' && 'border-red-200 dark:border-red-900', accepted && 'opacity-70')}>
      <div className="flex items-start gap-2">
        <SeverityIcon severity={issue.severity} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-mono text-muted-foreground">{issue.code}</p>
          <p>{issue.message}</p>
          {names.length > 0 && (
            <button type="button" className="mt-0.5 text-xs text-primary hover:underline" onClick={onSelect}>
              {names.join(', ')}
            </button>
          )}
        </div>
        {onShowSource && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onShowSource} title="Show on the drawing">
            <MapPin className="h-4 w-4" />
          </Button>
        )}
      </div>
      {editable && !accepted && (q || issue.acceptKey) && (
        <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
          {q && <p className="text-xs font-medium">{q.label}</p>}
          {q?.kind === 'number' && (
            <div className="flex items-center gap-1.5">
              <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} className="h-8" />
              {q.unit && <span className="text-xs text-muted-foreground">{q.unit}</span>}
            </div>
          )}
          {q?.kind === 'choice' && (
            <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={choice} onChange={(e) => setChoice(e.target.value)}>
              {q.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason / source (e.g. confirmed from section A-A)" className="h-8 text-xs" />
          <div className="flex flex-wrap gap-1.5">
            {q && (
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {q.kind === 'number' ? 'Apply' : q.kind === 'confirm' ? 'Confirm' : 'Apply choice'}
              </Button>
            )}
            {assumptionId && (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onCommand([{ type: 'accept_assumption', assumptionId, rationale }], 'Value confirmed as a designer decision')}>
                Confirm the assumed value
              </Button>
            )}
            {!q && issue.acceptKey && (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || why.trim().length < 3} onClick={() => onCommand([{ type: 'accept', key: issue.acceptKey!, rationale: why.trim() }], 'Acknowledged')}>
                Acknowledge (reason required)
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
