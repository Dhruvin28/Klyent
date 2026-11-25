import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Box, Calculator, Check, Columns2, Footprints, Images, Loader2, Orbit, Paintbrush, Redo2, Share2, Sparkles, Square, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Segmented } from '@/components/visualizer/common'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { designerApi } from '@/api/designer'
import { apiErrorMessage, visualizerApi } from '@/api/visualizer'
import { useVizMaterials } from '@/hooks/useVisualizer'
import { useDesignAssetUrl, useDesignModelMap, useDesignProject } from '@/hooks/useDesigner'
import { BomDialog } from '@/components/designer/BomDialog'
import { CatalogPanel } from '@/components/designer/CatalogPanel'
import { DesignerLibrariesContext, FinishPicker, FinishSwatch, type DesignerLibraries } from '@/components/designer/FinishField'
import { Inspector } from '@/components/designer/Inspector'
import { PlanEditor2D } from '@/components/designer/PlanEditor2D'
import { RenderDialog } from '@/components/designer/RenderDialog'
import { RendersDialog } from '@/components/designer/RendersDialog'
import { ShareDialog } from '@/components/designer/ShareDialog'
import { SELECT, isTyping, type Tool } from '@/components/designer/tools'
import { useDesignerEditor, type SaveStatus } from '@/components/designer/useDesignerEditor'
import { Viewport3D, type ViewportApi } from '@/components/designer/Viewport3D'
import { cleanupPlan, pointInPolygon, uid } from '@/lib/designer/geometry'
import { MaterialResolver } from '@/lib/designer/materials'
import { poseFromSaved } from '@/lib/designer/render'
import type { PickTarget, SceneContext } from '@/lib/designer/scene'
import type { DesignProject, MatRef, Plan } from '@/lib/designer/types'
import type { VizMaterial } from '@/lib/visualizer/types'

type ViewMode = '2d' | '3d' | 'split'

export function DesignerEditorPage() {
  const { id = '' } = useParams()
  const { data: project, isLoading, error } = useDesignProject(id)
  if (isLoading) return <LoadingSpinner />
  if (error || !project) {
    return (
      <div className="space-y-3 py-16 text-center">
        <p className="font-medium">Could not open this design.</p>
        <p className="text-sm text-muted-foreground">{apiErrorMessage(error)}</p>
        <Link to="/designer" className="text-sm text-primary underline">
          Back to designs
        </Link>
      </div>
    )
  }
  return <Editor key={project.id} project={project} />
}

/** Applies a finish to whatever was clicked in 3D. */
function applyFinish(p: Plan, t: PickTarget, ref: MatRef): Plan {
  switch (t.kind) {
    case 'wall':
      return { ...p, walls: p.walls.map((w) => (w.id === t.id ? { ...w, [t.side]: ref } : w)) }
    case 'floor':
      return { ...p, rooms: p.rooms.map((r) => (r.id === t.id ? { ...r, floor: ref } : r)) }
    case 'ceiling':
      return { ...p, rooms: p.rooms.map((r) => (r.id === t.id ? { ...r, ceiling: ref } : r)) }
    case 'item':
      if (!t.slot) return p
      return { ...p, items: p.items.map((i) => (i.id === t.id && i.source.kind === 'parametric' ? { ...i, materials: { ...i.materials, [t.slot!]: ref } } : i)) }
    default:
      return p
  }
}

function Editor({ project }: { project: DesignProject }) {
  const editor = useDesignerEditor(project)
  const { plan, update, undo, redo, selection, setSelection, status } = editor
  const { toast } = useToast()
  const [name, setName] = useState(project.name)
  const [viewMode, setViewMode] = useState<ViewMode>(project.plan.walls.length ? 'split' : '2d')
  const [mode3d, setMode3d] = useState<'orbit' | 'walk'>('orbit')
  const [tool, setTool] = useState<Tool>(SELECT)
  const [wallThickness, setWallThickness] = useState(115)
  const [brush, setBrush] = useState<MatRef | null>(null)
  const [brushPicker, setBrushPicker] = useState(false)
  const [dialog, setDialog] = useState<'render' | 'renders' | 'share' | 'bom' | null>(null)
  const viewport = useRef<ViewportApi>(null)
  const show3d = viewMode !== '2d'
  const show2d = viewMode !== '3d'

  // ── Libraries and the shared scene context ──
  const { data: materials } = useVizMaterials()
  const models = useDesignModelMap()
  const materialMap = useMemo(() => new Map<string, VizMaterial>((materials ?? []).map((m) => [m.id, m])), [materials])
  const libraries = useMemo<DesignerLibraries>(() => ({ materials: materials ?? [], materialMap, models }), [materials, materialMap, models])
  const ctxRef = useRef<SceneContext | null>(null)
  if (!ctxRef.current) {
    ctxRef.current = { library: new MaterialResolver(materialMap, visualizerApi.getAssetBlob), models, loadAsset: designerApi.getAssetBlob }
  }
  const [ctxVersion, setCtxVersion] = useState(0)
  useEffect(() => {
    const ctx = ctxRef.current!
    ctx.library.setLibrary(materialMap)
    ctx.models = models
    setCtxVersion((v) => v + 1)
  }, [materialMap, models])
  useEffect(() => () => ctxRef.current?.library.dispose(), [])

  const { url: underlayUrl } = useDesignAssetUrl(plan.underlay?.assetId)

  // ── Thumbnails: refresh from the 3D view after saves, at most every 90 s ──
  const lastThumb = useRef(project.thumbnailAssetId ? Date.now() : 0)
  useEffect(() => {
    if (status !== 'saved' || !show3d || Date.now() - lastThumb.current < 90_000) return
    const t = window.setTimeout(async () => {
      const blob = await viewport.current?.capture(640)
      if (!blob) return
      lastThumb.current = Date.now()
      designerApi.uploadThumbnail(project.id, blob).catch(() => undefined)
    }, 1500)
    return () => window.clearTimeout(t)
  }, [status, show3d, project.id, plan])

  // ── 3D picking ──
  const onPick = useCallback(
    (t: PickTarget | null) => {
      if (brush && t) {
        if (t.kind === 'opening' || (t.kind === 'item' && !t.slot)) {
          toast({ title: 'That surface can’t take a finish', description: 'Finishes apply to walls, floors, ceilings and parametric furniture.' })
          return
        }
        update((p) => applyFinish(p, t, brush))
        return
      }
      if (!t) return setSelection(null)
      if (t.kind === 'wall') setSelection({ kind: 'wall', id: t.id })
      else if (t.kind === 'floor' || t.kind === 'ceiling') setSelection({ kind: 'room', id: t.id })
      else setSelection({ kind: t.kind, id: t.id })
    },
    [brush, update, setSelection, toast]
  )

  // ── Saved views ──
  const saveView = useCallback(() => {
    const pose = viewport.current?.getPose()
    if (!pose) return
    const room = plan.rooms.find((r) => pointInPolygon({ x: pose.position.x * 1000, y: pose.position.z * 1000 }, r.points))
    const base = room && pose.position.y < plan.wallHeight / 1000 ? room.name : 'Overview'
    const n = plan.cameras.filter((c) => c.name.startsWith(base)).length
    const cam = {
      id: uid(),
      name: n ? `${base} ${n + 1}` : base,
      position: pose.position.toArray() as [number, number, number],
      target: pose.target.toArray() as [number, number, number],
      fov: pose.fov,
    }
    update((p) => ({ ...p, cameras: [...p.cameras, cam] }))
    toast({ title: `Saved view “${cam.name}”` })
  }, [plan.rooms, plan.cameras, plan.wallHeight, update, toast])

  const goToView = useCallback(
    (camId: string) => {
      const c = plan.cameras.find((x) => x.id === camId)
      if (!c) return
      const pose = poseFromSaved(c)
      const inside = pose.position.y < plan.wallHeight / 1000
      if (!show3d) setViewMode('split')
      setMode3d(inside ? 'walk' : 'orbit')
      // Wait for the viewport (and its mode switch) before moving the camera.
      setTimeout(() => viewport.current?.setPose(pose), 60)
    },
    [plan.cameras, plan.wallHeight, show3d]
  )

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || dialog) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mode3d === 'walk' && show3d && !show2d) return // WASD drive the camera
      const sel = selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault()
        update((p) => {
          if (sel.kind === 'wall') return cleanupPlan({ ...p, walls: p.walls.filter((w) => w.id !== sel.id) })
          if (sel.kind === 'opening') return { ...p, openings: p.openings.filter((o) => o.id !== sel.id) }
          if (sel.kind === 'item') return { ...p, items: p.items.filter((i) => i.id !== sel.id) }
          return p
        })
        setSelection(null)
        return
      }
      if (sel?.kind === 'item') {
        const nudge = e.shiftKey ? 100 : 10
        const move = { ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, -nudge], ArrowDown: [0, nudge] }[e.key]
        if (move && mode3d !== 'walk') {
          e.preventDefault()
          update((p) => ({ ...p, items: p.items.map((i) => (i.id === sel.id ? { ...i, x: i.x + move[0], y: i.y + move[1] } : i)) }))
          return
        }
        if (e.key.toLowerCase() === 'r' && !mod) {
          update((p) => ({ ...p, items: p.items.map((i) => (i.id === sel.id ? { ...i, rotation: (i.rotation + (e.shiftKey ? 270 : 90)) % 360 } : i)) }))
          return
        }
        if (mod && e.key.toLowerCase() === 'd') {
          e.preventDefault()
          const it = plan.items.find((i) => i.id === sel.id)
          if (it) {
            const copy = { ...it, id: uid(), x: it.x + 200, y: it.y + 200 }
            update((p) => ({ ...p, items: [...p.items, copy] }))
            setSelection({ kind: 'item', id: copy.id })
          }
          return
        }
      }
      if (mod || e.altKey) return
      const tools: Record<string, Tool> = { v: SELECT, w: { kind: 'wall' }, m: { kind: 'room' }, d: { kind: 'opening', type: 'door' }, n: { kind: 'opening', type: 'window' } }
      const t = tools[e.key.toLowerCase()]
      if (t && show2d) setTool(t)
      if (e.key === 'Escape' && brush) setBrush(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, undo, redo, selection, update, setSelection, plan.items, mode3d, show3d, show2d, brush])

  const rename = async () => {
    const n = name.trim()
    if (!n || n === project.name) return setName(project.name)
    try {
      await editor.rename(n)
    } catch (err) {
      toast({ title: 'Rename failed', description: apiErrorMessage(err), variant: 'destructive' })
    }
  }

  const selectedId = selection && selection.kind !== 'room' ? selection.id : null

  return (
    <DesignerLibrariesContext.Provider value={libraries}>
      <div className="-m-4 flex h-[calc(100dvh-3.5rem)] flex-col sm:-m-6 sm:h-[calc(100dvh-4rem)]">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link to="/designer" aria-label="Back to designs">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="h-8 w-44 font-medium sm:w-56" aria-label="Design name" />
          <SaveBadge status={status} />
          <div className="flex items-center">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!editor.canUndo} onClick={undo} title="Undo (Ctrl+Z)">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!editor.canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="w-44">
            <Segmented<ViewMode>
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: '2d', label: <Square className="mx-auto h-3.5 w-3.5" />, title: '2D plan' },
                { value: 'split', label: <Columns2 className="mx-auto h-3.5 w-3.5" />, title: '2D + 3D' },
                { value: '3d', label: <Box className="mx-auto h-3.5 w-3.5" />, title: '3D' },
              ]}
            />
          </div>
          {show3d && (
            <div className="w-36">
              <Segmented
                value={mode3d}
                onChange={setMode3d}
                options={[
                  { value: 'orbit', label: <Orbit className="mx-auto h-3.5 w-3.5" />, title: 'Orbit (bird’s eye)' },
                  { value: 'walk', label: <Footprints className="mx-auto h-3.5 w-3.5" />, title: 'Walk (WASD + drag)' },
                ]}
              />
            </div>
          )}
          <Button
            variant={brush ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            title="Pick a finish, then click surfaces in 3D to apply it"
            onClick={() => (brush ? setBrush(null) : setBrushPicker(true))}
          >
            {brush ? <FinishSwatch value={brush} className="h-4 w-4" /> : <Paintbrush className="h-4 w-4" />}
            {brush ? 'Brush on' : 'Finish brush'}
            {brush && <X className="h-3.5 w-3.5" />}
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog('bom')}>
              <Calculator className="h-4 w-4" /> <span className="hidden md:inline">BOM</span>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog('renders')}>
              <Images className="h-4 w-4" /> <span className="hidden md:inline">Renders</span>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog('share')}>
              <Share2 className="h-4 w-4" /> <span className="hidden md:inline">Share</span>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setDialog('render')} data-testid="designer-render">
              <Sparkles className="h-4 w-4" /> Render
            </Button>
          </div>
        </div>

        {status === 'conflict' && (
          <div className="flex items-center justify-between gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            This design was changed in another tab or window. Your latest edits here were not saved.
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-60 shrink-0 border-r bg-background lg:block">
            <CatalogPanel tool={tool} setTool={(t) => (setTool(t), t.kind !== 'select' && !show2d && setViewMode('split'))} hasUnderlay={!!plan.underlay} />
          </aside>
          <main className={cn('grid min-w-0 flex-1', viewMode === 'split' ? 'grid-rows-2 xl:grid-cols-2 xl:grid-rows-1' : 'grid-cols-1')}>
            {show2d && (
              <div className="min-h-0 min-w-0 border-b xl:border-b-0 xl:border-r">
                <PlanEditor2D editor={editor} tool={tool} setTool={setTool} wallThickness={wallThickness} underlayUrl={underlayUrl} />
              </div>
            )}
            {show3d && (
              <div className="relative min-h-0 min-w-0">
                <Viewport3D ref={viewport} plan={plan} ctx={ctxRef.current} ctxVersion={ctxVersion} selectionId={selectedId} mode={mode3d} onPick={onPick} />
                <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                  {brush ? 'Click walls, floors, ceilings or furniture parts to apply the finish · Esc to stop' : mode3d === 'walk' ? 'WASD / arrows to walk · drag to look · click a surface to select it' : 'Drag to orbit · right-drag to pan · scroll to zoom · click to select'}
                </div>
                <div className="absolute bottom-3 right-3 flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => viewport.current?.resetView()}>
                    Reset view
                  </Button>
                  <Button size="sm" variant="secondary" onClick={saveView}>
                    Save view
                  </Button>
                </div>
              </div>
            )}
          </main>
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l bg-background md:block">
            <Inspector projectId={project.id} editor={editor} wallThickness={wallThickness} setWallThickness={setWallThickness} setTool={setTool} onSaveView={show3d ? saveView : null} onGoToView={goToView} />
          </aside>
        </div>

        <FinishPicker open={brushPicker} onOpenChange={setBrushPicker} title="Finish brush" value={brush} onPick={(v) => (setBrush(v), v && !show3d && setViewMode('split'))} />
        <RenderDialog
          open={dialog === 'render'}
          onOpenChange={(o) => setDialog(o ? 'render' : null)}
          projectId={project.id}
          plan={plan}
          ctx={ctxRef.current}
          currentPose={() => (show3d ? viewport.current?.getPose() ?? null : null)}
          onShowRenders={() => setDialog('renders')}
        />
        <RendersDialog open={dialog === 'renders'} onOpenChange={(o) => setDialog(o ? 'renders' : null)} projectId={project.id} />
        <ShareDialog open={dialog === 'share'} onOpenChange={(o) => setDialog(o ? 'share' : null)} projectId={project.id} projectName={name} />
        <BomDialog open={dialog === 'bom'} onOpenChange={(o) => setDialog(o ? 'bom' : null)} plan={plan} projectName={name} clientId={project.clientId} />
      </div>
    </DesignerLibrariesContext.Provider>
  )
}

function SaveBadge({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    saved: { label: 'Saved', icon: <Check className="h-3 w-3" />, cls: 'text-muted-foreground' },
    dirty: { label: 'Unsaved', icon: null, cls: 'text-muted-foreground' },
    saving: { label: 'Saving…', icon: <Loader2 className="h-3 w-3 animate-spin" />, cls: 'text-muted-foreground' },
    error: { label: 'Save failed — retrying on next edit', icon: null, cls: 'text-destructive' },
    conflict: { label: 'Not saved', icon: null, cls: 'text-amber-600' },
  }
  const s = map[status]
  return <span className={cn('flex items-center gap-1 text-xs', s.cls)}>{s.icon}{s.label}</span>
}
