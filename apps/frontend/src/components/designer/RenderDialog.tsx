import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useQueryClient } from '@tanstack/react-query'
import { Clapperboard, Image as ImageIcon, Loader2, Orbit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/visualizer/common'
import { useToast } from '@/components/ui/toast'
import { designerApi } from '@/api/designer'
import { apiErrorMessage } from '@/api/visualizer'
import { LIGHTING_LOOKS } from '@/lib/designer/defaults'
import { centroid, roomInnerPolygon } from '@/lib/designer/geometry'
import {
  PANORAMA_SIZES,
  QUALITY,
  RENDER_SIZES,
  pathTrace,
  poseFromSaved,
  recordWalkthrough,
  videoMimeType,
  type CameraPose,
  type PanoramaSize,
  type Quality,
  type RenderSize,
} from '@/lib/designer/render'
import { toWorld, type SceneContext } from '@/lib/designer/scene'
import type { DesignRenderKind, Plan } from '@/lib/designer/types'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId: string
  plan: Plan
  ctx: SceneContext
  /** Current 3D camera, or null when the 3D view isn't open. */
  currentPose: () => CameraPose | null
  onShowRenders: () => void
}

type Phase = { kind: 'setup' } | { kind: 'running'; label: string; progress: number; detail: string } | { kind: 'uploading' } | { kind: 'done'; url: string; mediaKind: DesignRenderKind }

export function RenderDialog({ open, onOpenChange, projectId, plan, ctx, currentPose, onShowRenders }: Props) {
  const [kind, setKind] = useState<DesignRenderKind>('render')
  const [view, setView] = useState<string>('current')
  const [size, setSize] = useState<RenderSize>('fhd')
  const [panoSize, setPanoSize] = useState<PanoramaSize>('draft')
  const [quality, setQuality] = useState<Quality>('standard')
  const [panoRoom, setPanoRoom] = useState<string>('')
  const [videoPath, setVideoPath] = useState<'orbit' | 'views'>('orbit')
  const [seconds, setSeconds] = useState(12)
  const [videoSize, setVideoSize] = useState<'hd' | 'fhd'>('hd')
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const control = useRef<{ finish?: () => void; cancel: () => void } | null>(null)
  const qc = useQueryClient()
  const { toast } = useToast()
  const hasCurrent = open && !!currentPose()

  useEffect(() => {
    if (!open) return
    setPhase({ kind: 'setup' })
    setView(currentPose() ? 'current' : plan.cameras[0]?.id ?? 'overview')
    setPanoRoom(plan.rooms[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => control.current?.cancel(), [])

  const poseFor = (): CameraPose => {
    if (view === 'current') {
      const p = currentPose()
      if (p) return p
    }
    const saved = plan.cameras.find((c) => c.id === view)
    if (saved) return poseFromSaved(saved)
    return { position: new THREE.Vector3(6, 7, 9), target: new THREE.Vector3(0, 0, 0), fov: 50 }
  }

  const panoPose = (): CameraPose => {
    const room = plan.rooms.find((r) => r.id === panoRoom)
    if (room) {
      const c = toWorld(centroid(roomInnerPolygon(room, plan.walls)), 1.5)
      return { position: c, target: c.clone().add(new THREE.Vector3(0, 0, -1)), fov: 90 }
    }
    return poseFor()
  }

  const defaultName = () => {
    const viewName = view === 'current' ? '3D view' : plan.cameras.find((c) => c.id === view)?.name ?? 'Overview'
    const look = LIGHTING_LOOKS[plan.lighting.preset].label
    if (kind === 'panorama') return `360° ${plan.rooms.find((r) => r.id === panoRoom)?.name ?? viewName} · ${look}`
    if (kind === 'video') return `Walkthrough · ${videoPath === 'orbit' ? 'orbit' : 'saved views'}`
    return `${viewName} · ${look}`
  }

  const attachCanvas = (c: HTMLCanvasElement) => {
    c.style.width = '100%'
    c.style.height = 'auto'
    c.style.display = 'block'
    c.style.borderRadius = '6px'
    canvasRef.current = c
  }
  // The preview box mounts after the job starts; adopt the job's canvas when it does.
  const previewRef = (host: HTMLDivElement | null) => {
    const c = canvasRef.current
    if (host && c && c.parentElement !== host) {
      host.innerHTML = ''
      host.appendChild(c)
    }
  }

  const upload = async (blob: Blob, w: number, h: number, meta: Record<string, unknown>) => {
    setPhase({ kind: 'uploading' })
    const n = name.trim() || defaultName()
    await designerApi.uploadRender(projectId, blob, { kind, name: n.slice(0, 200), width: w, height: h, meta })
    await qc.invalidateQueries({ queryKey: ['designer', 'renders', projectId] })
    setPhase({ kind: 'done', url: URL.createObjectURL(blob), mediaKind: kind })
    toast({ title: kind === 'video' ? 'Walkthrough saved' : 'Render saved', description: n })
  }

  const start = async () => {
    try {
      if (kind === 'video') {
        const path = videoPath === 'views' && plan.cameras.length >= 2 ? plan.cameras.map(poseFromSaved) : null
        const dims = videoSize === 'fhd' ? RENDER_SIZES.fhd : RENDER_SIZES.hd
        setPhase({ kind: 'running', label: 'Recording walkthrough', progress: 0, detail: 'Loading scene…' })
        const job = recordWalkthrough(plan, ctx, { width: dims.width, height: dims.height, seconds, path }, (f) =>
          setPhase({ kind: 'running', label: 'Recording walkthrough', progress: f, detail: `${Math.round(f * seconds)} / ${seconds} s` })
        )
        control.current = job
        attachCanvas(job.canvas)
        const blob = await job.done
        control.current = null
        await upload(blob, dims.width, dims.height, { durationSec: seconds })
        return
      }
      const dims = kind === 'panorama' ? PANORAMA_SIZES[panoSize] : RENDER_SIZES[size]
      const samples = QUALITY[quality].samples
      const pose = kind === 'panorama' ? panoPose() : poseFor()
      const label = kind === 'panorama' ? 'Rendering 360° panorama' : 'Rendering'
      setPhase({ kind: 'running', label, progress: 0, detail: 'Loading textures and models…' })
      const job = pathTrace(plan, ctx, { kind: kind === 'panorama' ? 'panorama' : 'render', width: dims.width, height: dims.height, samples, pose }, (s, p) =>
        setPhase({ kind: 'running', label, progress: s / samples, detail: p === 'loading' ? 'Building scene…' : `${s} / ${samples} samples` })
      )
      control.current = job
      attachCanvas(job.canvas)
      const blob = await job.done
      control.current = null
      await upload(blob, dims.width, dims.height, { samples, preset: plan.lighting.preset, camera: view })
    } catch (err) {
      control.current = null
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase({ kind: 'setup' })
        return
      }
      toast({ title: 'Render failed', description: err instanceof Error && !('response' in err) ? err.message : apiErrorMessage(err), variant: 'destructive' })
      setPhase({ kind: 'setup' })
    }
  }

  const close = (o: boolean) => {
    if (!o && phase.kind === 'running') return // finish or cancel first
    if (!o && phase.kind === 'done') URL.revokeObjectURL(phase.url)
    onOpenChange(o)
  }

  const views = [
    ...(hasCurrent ? [{ value: 'current', label: 'Current 3D view' }] : []),
    ...plan.cameras.map((c) => ({ value: c.id, label: c.name })),
    ...(!hasCurrent && !plan.cameras.length ? [{ value: 'overview', label: 'Overview' }] : []),
  ]

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Render</DialogTitle>
          <DialogDescription>Photoreal path tracing runs on this computer’s graphics card. Keep this tab open while it renders.</DialogDescription>
        </DialogHeader>

        {phase.kind === 'setup' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['render', 'Still image', ImageIcon],
                  ['panorama', '360° panorama', Orbit],
                  ['video', 'Walkthrough video', Clapperboard],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm font-medium ${kind === k ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>

            {kind === 'render' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Camera">
                  <NativeSelect value={view} onChange={setView} options={views} />
                </Field>
                <Field label="Resolution">
                  <NativeSelect value={size} onChange={(v) => setSize(v as RenderSize)} options={Object.entries(RENDER_SIZES).map(([k, s]) => ({ value: k, label: s.label }))} />
                </Field>
                <Field label="Quality">
                  <Segmented value={quality} onChange={setQuality} options={Object.entries(QUALITY).map(([k, q]) => ({ value: k as Quality, label: `${q.label} (${q.samples})` }))} />
                </Field>
              </div>
            )}

            {kind === 'panorama' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Stand in">
                  <NativeSelect
                    value={panoRoom || view}
                    onChange={(v) => (plan.rooms.some((r) => r.id === v) ? setPanoRoom(v) : (setPanoRoom(''), setView(v)))}
                    options={[...plan.rooms.map((r) => ({ value: r.id, label: `${r.name} (centre, eye level)` })), ...views]}
                  />
                </Field>
                <Field label="Resolution">
                  <NativeSelect value={panoSize} onChange={(v) => setPanoSize(v as PanoramaSize)} options={Object.entries(PANORAMA_SIZES).map(([k, s]) => ({ value: k, label: s.label }))} />
                </Field>
                <Field label="Quality">
                  <Segmented value={quality} onChange={setQuality} options={Object.entries(QUALITY).map(([k, q]) => ({ value: k as Quality, label: `${q.label} (${q.samples})` }))} />
                </Field>
              </div>
            )}

            {kind === 'video' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Camera path">
                  <Segmented
                    value={videoPath}
                    onChange={setVideoPath}
                    options={[
                      { value: 'orbit', label: 'Orbit the plan' },
                      { value: 'views', label: `Through saved views (${plan.cameras.length})` },
                    ]}
                  />
                </Field>
                <Field label="Length">
                  <Segmented value={String(seconds)} onChange={(v) => setSeconds(Number(v))} options={['8', '12', '20', '30'].map((s) => ({ value: s, label: `${s}s` }))} />
                </Field>
                <Field label="Resolution">
                  <Segmented value={videoSize} onChange={setVideoSize} options={[{ value: 'hd', label: '720p' }, { value: 'fhd', label: '1080p' }]} />
                </Field>
                {videoPath === 'views' && plan.cameras.length < 2 && <p className="text-xs text-amber-600 sm:col-span-2">Save at least two views in 3D to fly between them. Until then the video orbits the plan.</p>}
                {!videoMimeType() && <p className="text-xs text-destructive sm:col-span-2">This browser can’t record video. Use Chrome, Edge or Firefox.</p>}
              </div>
            )}

            <Field label="Name">
              <Input value={name} placeholder={defaultName()} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </Field>
            {kind !== 'video' && <p className="text-xs text-muted-foreground">Higher quality and resolution take longer. On a typical laptop GPU, a Standard Full HD still takes 1 to 3 minutes. You can stop early and keep the image so far.</p>}
          </div>
        )}

        {(phase.kind === 'running' || phase.kind === 'uploading') && (
          <div className="space-y-3">
            <div ref={previewRef} className="max-h-[55vh] overflow-hidden rounded-md bg-muted" />
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((phase.kind === 'running' ? phase.progress : 1) * 100)}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">{phase.kind === 'running' ? `${phase.label} — ${phase.detail}` : 'Saving…'}</p>
          </div>
        )}

        {phase.kind === 'done' && (
          <div className="space-y-2">
            {phase.mediaKind === 'video' ? <video src={phase.url} controls autoPlay loop className="w-full rounded-md" /> : <img src={phase.url} alt="Render result" className="max-h-[55vh] w-full rounded-md object-contain" />}
          </div>
        )}

        <DialogFooter>
          {phase.kind === 'setup' && (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Close
              </Button>
              <Button onClick={start} disabled={!plan.walls.length && !plan.items.length}>
                Start
              </Button>
            </>
          )}
          {phase.kind === 'running' && (
            <>
              <Button variant="outline" onClick={() => control.current?.cancel()}>
                Cancel
              </Button>
              {control.current?.finish && <Button onClick={() => control.current?.finish?.()}>Stop and keep</Button>}
            </>
          )}
          {phase.kind === 'uploading' && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving
            </Button>
          )}
          {phase.kind === 'done' && (
            <>
              <Button variant="outline" onClick={() => setPhase({ kind: 'setup' })}>
                Render another
              </Button>
              <Button
                onClick={() => {
                  close(false)
                  onShowRenders()
                }}
              >
                Open gallery
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  )
}

function NativeSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
