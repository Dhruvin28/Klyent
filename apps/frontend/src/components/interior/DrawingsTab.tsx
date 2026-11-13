import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, Eye, FileImage, FileText, Hammer, Loader2, RefreshCw, RotateCcw, Star, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { interiorApi } from '@/api/interior'
import { apiErrorMessage } from '@/api/visualizer'
import { interiorKeys, usePageImageUrl } from '@/hooks/useInterior'
import { PAGE_ROLES, PLAN_VIEW_ROLES, ROLE_LABEL, type InteriorJob, type PageMeta, type PageRole, type WorkspaceSummary } from '@/lib/interior/types'

const ACCEPT = '.pdf,.dxf,.png,.jpg,.jpeg,.webp,.tif,.tiff'

export function DrawingsTab({ summary, roomNames, onOpenPage }: { summary: WorkspaceSummary; roomNames: string[]; onOpenPage: (id: string) => void }) {
  const ws = summary.workspace
  const qc = useQueryClient()
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: interiorKeys.workspace(ws.id) })

  const upload = async (files: File[]) => {
    if (!files.length) return
    setUploading(0)
    try {
      const r = await interiorApi.uploadDocuments(ws.id, files, label.trim() || undefined, setUploading)
      if (r.rejected.length) toast({ title: `${r.rejected.length} file(s) not accepted`, description: r.rejected.map((x) => `${x.name}: ${x.message}`).join('\n'), variant: 'destructive' })
      if (r.accepted.length) toast({ title: `${r.accepted.length} drawing(s) uploaded`, description: 'Extracting pages, then interpreting each sheet.' })
      await refresh()
    } catch (err) {
      toast({ title: 'Upload failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setUploading(null)
    }
  }

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast({ title: ok })
      await refresh()
    } catch (err) {
      toast({ title: 'Action failed', description: apiErrorMessage(err), variant: 'destructive' })
    }
  }

  const jobFor = (type: InteriorJob['type'], target: string) => summary.jobs.find((j) => j.type === type && j.targetId === target)
  const activeJobs = summary.jobs.filter((j) => ['queued', 'running', 'retry_wait'].includes(j.status))
  const failedJobs = summary.jobs.filter((j) => j.status === 'failed' && !summary.jobs.some((k) => k.targetId === j.targetId && k.type === j.type && new Date(k.createdAt) > new Date(j.createdAt)))
  const building = activeJobs.some((j) => j.type === 'build_scene')
  const planPages = summary.pages.filter((p) => PLAN_VIEW_ROLES.has(p.effectiveRole) && p.status !== 'excluded')

  return (
    <div className="space-y-6">
      {/* Upload */}
      <div
        onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void upload(Array.from(e.dataTransfer.files))
        }}
        className={cn('rounded-lg border-2 border-dashed p-6 text-center transition-colors', dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25')}
      >
        <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <p className="font-medium">Drop the drawing set here</p>
        <p className="mx-auto mb-3 max-w-xl text-xs text-muted-foreground">
          Floor / furniture plans, ceiling (RCP) and electrical plans, wall elevations and ceiling sections. Vector PDFs exported from CAD and ASCII DXF give exact geometry; scans and photos are
          calibrated from their dimensions. DWG: export to DXF or PDF first.
        </p>
        <div className="mx-auto flex max-w-md flex-col items-center gap-2 sm:flex-row">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Drawing revision (optional, e.g. R2)" maxLength={64} className="h-9" />
          <Button className="shrink-0 gap-2" onClick={() => input.current?.click()} disabled={uploading !== null}>
            {uploading !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading !== null ? `Uploading ${Math.round(uploading * 100)}%` : 'Choose files'}
          </Button>
        </div>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (void upload(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
      </div>

      {/* Pipeline status */}
      {(activeJobs.length > 0 || failedJobs.length > 0) && (
        <div className="space-y-2 rounded-lg border p-3">
          {activeJobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="flex-1">
                {j.type === 'extract_document' ? 'Extracting pages' : j.type === 'interpret_page' ? `Interpreting sheet${j.progress?.model ? ` with ${j.progress.model}` : ''}` : 'Building and validating the 3D scene'}
                {j.type === 'extract_document' && j.progress?.page ? ` · page ${j.progress.page}/${j.progress.total}` : ''}
                {j.type === 'interpret_page' ? ` · ${pageTitle(summary.pages.find((p) => p.id === j.targetId))}` : ''}
                {j.status === 'retry_wait' && <span className="text-amber-600"> · retrying (attempt {j.attempt}/{j.maxAttempts}){j.error ? `: ${j.error}` : ''}</span>}
              </span>
              <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => act(() => interiorApi.cancelJob(j.id))}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          ))}
          {failedJobs.map((j) => (
            <div key={j.id} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="flex-1">
                <span className="font-medium">{j.type === 'extract_document' ? 'Extraction' : j.type === 'interpret_page' ? 'Interpretation' : 'Build'} failed</span>
                {j.errorCode ? ` (${j.errorCode})` : ''}: {j.error}
              </span>
              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => act(() => interiorApi.retryJob(j.id), 'Retry queued')}>
                <RotateCcw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Documents */}
      {summary.documents.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Drawings</h3>
          <div className="divide-y rounded-lg border">
            {summary.documents.map((d) => {
              const job = jobFor('extract_document', d.id)
              const warnings = d.preflight?.pages.flatMap((p) => p.warnings) ?? []
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  {d.kind === 'image' ? <FileImage className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {d.name} {d.revisionLabel && <span className="text-xs text-muted-foreground">· {d.revisionLabel}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.kind.toUpperCase()} · {(d.size / 1024 / 1024).toFixed(1)} MB
                      {d.status === 'ready' && ` · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}`}
                      {d.preflight?.pages[0] && ` · ${sourceLabel(d.preflight.pages[0].source)}`}
                      {d.preflight && ` · ${d.preflight.pages.reduce((a, p) => a + p.texts, 0)} text items`}
                    </p>
                    {d.status === 'failed' && <p className="text-xs text-destructive">{d.error}</p>}
                    {warnings.slice(0, 3).map((w, i) => (
                      <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
                        {w}
                      </p>
                    ))}
                  </div>
                  <DocStatus status={d.status} job={job} />
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => act(() => interiorApi.deleteDocument(d.id), 'Drawing removed')} aria-label={`Remove ${d.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sheets */}
      {summary.pages.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Sheets ({summary.pages.length})</h3>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={ws.autoBuild} onChange={(e) => act(() => interiorApi.updateWorkspace(ws.id, { autoBuild: e.target.checked }))} /> Build automatically
              </label>
              <Button size="sm" className="gap-1.5" disabled={building || !summary.pages.some((p) => p.interpretationKey)} onClick={() => act(() => interiorApi.build(ws.id), 'Building the 3D scene')}>
                {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />} Build 3D model
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {summary.pages.map((p) => (
              <SheetCard
                key={p.id}
                page={p}
                job={jobFor('interpret_page', p.id)}
                isReference={ws.referencePageId === p.id || (!ws.referencePageId && planPages[0]?.id === p.id && p.effectiveRole === 'floor_plan')}
                roomNames={roomNames}
                onOpen={() => onOpenPage(p.id)}
                onUpdate={(body, ok) => act(() => interiorApi.updatePage(p.id, body), ok)}
                onReference={() => act(() => interiorApi.updateWorkspace(ws.id, { referencePageId: p.id }), 'Reference plan set')}
                onReinterpret={() => act(() => interiorApi.reinterpretPage(p.id), 'Re-interpretation queued')}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function sourceLabel(s: string) {
  return s === 'pdf_vector' ? 'vector PDF' : s === 'pdf_raster' ? 'scanned PDF' : s === 'dxf' ? 'CAD (DXF)' : 'raster image'
}

function pageTitle(p: PageMeta | undefined) {
  return p ? (p.title ?? `page ${p.pageIndex + 1}`) : ''
}

function DocStatus({ status, job }: { status: string; job?: InteriorJob }) {
  if (status === 'ready') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Extracted</span>
  if (status === 'failed') return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">Failed</span>
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200">
      <Loader2 className="h-3 w-3 animate-spin" /> {job?.progress?.page ? `Page ${job.progress.page}/${job.progress.total}` : 'Extracting'}
    </span>
  )
}

function SheetCard({
  page,
  job,
  isReference,
  roomNames,
  onOpen,
  onUpdate,
  onReference,
  onReinterpret,
}: {
  page: PageMeta
  job?: InteriorJob
  isReference: boolean
  roomNames: string[]
  onOpen: () => void
  onUpdate: (body: Parameters<typeof interiorApi.updatePage>[1], ok?: string) => void
  onReference: () => void
  onReinterpret: () => void
}) {
  const url = usePageImageUrl(page.id)
  const excluded = page.status === 'excluded'
  const busy = page.status === 'interpreting' || (job && ['queued', 'running', 'retry_wait'].includes(job.status))
  const role = page.effectiveRole
  const [room, setRoom] = useState(page.assignment?.roomLabel ?? '')
  const listId = `rooms-${page.id}`
  const meta = page.interpretationMeta
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', excluded && 'opacity-60', isReference && 'ring-2 ring-primary/40')}>
      <button type="button" onClick={onOpen} className="relative block w-full bg-white" aria-label="Open sheet review">
        {url ? <img src={url} alt="" className="aspect-[4/3] w-full object-contain" /> : <div className="aspect-[4/3] w-full animate-pulse bg-muted" />}
        {isReference && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
            <Star className="h-3 w-3" /> Reference plan
          </span>
        )}
        {busy && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px]">
            <Loader2 className="h-3 w-3 animate-spin" /> Interpreting
          </span>
        )}
      </button>
      <div className="space-y-2 p-3 text-sm">
        <p className="truncate font-medium" title={page.title ?? ''}>
          {page.title ?? `Page ${page.pageIndex + 1}`}
        </p>
        <div className="flex items-center gap-2">
          <select
            className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
            value={page.role ?? ''}
            onChange={(e) => onUpdate({ role: (e.target.value || null) as PageRole | null }, 'Sheet type saved')}
            aria-label="Sheet type"
          >
            <option value="">{page.suggestedRole ? `AI: ${ROLE_LABEL[page.suggestedRole]}` : 'Detect automatically'}</option>
            {PAGE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          {PLAN_VIEW_ROLES.has(role) && !isReference && !excluded && (
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={onReference} title="Use as the reference plan">
              <Star className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {role === 'elevation' && !excluded && (
          <div className="space-y-1 rounded-md bg-muted/50 p-2">
            <p className="text-xs font-medium">Which wall does this elevation show?</p>
            <div className="flex gap-1.5">
              <input
                list={listId}
                className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                placeholder="Room"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                onBlur={() => room.trim() && room.trim() !== page.assignment?.roomLabel && onUpdate({ assignment: { roomLabel: room.trim(), side: page.assignment?.side ?? 'N' } }, 'Elevation assigned')}
              />
              <datalist id={listId}>
                {roomNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <select
                className="h-8 rounded-md border bg-background px-1 text-xs"
                value={page.assignment?.side ?? ''}
                onChange={(e) => room.trim() && onUpdate({ assignment: { roomLabel: room.trim(), side: e.target.value as 'N' | 'E' | 'S' | 'W' } }, 'Elevation assigned')}
                aria-label="Wall side"
              >
                <option value="" disabled>
                  Wall
                </option>
                <option value="N">North (plan top)</option>
                <option value="E">East (plan right)</option>
                <option value="S">South (plan bottom)</option>
                <option value="W">West (plan left)</option>
              </select>
            </div>
            {!page.assignment && <p className="text-[11px] text-amber-700 dark:text-amber-400">Required: elevations are never mapped to a wall by guesswork.</p>}
          </div>
        )}
        {page.status === 'failed' && <p className="text-xs text-destructive">{page.error}</p>}
        {meta && (
          <p className="text-[11px] text-muted-foreground">
            {meta.cached ? 'Cached · ' : ''}
            {meta.model}
            {meta.usage ? ` · ${(meta.usage.inputTokens + meta.usage.outputTokens).toLocaleString()} tokens` : ''}
            {meta.latencyMs ? ` · ${Math.round(meta.latencyMs / 1000)} s` : ''}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onOpen}>
            <Eye className="h-3.5 w-3.5" /> Review
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onReinterpret} disabled={!!busy || excluded}>
            <RefreshCw className="h-3.5 w-3.5" /> Re-interpret
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => onUpdate({ excluded: !excluded }, excluded ? 'Sheet included' : 'Sheet excluded')}>
            <Ban className="h-3.5 w-3.5" /> {excluded ? 'Include' : 'Exclude'}
          </Button>
        </div>
      </div>
    </div>
  )
}
