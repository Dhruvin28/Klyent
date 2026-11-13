import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Box as BoxIcon, Camera, FileStack, ScanSearch, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { interiorApi } from '@/api/interior'
import { apiErrorMessage } from '@/api/visualizer'
import { interiorKeys, useInteriorRevision, useInteriorWorkspace } from '@/hooks/useInterior'
import type { Box } from '@/lib/interior/types'
import { ValidationChip, WorkspaceStatusChip } from '@/components/interior/common'
import { DrawingsTab } from '@/components/interior/DrawingsTab'
import { ReviewTab } from '@/components/interior/ReviewTab'
import { ModelTab } from '@/components/interior/ModelTab'
import { ApproveTab } from '@/components/interior/ApproveTab'
import { ViewsTab } from '@/components/interior/ViewsTab'

const TABS = [
  { key: 'drawings', label: 'Drawings', icon: FileStack },
  { key: 'review', label: 'Review sheets', icon: ScanSearch },
  { key: 'model', label: 'Model & questions', icon: BoxIcon },
  { key: 'approve', label: 'Validate & approve', icon: ShieldCheck },
  { key: 'views', label: 'Views & renders', icon: Camera },
] as const
type Tab = (typeof TABS)[number]['key']

export function InteriorWorkspacePage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'drawings'
  const setTab = (t: Tab) => setParams((p) => (p.set('tab', t), p), { replace: true })
  const { data: summary, isLoading, error } = useInteriorWorkspace(id)
  const [revisionId, setRevisionId] = useState<string | null>(null)
  const [pageId, setPageId] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<Box | null>(null)
  const [name, setName] = useState('')
  const qc = useQueryClient()
  const { toast } = useToast()

  // Follow the newest revision unless the user picked another one.
  const latestId = summary?.revisions[0]?.id ?? null
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    if (!pinned) setRevisionId(latestId)
  }, [latestId, pinned])
  useEffect(() => {
    if (summary) setName(summary.workspace.name)
  }, [summary?.workspace.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: revision, isLoading: revLoading } = useInteriorRevision(revisionId)
  const roomNames = useMemo(() => revision?.scene.plan.rooms.map((r) => r.name) ?? [], [revision])

  if (isLoading) return <LoadingSpinner />
  if (error || !summary) {
    return (
      <div className="space-y-3 py-16 text-center">
        <p className="font-medium">Could not open this reconstruction.</p>
        <p className="text-sm text-muted-foreground">{apiErrorMessage(error)}</p>
        <Link to="/interior" className="text-sm text-primary underline">
          Back
        </Link>
      </div>
    )
  }
  const ws = summary.workspace
  const chooseRevision = (rid: string) => {
    setPinned(rid !== latestId)
    setRevisionId(rid)
  }
  const showSource = (pid: string, region: Box | null) => {
    setPageId(pid)
    setHighlight(region)
    setTab('review')
  }
  const update = async (body: Parameters<typeof interiorApi.updateWorkspace>[1]) => {
    try {
      await interiorApi.updateWorkspace(ws.id, body)
      await qc.invalidateQueries({ queryKey: interiorKeys.workspace(ws.id) })
      await qc.invalidateQueries({ queryKey: interiorKeys.workspaces })
    } catch (err) {
      toast({ title: 'Could not save', description: apiErrorMessage(err), variant: 'destructive' })
    }
  }
  const needsRevision = tab === 'model' || tab === 'approve' || tab === 'views'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/interior" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== ws.name && update({ name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="h-9 w-56 font-semibold sm:w-72"
          aria-label="Name"
        />
        <WorkspaceStatusChip status={summary.status} />
        {summary.latestValidation && <ValidationChip status={summary.latestValidation.status} blocking={summary.latestValidation.summary.blocking} warnings={summary.latestValidation.summary.warnings} />}
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={ws.mode}
          onChange={(e) => update({ mode: e.target.value as 'strict' | 'draft' })}
          aria-label="Accuracy mode"
          title="Strict: missing evidence blocks final approval. Draft: provisional values allowed, outputs labelled DRAFT."
        >
          <option value="strict">Strict mode</option>
          <option value="draft">Draft mode</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {summary.ai.configured ? `Interpretation: ${summary.ai.model} · ${summary.ai.reasoningEffort} reasoning` : 'AI not configured (OPENAI_API_KEY)'}
        </span>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn('flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm', tab === t.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px]">{i + 1}</span>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
        {revision && needsRevision && (
          <select className="my-1 ml-auto h-8 rounded-md border bg-background px-2 text-xs" value={revision.id} onChange={(e) => chooseRevision(e.target.value)} aria-label="Revision">
            {summary.revisions.map((r) => (
              <option key={r.id} value={r.id}>
                R{r.revisionNo} · {r.status}
                {r.id === latestId ? ' (latest)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {tab === 'drawings' && <DrawingsTab summary={summary} roomNames={roomNames} onOpenPage={(pid) => (setPageId(pid), setHighlight(null), setTab('review'))} />}
      {tab === 'review' && <ReviewTab summary={summary} pageId={pageId} setPageId={(pid) => (setPageId(pid), setHighlight(null))} registrations={revision?.scene.registrations ?? []} highlight={highlight} />}
      {needsRevision &&
        (!revisionId ? (
          <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
            {summary.status === 'processing' ? 'The drawings are still being processed…' : 'No 3D model yet. Upload and interpret drawings, then build the model on the Drawings tab.'}
          </div>
        ) : revLoading || !revision ? (
          <LoadingSpinner />
        ) : tab === 'model' ? (
          <ModelTab revision={revision} workspaceId={ws.id} onShowSource={showSource} onRevisionChange={chooseRevision} />
        ) : tab === 'approve' ? (
          <ApproveTab summary={summary} revision={revision} onRevisionChange={chooseRevision} />
        ) : (
          <ViewsTab summary={summary} revision={revision} />
        ))}
    </div>
  )
}
