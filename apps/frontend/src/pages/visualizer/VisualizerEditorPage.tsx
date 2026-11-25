import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Brush,
  Calculator,
  CheckCircle2,
  Columns2,
  Download,
  Hand,
  ImageUp,
  Link2,
  Loader2,
  Maximize,
  MousePointerClick,
  PenTool,
  Pipette,
  Redo2,
  ScanSearch,
  Shield,
  Square,
  Undo2,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { useVizMaterials, useVizProject } from '@/hooks/useVisualizer'
import { useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, type VizProject } from '@/api/visualizer'
import type { VizMaterial } from '@/lib/visualizer/types'
import { RangeField, Segmented, surfaceColor } from '@/components/visualizer/common'
import { EditorCanvas, type EditorCanvasHandle, type Tool, type ToolSettings, type ViewMode } from '@/components/visualizer/editor/EditorCanvas'
import { SurfacesPanel } from '@/components/visualizer/editor/SurfacesPanel'
import { MaterialPanel } from '@/components/visualizer/editor/MaterialPanel'
import { OptionsBar } from '@/components/visualizer/editor/OptionsBar'
import { ExportDialog } from '@/components/visualizer/editor/ExportDialog'
import { CompareDialog } from '@/components/visualizer/editor/CompareDialog'
import { EstimateDialog } from '@/components/visualizer/editor/EstimateDialog'
import { ShareDialog } from '@/components/visualizer/editor/ShareDialog'
import { ReplaceRenderDialog } from '@/components/visualizer/editor/ReplaceRenderDialog'
import { ScenePanel } from '@/components/visualizer/editor/ScenePanel'
import type { SamModelKey } from '@/lib/visualizer/samClient'
import { useVizEditor } from '@/components/visualizer/editor/useVizEditor'

export function VisualizerEditorPage() {
  const { id = '' } = useParams()
  const { data: project, isLoading, isError, error } = useVizProject(id)
  const { data: materials, isLoading: materialsLoading } = useVizMaterials()
  if (isLoading || materialsLoading) return <LoadingSpinner />
  if (isError || !project) {
    return (
      <div className="space-y-3 py-16 text-center">
        <p className="font-medium">Could not open this visualization.</p>
        <p className="text-sm text-muted-foreground">{apiErrorMessage(error)}</p>
        <Link to="/visualizer" className="text-sm text-primary underline">Back to visualizations</Link>
      </div>
    )
  }
  return <Editor key={project.id} project={project} materials={materials ?? []} />
}

const TOOLS: { id: Tool; label: string; icon: typeof Hand; key: string; hint: string }[] = [
  { id: 'pan', label: 'Pan', icon: Hand, key: 'H', hint: 'Drag to move · scroll to zoom · hold Space anywhere' },
  { id: 'ai', label: 'AI select', icon: Wand2, key: 'A', hint: 'Click a surface (Alt/right-click to exclude) or drag a box' },
  { id: 'wand', label: 'Smart select', icon: MousePointerClick, key: 'W', hint: 'Click to select similar connected colour' },
  { id: 'polygon', label: 'Polygon', icon: PenTool, key: 'P', hint: 'Click corners; click the first point or double-click to close' },
  { id: 'brush', label: 'Brush', icon: Brush, key: 'B', hint: 'Paint to correct · Alt inverts · [ ] size' },
  { id: 'corners', label: 'Perspective', icon: Square, key: 'C', hint: 'Drag the 4 corners onto a real rectangle on this plane' },
  { id: 'calibrate', label: 'Calibrate light', icon: Pipette, key: 'K', hint: 'Click a white wall or ceiling to measure the scene’s exposure and light colour' },
]

const SAM_MODEL_KEY = 'viz.samModel'
function storedSamModel(): SamModelKey {
  try {
    return localStorage.getItem(SAM_MODEL_KEY) === 'accurate' ? 'accurate' : 'fast'
  } catch {
    return 'fast'
  }
}

const SELECTION_TOOLS: Tool[] = ['ai', 'wand', 'polygon', 'brush']

function Editor({ project, materials }: { project: VizProject; materials: VizMaterial[] }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const editor = useVizEditor(project, materials)
  const canvas = useRef<EditorCanvasHandle>(null)
  const [projectName, setProjectName] = useState(project.name)
  const [tool, setTool] = useState<Tool>('ai')
  const [target, setTarget] = useState<'surface' | 'protect'>('surface')
  const [activeSurfaceId, setActiveSurfaceId] = useState<string | null>(project.state.surfaces[0]?.id ?? null)
  const [view, setView] = useState<ViewMode>('result')
  const [holdOriginal, setHoldOriginal] = useState(false)
  const [showSelection, setShowSelection] = useState(true)
  const [samStatus, setSamStatus] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [estimateOpen, setEstimateOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const lastTool = useRef<Tool>('ai')
  const [settings, setSettings] = useState<ToolSettings>({
    brushSize: Math.max(8, Math.round(Math.max(project.width, project.height) / 120)),
    brushHardness: 0.8,
    brushMode: 'add',
    polygonMode: 'add',
    wandTolerance: 14,
    wandContiguous: true,
    wandLightness: 0.35,
    samModel: storedSamModel(),
  })
  const set = (patch: Partial<ToolSettings>) => {
    if (patch.samModel) {
      try {
        localStorage.setItem(SAM_MODEL_KEY, patch.samModel)
      } catch {
        /* preference only */
      }
    }
    setSettings((s) => ({ ...s, ...patch }))
  }
  const chooseTool = (t: Tool) => {
    if (t !== 'calibrate') lastTool.current = t
    setTool(t)
  }
  const onCalibrate = useCallback(
    (point: [number, number], white: [number, number, number]) => {
      const lum = 0.2126 * white[0] + 0.7152 * white[1] + 0.0722 * white[2]
      if (lum < 0.02) {
        toast({ title: 'That spot is too dark to calibrate from', description: 'Click a white wall or ceiling that is lit.', variant: 'destructive' })
        return
      }
      editor.setState((s) => ({ ...s, calibration: { enabled: true, white, albedo: s.calibration?.albedo ?? 0.85, point } }))
      toast({ title: 'Scene light calibrated', description: 'New materials now follow the render’s exposure and light colour.' })
      setTool(lastTool.current)
    },
    [editor, toast]
  )

  const activeIndex = editor.state.surfaces.findIndex((s) => s.id === activeSurfaceId)
  const activeSurface = activeIndex >= 0 ? editor.state.surfaces[activeIndex] : null
  const onError = useCallback((message: string) => toast({ title: message, variant: 'destructive' }), [toast])

  // Keep a valid active surface when surfaces change.
  useEffect(() => {
    if (activeSurfaceId && !editor.state.surfaces.some((s) => s.id === activeSurfaceId)) setActiveSurfaceId(editor.state.surfaces[0]?.id ?? null)
  }, [editor.state.surfaces, activeSurfaceId])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) editor.redo()
        else editor.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        editor.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void editor.save()
        return
      }
      if (mod || e.altKey) return
      if (e.key === 'Enter') {
        canvas.current?.applyProposal(e.shiftKey ? 'subtract' : 'add')
        canvas.current?.closePolygon()
        return
      }
      if (e.key === 'Tab' && tool === 'ai') {
        e.preventDefault()
        canvas.current?.cycleProposal(e.shiftKey ? -1 : 1)
        return
      }
      if (e.key === 'Escape') {
        canvas.current?.clearProposal()
        canvas.current?.cancelPolygon()
        return
      }
      if (e.key === 'Backspace' && tool === 'polygon') {
        canvas.current?.popPolygonPoint()
        return
      }
      if (e.key === '[') return set({ brushSize: Math.max(1, Math.round(settings.brushSize / 1.25)) })
      if (e.key === ']') return set({ brushSize: Math.min(800, Math.round(settings.brushSize * 1.25) + 1) })
      if (e.key.toLowerCase() === 'o' && !e.repeat) return setHoldOriginal(true)
      if (e.key.toLowerCase() === 'f') return canvas.current?.fit()
      const tl = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (tl) chooseTool(tl.id)
    }
    const onUp = (e: KeyboardEvent) => e.key.toLowerCase() === 'o' && setHoldOriginal(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  }, [editor, tool, settings.brushSize])

  const savedName = useRef(project.name)
  const saveName = async () => {
    const name = projectName.trim().slice(0, 255)
    if (!name || name === savedName.current) return setProjectName(savedName.current)
    try {
      if (!(await editor.rename(name))) throw new Error(editor.saveError ?? 'Save failed')
      savedName.current = name
      setProjectName(name)
      qc.invalidateQueries({ queryKey: ['visualizer', 'projects'], exact: true })
    } catch (err) {
      toast({ title: 'Rename failed', description: apiErrorMessage(err), variant: 'destructive' })
      setProjectName(savedName.current)
    }
  }

  const effectiveView: ViewMode = holdOriginal ? 'original' : view
  const report = editor.frame?.quality === 'full' ? editor.frame.report : null
  const activeTool = TOOLS.find((t) => t.id === tool)!

  if (editor.loadError) {
    return (
      <div className="space-y-3 py-16 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
        <p className="font-medium">{editor.loadError}</p>
        <Link to="/visualizer" className="text-sm text-primary underline">Back to visualizations</Link>
      </div>
    )
  }

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] flex-col sm:-m-6 sm:h-[calc(100dvh-4rem)]">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <Link
          to="/visualizer"
          className="rounded-md p-1.5 hover:bg-accent"
          aria-label="Back to visualizations"
          onClick={async (e) => {
            // In-app navigation skips the browser's unsaved-changes prompt: save first.
            e.preventDefault()
            if ((await editor.save()) || window.confirm('Your latest changes could not be saved. Leave anyway?')) navigate('/visualizer')
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="h-8 w-48 border-transparent px-1.5 font-semibold hover:border-input focus:border-input"
          aria-label="Project name"
        />
        <SaveBadge status={editor.saveStatus} error={editor.saveError} onRetry={() => void editor.save()} />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setReplaceOpen(true)} disabled={!editor.ready} aria-label="Replace render" title="Replace the render with a new version of the same view">
          <ImageUp className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <OptionsBar editor={editor} />
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={editor.undo} disabled={!editor.canUndo} aria-label="Undo selection edit" title="Undo (Ctrl+Z)">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={editor.redo} disabled={!editor.canRedo} aria-label="Redo selection edit" title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="h-4 w-4" />
          </Button>
          <div className="w-52">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'result', label: 'Result' },
                { value: 'split', label: 'Before | After' },
                { value: 'original', label: 'Original', title: 'Hold O to peek' },
              ]}
            />
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setCompareOpen(true)} disabled={!editor.ready}>
            <Columns2 className="h-4 w-4" /> Compare
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setEstimateOpen(true)} disabled={!editor.ready} data-testid="viz-quantities">
            <Calculator className="h-4 w-4" /> Quantities
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShareOpen(true)} disabled={!editor.ready} data-testid="viz-share">
            <Link2 className="h-4 w-4" /> Share
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setExportOpen(true)} disabled={!editor.ready} data-testid="viz-export">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Tool rail */}
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-background px-2 py-1 lg:w-14 lg:flex-col lg:border-b-0 lg:border-r lg:px-0 lg:py-2">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => chooseTool(t.id)}
              title={`${t.label} (${t.key}) — ${t.hint}`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              className={cn('flex h-10 w-10 items-center justify-center rounded-md transition-colors', tool === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
              data-testid={`viz-tool-${t.id}`}
            >
              <t.icon className="h-5 w-5" />
            </button>
          ))}
          <div className="mx-1 h-8 w-px bg-border lg:mx-0 lg:my-1 lg:h-px lg:w-8" />
          <button
            type="button"
            onClick={() => setTarget((x) => (x === 'protect' ? 'surface' : 'protect'))}
            title="Protect mode: selection tools mark details (handles, seams, decor) that must never change"
            aria-label="Toggle protect mode"
            aria-pressed={target === 'protect'}
            className={cn('flex h-10 w-10 items-center justify-center rounded-md transition-colors', target === 'protect' ? 'bg-red-600 text-white' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
            data-testid="viz-protect-toggle"
          >
            <Shield className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => canvas.current?.fit()} title="Fit to screen (F)" aria-label="Fit to screen" className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <Maximize className="h-5 w-5" />
          </button>
        </div>

        {/* Canvas */}
        <div className="relative min-h-[50vh] min-w-0 flex-1">
          <EditorCanvas
            ref={canvas}
            editor={editor}
            tool={tool}
            target={target}
            activeSurfaceId={activeSurfaceId}
            activeColor={surfaceColor(Math.max(0, activeIndex))}
            settings={settings}
            view={effectiveView}
            // Tint selections only while selecting, so Pan/Perspective show the clean result.
            showSelection={showSelection && effectiveView !== 'original' && SELECTION_TOOLS.includes(tool)}
            onSamStatus={setSamStatus}
            onError={onError}
            onCalibrate={onCalibrate}
          />
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
            <span className={cn('w-fit rounded-md px-2 py-1 text-xs font-medium shadow', target === 'protect' ? 'bg-red-600 text-white' : 'bg-background/90')}>
              {activeTool.label} → {target === 'protect' ? 'Protected areas' : activeSurface?.name ?? 'no surface selected'}
            </span>
            <span className="w-fit rounded-md bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground shadow">{activeTool.hint}</span>
          </div>
        </div>

        {/* Right panel */}
        <aside className="max-h-[45vh] w-full shrink-0 space-y-5 overflow-y-auto border-t bg-background p-3 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
          <ToolOptions tool={tool} target={target} settings={settings} set={set} showSelection={showSelection} setShowSelection={setShowSelection} />
          <SurfacesPanel editor={editor} activeId={activeSurfaceId} onSelect={setActiveSurfaceId} onEditCorners={() => chooseTool('corners')} />
          <div className="border-t pt-4">
            <ScenePanel editor={editor} picking={tool === 'calibrate'} onPick={() => chooseTool(tool === 'calibrate' ? lastTool.current : 'calibrate')} />
          </div>
          <div className="border-t pt-4">
            <MaterialPanel editor={editor} surface={activeSurface} />
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-background px-3 py-1.5 text-xs text-muted-foreground" data-testid="viz-status">
        <span>{editor.W}×{editor.H}px</span>
        {editor.rendering ? (
          <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Rendering{editor.frame?.quality === 'preview' ? ' (preview shown)' : ''}…</span>
        ) : editor.frame ? (
          <span>Rendered in {Math.round(editor.frame.ms)} ms</span>
        ) : null}
        {report && (
          <span className={cn('flex items-center gap-1', report.ok ? 'text-green-700 dark:text-green-500' : 'text-destructive')} data-testid="viz-verify">
            {report.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {report.ok
              ? `Integrity OK — ${report.protectedPixels.toLocaleString()} px outside selection unchanged`
              : `${report.changedOutsideMask} px outside selection changed!`}
          </span>
        )}
        {editor.frame?.skipped.map((s) => (
          <span key={s.id} className="text-amber-600">
            {editor.state.surfaces.find((x) => x.id === s.id)?.name}: {s.reason}
          </span>
        ))}
        {editor.texturesLoading.length > 0 && <span>Loading textures…</span>}
        {samStatus && <span className="flex items-center gap-1 text-primary"><ScanSearch className="h-3 w-3" /> {samStatus}</span>}
        {editor.renderError && <span className="text-destructive">{editor.renderError}</span>}
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} editor={editor} project={{ ...project, name: projectName }} />
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} editor={editor} />
      <ReplaceRenderDialog open={replaceOpen} onOpenChange={setReplaceOpen} editor={editor} projectId={project.id} />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} editor={editor} projectId={project.id} projectName={projectName} />
      <EstimateDialog open={estimateOpen} onOpenChange={setEstimateOpen} editor={editor} projectName={projectName} clientId={project.clientId} />
    </div>
  )
}

function SaveBadge({ status, error, onRetry }: { status: string; error: string | null; onRetry: () => void }) {
  if (status === 'saving') return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>
  if (status === 'dirty') return <span className="text-xs text-muted-foreground">Unsaved changes</span>
  if (status === 'conflict') {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" title={error ?? ''}>
        <AlertTriangle className="h-3 w-3" /> Changed elsewhere —
        <button type="button" className="underline" onClick={() => window.location.reload()}>reload</button>
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" title={error ?? ''}>
        <AlertTriangle className="h-3 w-3" /> Save failed —
        <button type="button" className="underline" onClick={onRetry}>retry</button>
      </span>
    )
  }
  return <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="viz-saved"><CheckCircle2 className="h-3 w-3" /> Saved</span>
}

function ToolOptions({
  tool,
  target,
  settings,
  set,
  showSelection,
  setShowSelection,
}: {
  tool: Tool
  target: 'surface' | 'protect'
  settings: ToolSettings
  set: (p: Partial<ToolSettings>) => void
  showSelection: boolean
  setShowSelection: (v: boolean) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{target === 'protect' ? 'Protected areas' : 'Selection'}</h3>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showSelection} onChange={(e) => setShowSelection(e.target.checked)} /> Show overlay
        </label>
      </div>
      {target === 'protect' && (
        <p className="rounded-md bg-red-50 p-2 text-[11px] text-red-800 dark:bg-red-950 dark:text-red-200">
          Mark handles, hinges, seams and decor. Protected pixels are never modified by any surface, in any option.
        </p>
      )}
      {tool === 'brush' && (
        <>
          <Segmented value={settings.brushMode} onChange={(v) => set({ brushMode: v })} options={[{ value: 'add', label: 'Paint' }, { value: 'subtract', label: 'Erase' }]} />
          <RangeField label="Size" value={settings.brushSize} min={1} max={800} step={1} onChange={(v) => set({ brushSize: v })} format={(v) => `${v}px`} />
          <RangeField label="Hardness" value={settings.brushHardness} min={0} max={1} step={0.05} onChange={(v) => set({ brushHardness: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </>
      )}
      {tool === 'polygon' && (
        <Segmented value={settings.polygonMode} onChange={(v) => set({ polygonMode: v })} options={[{ value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' }]} />
      )}
      {tool === 'wand' && (
        <>
          <RangeField label="Tolerance" value={settings.wandTolerance} min={1} max={60} step={1} onChange={(v) => set({ wandTolerance: v })} hint="Higher selects a wider range of colours" />
          <RangeField label="Ignore shading" value={1 - settings.wandLightness} min={0} max={1} step={0.05} onChange={(v) => set({ wandLightness: 1 - v })} format={(v) => `${Math.round(v * 100)}%`} hint="Higher lets the selection run across shadows on one material" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={settings.wandContiguous} onChange={(e) => set({ wandContiguous: e.target.checked })} /> Connected areas only
          </label>
        </>
      )}
      {tool === 'ai' && (
        <>
          <Segmented
            value={settings.samModel}
            onChange={(v) => set({ samModel: v })}
            options={[
              { value: 'fast', label: 'Fast (14MB)', title: 'SlimSAM — quick to download and run' },
              { value: 'accurate', label: 'Accurate (106MB)', title: 'SAM ViT-B — tighter outlines on thin trims and handles; larger one-time download' },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            Click the surface to get a suggestion; add more clicks to refine (Alt/right-click excludes). Use ◀ ▶ or Tab to switch between the part and the whole
            (e.g. one shutter ↔ the whole wardrobe), and <span className="font-medium text-foreground">HD edges</span> to re-analyse just that area at full
            resolution. Suggestions are snapped to the render’s edges; review handles and thin trims, then correct with Brush or Polygon.
          </p>
        </>
      )}
      {tool === 'calibrate' && (
        <p className="text-[11px] text-muted-foreground">
          Click a lit white wall or ceiling. Its colour and brightness set the scene’s exposure and light colour for every new material.
        </p>
      )}
      {tool === 'corners' && (
        <p className="text-[11px] text-muted-foreground">
          Align the yellow grid with the surface’s real rectangle so grain and tiles follow its perspective. The corners may lie outside the selection.
        </p>
      )}
    </div>
  )
}
