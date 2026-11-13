import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Box as BoxIcon, CheckCircle2, Download, FileCheck2, GitFork, Hammer, Loader2, Lock, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { interiorApi } from '@/api/interior'
import { apiErrorMessage } from '@/api/visualizer'
import { interiorKeys } from '@/hooks/useInterior'
import type { Check, RevisionDetail, WorkspaceSummary } from '@/lib/interior/types'
import { ValidationChip, shortHash } from './common'

const OUTCOME: Record<Check['outcome'], string> = {
  pass: 'text-emerald-700 dark:text-emerald-400',
  fail: 'text-red-700 dark:text-red-400',
  missing: 'text-amber-700 dark:text-amber-400',
  accepted: 'text-violet-700 dark:text-violet-400',
  warning: 'text-amber-700 dark:text-amber-400',
}

export function ApproveTab({ summary, revision, onRevisionChange }: { summary: WorkspaceSummary; revision: RevisionDetail; onRevisionChange: (id: string) => void }) {
  const ws = summary.workspace
  const qc = useQueryClient()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const v = revision.validation
  const { data: designer } = useQuery({ queryKey: ['interior', 'designer-link', ws.id, ws.designerPushedRevision], queryFn: () => interiorApi.designerLink(ws.id) })
  const { data: decisions } = useQuery({ queryKey: interiorKeys.decisions(ws.id), queryFn: () => interiorApi.decisions(ws.id) })
  const approval = revision.approvals.find((a) => a.sceneHash === revision.sceneHash)
  const validForApproval = !!v && revision.status === 'frozen' && v.sceneHash === revision.sceneHash

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: interiorKeys.revision(revision.id) })
    await qc.invalidateQueries({ queryKey: interiorKeys.workspace(ws.id) })
    await qc.invalidateQueries({ queryKey: interiorKeys.decisions(ws.id) })
  }
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try {
      await fn()
      await refresh()
      toast({ title: ok })
    } catch (err) {
      toast({ title: 'Action failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const pushDesigner = async (force = false) => {
    setBusy('designer')
    try {
      const r = await interiorApi.pushToDesigner(revision.id, force)
      await refresh()
      toast({ title: 'Opened in the 3D Designer', description: 'Edit freely there, then sync the edits back as a new draft revision.' })
      window.open(`/designer/${r.designProjectId}`, '_blank', 'noopener')
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code
      if (code === 'DESIGNER_CHANGED' && window.confirm('The design was edited in the designer since it was last updated from here. Overwrite those edits with this revision?')) {
        setBusy(null)
        return pushDesigner(true)
      }
      toast({ title: 'Could not open in the designer', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const downloadReport = async () => {
    setBusy('pdf')
    try {
      const report = await interiorApi.report(revision.id)
      const { renderReportPdf } = await import('./reportPdf')
      const blob = await renderReportPdf(report)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${ws.name.replace(/[^\w-]+/g, '_')}_R${revision.revisionNo}_validation.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch (err) {
      toast({ title: 'Report failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const grouped = (v?.checks ?? []).reduce<Record<string, Check[]>>((acc, c) => ((acc[c.category] ??= []).push(c), acc), {})

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Revisions</h3>
        <div className="divide-y rounded-lg border">
          {summary.revisions.map((r) => {
            const appr = summary.approvals.find((a) => a.revisionId === r.id && a.sceneHash === r.sceneHash)
            return (
              <button key={r.id} type="button" onClick={() => onRevisionChange(r.id)} className={cn('block w-full p-2.5 text-left text-xs', r.id === revision.id ? 'bg-primary/5' : 'hover:bg-muted')}>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  R{r.revisionNo}
                  {r.status === 'frozen' && <Lock className="h-3 w-3 text-muted-foreground" />}
                  {appr && <CheckCircle2 className={cn('h-3.5 w-3.5', appr.mode === 'final' ? 'text-emerald-600' : 'text-amber-600')} />}
                  <span className="font-normal text-muted-foreground">· {r.origin.replace('_', ' ')}</span>
                </p>
                <p className="text-muted-foreground">
                  {format(new Date(r.createdAt), 'd MMM, HH:mm')}
                  {r.summary && ` · ${r.summary.walls} walls · ${r.summary.items} items`}
                  {appr && ` · ${appr.mode === 'final' ? 'approved' : 'draft-approved'}`}
                </p>
              </button>
            )
          })}
        </div>

        <h3 className="pt-2 text-sm font-semibold">3D Designer</h3>
        <div className="space-y-2 rounded-lg border p-3 text-xs">
          {designer ? (
            <p>
              Linked design <Link className="text-primary underline" to={`/designer/${designer.id}`}>open</Link>
              {designer.editedSincePush && <span className="text-amber-700 dark:text-amber-400"> · edited since last update</span>}
            </p>
          ) : (
            <p className="text-muted-foreground">Open a revision in the designer to adjust walls, furniture and finishes by hand.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy === 'designer'} onClick={() => pushDesigner()}>
              {busy === 'designer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BoxIcon className="h-3.5 w-3.5" />} Open R{revision.revisionNo} in designer
            </Button>
            {designer && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                disabled={busy === 'sync'}
                onClick={() =>
                  act(
                    'sync',
                    async () => {
                      const r = await interiorApi.syncFromDesigner(revision.id)
                      onRevisionChange(r.revisionId)
                    },
                    'Designer edits imported as a new draft'
                  )
                }
              >
                <Upload className="h-3.5 w-3.5" /> Sync designer edits
              </Button>
            )}
          </div>
          <p className="text-muted-foreground">Rebuilding from the drawings re-applies your recorded answers, but not free-hand designer edits.</p>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={busy === 'build'} onClick={() => act('build', () => interiorApi.build(ws.id), 'Rebuild queued')}>
            <Hammer className="h-3.5 w-3.5" /> Rebuild from drawings
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <span className="font-semibold">R{revision.revisionNo}</span>
          <span className="text-xs text-muted-foreground">scene {shortHash(revision.sceneHash)}</span>
          {v && <ValidationChip status={v.status} blocking={v.summary.blocking} warnings={v.summary.warnings} />}
          {v && <span className="text-xs text-muted-foreground">{v.summary.checksPassed}/{v.summary.checksTotal} checks · {v.policy.mode} policy</span>}
          {approval && (
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', approval.mode === 'final' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200')}>
              {approval.mode === 'final' ? 'Approved (final)' : 'Approved as DRAFT'} · {format(new Date(approval.approvedAt), 'd MMM HH:mm')}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={!!busy} onClick={() => act('validate', () => interiorApi.validate(revision.id), 'Validated')}>
              {busy === 'validate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Re-validate
            </Button>
            {revision.status === 'draft' ? (
              <Button size="sm" className="h-8 gap-1" disabled={!!busy} onClick={() => act('freeze', () => interiorApi.freeze(revision.id, revision.lockVersion), 'Revision frozen')}>
                {busy === 'freeze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Freeze
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-8 gap-1" disabled={!!busy} onClick={() => act('fork', async () => onRevisionChange((await interiorApi.fork(revision.id)).revisionId), 'New draft created')}>
                <GitFork className="h-4 w-4" /> Fork to edit
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy === 'pdf'} onClick={downloadReport}>
              {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Validation report
            </Button>
          </div>
        </div>

        {revision.status === 'frozen' && !approval && (
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" /> Approve this exact revision
            </p>
            <p className="text-xs text-muted-foreground">
              Approval binds scene {shortHash(revision.sceneHash)} and validation run {v ? v.id.slice(0, 8) : '—'}. Any later edit creates a new draft and needs a new approval; renders of this revision stay attached to it.
            </p>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approval note (optional)" className="h-8" />
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" className="h-8 gap-1" disabled={!validForApproval || v?.status === 'blocked' || ws.mode === 'draft' || !!busy} onClick={() => act('approve', () => interiorApi.approve(revision.id, { validationRunId: v!.id, mode: 'final', note: note || undefined }), 'Approved')}>
                <FileCheck2 className="h-4 w-4" /> Approve as final
              </Button>
              <Button size="sm" variant="outline" className="h-8" disabled={!validForApproval || !!busy} onClick={() => act('approve-draft', () => interiorApi.approve(revision.id, { validationRunId: v!.id, mode: 'draft', note: note || undefined }), 'Approved as draft')}>
                Approve as labelled draft
              </Button>
            </div>
            {v?.status === 'blocked' && <p className="text-xs text-red-700 dark:text-red-400">{v.summary.blocking} blocking issue(s) must be resolved before a final approval (Model tab).</p>}
            {ws.mode === 'draft' && <p className="text-xs text-amber-700">This workspace is in draft mode; switch to strict mode for final approvals.</p>}
            {!validForApproval && <p className="text-xs text-amber-700">Re-validate the frozen revision first.</p>}
          </div>
        )}

        {Object.entries(grouped).map(([cat, checks]) => (
          <div key={cat} className="overflow-hidden rounded-lg border">
            <p className="bg-muted/50 px-3 py-1.5 text-xs font-semibold capitalize">{cat}</p>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-1 font-medium">Check</th>
                  <th className="px-3 py-1 font-medium">Expected</th>
                  <th className="px-3 py-1 font-medium">Observed</th>
                  <th className="px-3 py-1 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {checks.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-1">{c.label}</td>
                    <td className="px-3 py-1">{c.expected ?? '—'}</td>
                    <td className="px-3 py-1">{c.observed ?? '—'}</td>
                    <td className={cn('px-3 py-1 font-medium capitalize', OUTCOME[c.outcome])}>{c.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {decisions && decisions.length > 0 && (
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer text-sm font-semibold">Decision log ({decisions.length})</summary>
            <ul className="mt-2 space-y-1">
              {decisions.map((d) => (
                <li key={d.id} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground">{format(new Date(d.createdAt), 'd MMM HH:mm')}</span>
                  <span className="font-mono">{d.kind}</span>
                  <span className="text-muted-foreground">{d.rationale ?? ''}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
