import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CloudCog, ImageOff, Loader2, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { interiorApi } from '@/api/interior'
import { apiErrorMessage } from '@/api/visualizer'
import { interiorKeys, useRenderCapabilities, useRenderSets } from '@/hooks/useInterior'
import { useDesignAssetUrl } from '@/hooks/useDesigner'
import type { RenderOutput, RenderSet, RevisionDetail, ViewSpec, WorkspaceSummary } from '@/lib/interior/types'
import { shortHash } from './common'

const QUALITY = { draft: { label: 'Draft', samples: 64 }, presentation: { label: 'Presentation', samples: 256 }, high_resolution: { label: 'High resolution', samples: 768 } } as const
type Quality = keyof typeof QUALITY
const SIZES = [1280, 1920, 2560, 3840]
const GROUP_LABEL: Record<ViewSpec['group'], string> = { perspective: 'Perspectives', elevation: 'Elevations', top: 'Top cutaway', ceiling: 'Reflected ceiling', isometric: 'Isometric' }

export function ViewsTab({ summary, revision }: { summary: WorkspaceSummary; revision: RevisionDetail }) {
  const ws = summary.workspace
  const { data: sets } = useRenderSets(ws.id)
  const { data: caps } = useRenderCapabilities()
  const qc = useQueryClient()
  const { toast } = useToast()
  const approval = revision.approvals.find((a) => a.sceneHash === revision.sceneHash)
  const views = revision.views
  const [selected, setSelected] = useState<Set<string>>(() => new Set(views.filter((v) => v.group !== 'elevation').map((v) => v.key)))
  const [quality, setQuality] = useState<Quality>('presentation')
  const [longSide, setLongSide] = useState(1920)
  const [photoreal, setPhotoreal] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => setSelected(new Set(views.filter((v) => v.group !== 'elevation').map((v) => v.key))), [revision.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rooms = useMemo(() => {
    const byRoom = new Map<string, { name: string; views: ViewSpec[] }>()
    for (const v of views) {
      const key = v.roomId ?? 'plan'
      const name = v.roomId ? (revision.scene.plan.rooms.find((r) => r.id === v.roomId)?.name ?? 'Room') : 'Whole plan'
      const e = byRoom.get(key) ?? { name, views: [] }
      e.views.push(v)
      byRoom.set(key, e)
    }
    return [...byRoom.entries()]
  }, [views, revision.scene.plan.rooms])

  const toggle = (keys: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)))
      return n
    })

  // Rendering happens entirely on the server as background jobs: this only queues the set.
  const start = async (rerunAll = false) => {
    setBusy(true)
    try {
      const keys = rerunAll ? views.map((v) => v.key) : views.filter((v) => selected.has(v.key)).map((v) => v.key)
      await interiorApi.createRenderSet(revision.id, { viewKeys: keys, quality, longSide, allowDraft: !approval || approval.mode !== 'final', rerun: rerunAll, enhance: photoreal })
      await qc.invalidateQueries({ queryKey: interiorKeys.renderSets(ws.id) })
      await qc.invalidateQueries({ queryKey: interiorKeys.workspace(ws.id) })
      toast({ title: 'Render queued', description: 'It runs on the server; you can close this page and come back.' })
    } catch (err) {
      toast({ title: 'Could not start rendering', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const retry = async (set: RenderSet) => {
    try {
      await interiorApi.retryRenderSet(set.id)
      await qc.invalidateQueries({ queryKey: interiorKeys.renderSets(ws.id) })
    } catch (err) {
      toast({ title: 'Could not retry', description: apiErrorMessage(err), variant: 'destructive' })
    }
  }

  const label = approval?.mode === 'final' ? 'final' : 'draft'
  const unavailable = caps?.serverRendering === false

  return (
    <div className="space-y-5">
      <div className={cn('rounded-lg border p-3 text-sm', label === 'final' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40' : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40')}>
        {label === 'final' ? (
          <p className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Rendering approved revision R{revision.revisionNo} (scene {shortHash(revision.sceneHash)}). Every view uses this exact model.
          </p>
        ) : (
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> R{revision.revisionNo} has no final approval: renders are labelled DRAFT and keep that label when shared.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {rooms.map(([key, room]) => (
            <div key={key} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{room.name}</p>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => toggle(room.views.map((v) => v.key), true)}>
                    All
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => toggle(room.views.map((v) => v.key), false)}>
                    None
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {room.views.map((v) => (
                  <label key={v.key} title={v.note ?? ''} className={cn('flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs', selected.has(v.key) ? 'border-primary bg-primary/5' : 'text-muted-foreground')}>
                    <input type="checkbox" checked={selected.has(v.key)} onChange={(e) => toggle([v.key], e.target.checked)} />
                    <span className="text-[10px] uppercase text-muted-foreground">{GROUP_LABEL[v.group]}</span>
                    {v.name.replace(`${room.name} — `, '')}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {!views.length && <p className="text-sm text-muted-foreground">This revision has no rooms yet, so no views can be generated.</p>}
        </div>

        <div className="space-y-3">
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="font-semibold">Render package</p>
            <label className="block text-xs text-muted-foreground">
              Quality
              <select className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
                {Object.entries(QUALITY).map(([k, q]) => (
                  <option key={k} value={k}>
                    {q.label} ({q.samples} samples)
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              Long side
              <select className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={longSide} onChange={(e) => setLongSide(Number(e.target.value))}>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} px
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={photoreal && caps?.photoreal !== false} disabled={caps?.photoreal === false} onChange={(e) => setPhotoreal(e.target.checked)} />
              <span>
                Photoreal pass (AI)
                <span className="block text-[11px] text-muted-foreground">Upgrades perspective views to photographic realism, then checks that walls, openings and furniture were not changed. The exact 3D render is always kept.</span>
              </span>
            </label>
            <Button className="w-full gap-1.5" disabled={!selected.size || busy || unavailable} onClick={() => start()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Render {selected.size} view{selected.size === 1 ? '' : 's'} on server
            </Button>
            <Button variant="outline" className="w-full gap-1.5" disabled={!views.length || busy || unavailable} onClick={() => start(true)}>
              <Play className="h-4 w-4" /> Re-render all {views.length} views (new set)
            </Button>
            {unavailable && (
              <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The render worker is not set up (Cycles mode needs Blender / BLENDER_PATH), so rendering is unavailable.
              </p>
            )}
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <CloudCog className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Rendered on the server in the background (dimension-exact model render, then an AI photoreal pass that is checked against the model); nothing runs on this device.
            </p>
            <p className="text-[11px] text-muted-foreground">Perspective images are not measurable; dimensions come from the elevations and the validation report.</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Render sets</h3>
        {!sets?.length && <p className="text-sm text-muted-foreground">No renders yet.</p>}
        {sets?.map((set) => (
          <RenderSetCard key={set.id} set={set} onRetry={() => retry(set)} />
        ))}
      </div>
    </div>
  )
}

function RenderSetCard({ set, onRetry }: { set: RenderSet; onRetry: () => void }) {
  const views = set.manifest.views
  const outs = views.map((v) => set.outputs[v.key])
  const done = outs.filter((o) => o?.status === 'complete').length
  const failed = outs.filter((o) => o?.status === 'failed').length
  const active = outs.filter((o) => o?.status === 'running' || o?.status === 'pending').length
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">R{set.manifest.revisionNo}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', set.manifest.label === 'final' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200')}>
          {set.manifest.label === 'final' ? 'Final' : 'DRAFT'}
        </span>
        <span className="text-xs text-muted-foreground">
          {set.manifest.quality.preset} · {set.manifest.quality.longSide}px · {done}/{views.length} views{active ? ` · ${active} rendering/queued` : ''} · manifest {shortHash(set.manifestHash)}
        </span>
        {failed > 0 && active === 0 && (
          <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" /> Retry {failed} failed
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {views.map((v) => (
          <OutputThumb key={v.key} view={v} output={set.outputs[v.key]} />
        ))}
      </div>
    </div>
  )
}

function OutputThumb({ view, output }: { view: ViewSpec; output?: RenderOutput }) {
  const [showRaw, setShowRaw] = useState(false)
  const hasBoth = !!output?.enhancedAssetId && !!output?.rawAssetId
  const id = output?.status === 'complete' ? (showRaw && output.rawAssetId ? output.rawAssetId : output.assetId) : null
  const { url } = useDesignAssetUrl(id)
  const pending = output?.status === 'pending' || output?.status === 'running'
  const badge = output?.status !== 'complete' ? null : showRaw || !output.enhancedAssetId ? '3D render' : output.enhancement === 'verified' ? 'Photoreal · verified' : 'Photoreal'
  return (
    <figure className="space-y-1">
      {url ? (
        <div className="relative">
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={view.name} className="aspect-video w-full rounded-md border bg-muted object-cover" />
          </a>
          {badge && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{badge}</span>}
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-md border bg-muted text-muted-foreground">
          {output?.status === 'failed' ? <AlertTriangle className="h-4 w-4 text-destructive" /> : pending || output?.status === 'complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageOff className="h-4 w-4" />}
          {pending && <span className="text-[10px]">{output?.status === 'running' ? 'Rendering…' : 'Queued'}</span>}
        </div>
      )}
      <figcaption className="truncate text-[11px] text-muted-foreground" title={output?.error ?? output?.note ?? view.note ?? view.name}>
        {view.name}
        {output?.status === 'failed' && <span className="text-destructive"> · {output.error}</span>}
      </figcaption>
      {hasBoth && (
        <button type="button" className="text-[10px] text-primary underline" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? 'Show photoreal' : 'Show exact 3D render'}
        </button>
      )}
      {output?.note && <p className="text-[10px] text-amber-700 dark:text-amber-300">{output.note}</p>}
    </figure>
  )
}
