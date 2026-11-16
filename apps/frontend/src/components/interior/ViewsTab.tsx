import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ImageOff, Loader2, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { interiorApi } from '@/api/interior'
import { apiErrorMessage } from '@/api/visualizer'
import { interiorKeys, useRenderSets } from '@/hooks/useInterior'
import { useDesignAssetUrl } from '@/hooks/useDesigner'
import { pathTrace } from '@/lib/designer/render'
import type { RenderSet, RevisionDetail, ViewSpec, WorkspaceSummary } from '@/lib/interior/types'
import { shortHash, useSceneContext } from './common'

const QUALITY = { draft: { label: 'Draft', samples: 64 }, presentation: { label: 'Presentation', samples: 256 }, high_resolution: { label: 'High resolution', samples: 768 } } as const
type Quality = keyof typeof QUALITY
const SIZES = [1280, 1920, 2560, 3840]
const GROUP_LABEL: Record<ViewSpec['group'], string> = { perspective: 'Perspectives', elevation: 'Elevations', top: 'Top cutaway', ceiling: 'Reflected ceiling', isometric: 'Isometric' }

// View specs are in plan space (mm, x/y on the floor, z up); the scene is in metres with y up
// and plan y on world z, exactly like toWorld() in the designer scene.
const MM = 0.001
const toWorldVec = ([x, y, z]: [number, number, number]) => new THREE.Vector3(x * MM, z * MM, y * MM)

interface Progress {
  set: RenderSet
  index: number
  total: number
  view: ViewSpec
  samples: number
  target: number
}

export function ViewsTab({ summary, revision }: { summary: WorkspaceSummary; revision: RevisionDetail }) {
  const ws = summary.workspace
  const { ctx } = useSceneContext()
  const { data: sets } = useRenderSets(ws.id)
  const qc = useQueryClient()
  const { toast } = useToast()
  const approval = revision.approvals.find((a) => a.sceneHash === revision.sceneHash)
  const views = revision.views
  const [selected, setSelected] = useState<Set<string>>(() => new Set(views.filter((v) => v.group !== 'elevation').map((v) => v.key)))
  const [quality, setQuality] = useState<Quality>('presentation')
  const [longSide, setLongSide] = useState(1920)
  const [progress, setProgress] = useState<Progress | null>(null)
  const control = useRef<{ stop: boolean; handle?: { finish: () => void; cancel: () => void } }>({ stop: false })
  const previewHost = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(new Set(views.filter((v) => v.group !== 'elevation').map((v) => v.key))), [revision.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => control.current.handle?.cancel(), [])

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

  const renderSet = async (set: RenderSet) => {
    const pending = set.manifest.views.filter((v) => set.outputs[v.key]?.status !== 'complete')
    control.current.stop = false
    let current = set
    for (let i = 0; i < pending.length; i++) {
      if (control.current.stop) break
      const view = pending[i]
      const aspect = view.aspect || 16 / 9
      const width = aspect >= 1 ? set.manifest.quality.longSide : Math.round(set.manifest.quality.longSide * aspect)
      const height = aspect >= 1 ? Math.round(set.manifest.quality.longSide / aspect) : set.manifest.quality.longSide
      setProgress({ set: current, index: i + 1, total: pending.length, view, samples: 0, target: set.manifest.quality.samples })
      try {
        const handle = pathTrace(
          revision.scene.plan,
          ctx,
          {
            kind: 'render',
            width,
            height,
            samples: set.manifest.quality.samples,
            pose: { position: toWorldVec(view.position), target: toWorldVec(view.target), fov: view.fov },
            ortho: view.projection === 'orthographic' && view.ortho ? { width: view.ortho.width * MM, height: view.ortho.height * MM } : null,
            up: view.up ? ([view.up[0], view.up[2], view.up[1]] as [number, number, number]) : undefined,
            preset: view.visibility,
            mirrorX: view.mirrorX,
          },
          (samples) => setProgress((p) => (p ? { ...p, samples } : p))
        )
        control.current.handle = handle
        const host = previewHost.current
        if (host) {
          host.innerHTML = ''
          handle.canvas.style.width = '100%'
          handle.canvas.style.height = 'auto'
          handle.canvas.style.borderRadius = '6px'
          host.appendChild(handle.canvas)
        }
        const blob = await handle.done
        current = await interiorApi.uploadRenderOutput(set.id, view.key, blob, width, height)
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') break
        current = await interiorApi.failRenderOutput(set.id, view.key, (err as Error)?.message ?? 'Render failed').catch(() => current)
        toast({ title: `“${view.name}” failed`, description: (err as Error)?.message, variant: 'destructive' })
      }
      await qc.invalidateQueries({ queryKey: interiorKeys.renderSets(ws.id) })
    }
    control.current.handle = undefined
    setProgress(null)
    await qc.invalidateQueries({ queryKey: interiorKeys.renderSets(ws.id) })
  }

  const start = async (rerunAll = false) => {
    try {
      const keys = rerunAll ? views.map((v) => v.key) : views.filter((v) => selected.has(v.key)).map((v) => v.key)
      const set = await interiorApi.createRenderSet(revision.id, { viewKeys: keys, quality, longSide, allowDraft: !approval || approval.mode !== 'final', rerun: rerunAll })
      await qc.invalidateQueries({ queryKey: interiorKeys.renderSets(ws.id) })
      await qc.invalidateQueries({ queryKey: interiorKeys.workspace(ws.id) })
      await renderSet(set)
    } catch (err) {
      toast({ title: 'Could not start rendering', description: apiErrorMessage(err), variant: 'destructive' })
    }
  }

  const label = approval?.mode === 'final' ? 'final' : 'draft'

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
            {!progress ? (
              <>
                <Button className="w-full gap-1.5" disabled={!selected.size} onClick={() => start()}>
                  <Play className="h-4 w-4" /> Render {selected.size} view{selected.size === 1 ? '' : 's'}
                </Button>
                <Button variant="outline" className="w-full gap-1.5" disabled={!views.length} onClick={() => start(true)}>
                  <Play className="h-4 w-4" /> Re-render all {views.length} views (new set)
                </Button>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-xs">
                  View {progress.index}/{progress.total}: <span className="font-medium">{progress.view.name}</span>
                </p>
                <div className="h-1.5 overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (progress.samples / progress.target) * 100)}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {progress.samples}/{progress.target} samples · rendering on this device’s GPU; keep the tab open.
                </p>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => control.current.handle?.finish()}>
                    Finish this view now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    onClick={() => {
                      control.current.stop = true
                      control.current.handle?.cancel()
                    }}
                  >
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Perspective images are not measurable; dimensions come from the elevations and the validation report.</p>
          </div>
          <div ref={previewHost} className={cn('overflow-hidden rounded-lg border bg-muted', !progress && 'hidden')} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Render sets</h3>
        {!sets?.length && <p className="text-sm text-muted-foreground">No renders yet.</p>}
        {sets?.map((set) => (
          <RenderSetCard key={set.id} set={set} busy={!!progress} onResume={() => renderSet(set)} />
        ))}
      </div>
    </div>
  )
}

function RenderSetCard({ set, busy, onResume }: { set: RenderSet; busy: boolean; onResume: () => void }) {
  const views = set.manifest.views
  const done = views.filter((v) => set.outputs[v.key]?.status === 'complete').length
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">R{set.manifest.revisionNo}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', set.manifest.label === 'final' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200')}>
          {set.manifest.label === 'final' ? 'Final' : 'DRAFT'}
        </span>
        <span className="text-xs text-muted-foreground">
          {set.manifest.quality.preset} · {set.manifest.quality.longSide}px · {done}/{views.length} views · manifest {shortHash(set.manifestHash)}
        </span>
        {done < views.length && (
          <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" disabled={busy} onClick={onResume}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Render remaining'}
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

function OutputThumb({ view, output }: { view: ViewSpec; output?: RenderSet['outputs'][string] }) {
  const { url } = useDesignAssetUrl(output?.status === 'complete' ? output.assetId : null)
  return (
    <figure className="space-y-1">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={view.name} className="aspect-video w-full rounded-md border bg-muted object-cover" />
        </a>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted text-muted-foreground">
          {output?.status === 'failed' ? <AlertTriangle className="h-4 w-4 text-destructive" /> : output?.status === 'complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageOff className="h-4 w-4" />}
        </div>
      )}
      <figcaption className="truncate text-[11px] text-muted-foreground" title={view.note ?? view.name}>
        {view.name}
      </figcaption>
    </figure>
  )
}
