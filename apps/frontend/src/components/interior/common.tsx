import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { designerApi } from '@/api/designer'
import { visualizerApi } from '@/api/visualizer'
import { useVizMaterials } from '@/hooks/useVisualizer'
import { useDesignModelMap } from '@/hooks/useDesigner'
import { MaterialResolver } from '@/lib/designer/materials'
import type { SceneContext } from '@/lib/designer/scene'
import type { VizMaterial } from '@/lib/visualizer/types'
import type { Severity, ValidationStatus, WorkspaceStatus } from '@/lib/interior/types'

/** Scene context (material library + model catalog) shared by the 3D viewer and the path tracer. */
export function useSceneContext() {
  const { data: materials } = useVizMaterials()
  const models = useDesignModelMap()
  const materialMap = useMemo(() => new Map<string, VizMaterial>((materials ?? []).map((m) => [m.id, m])), [materials])
  const ref = useRef<SceneContext | null>(null)
  if (!ref.current) ref.current = { library: new MaterialResolver(materialMap, visualizerApi.getAssetBlob), models, loadAsset: designerApi.getAssetBlob }
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const ctx = ref.current!
    ctx.library.setLibrary(materialMap)
    ctx.models = models
    setVersion((v) => v + 1)
  }, [materialMap, models])
  useEffect(() => () => ref.current?.library.dispose(), [])
  return { ctx: ref.current, version }
}

const WS_STATUS: Record<WorkspaceStatus, { label: string; cls: string }> = {
  empty: { label: 'No drawings', cls: 'bg-muted text-muted-foreground' },
  processing: { label: 'Processing', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200' },
  needs_review: { label: 'Needs review', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  draft_ready: { label: 'Draft ready', cls: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100' },
  ready_for_approval: { label: 'Ready for approval', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
}

export function WorkspaceStatusChip({ status }: { status: WorkspaceStatus }) {
  const s = WS_STATUS[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', s.cls)}>
      {status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
      {s.label}
    </span>
  )
}

export function ValidationChip({ status, blocking, warnings }: { status: ValidationStatus; blocking: number; warnings: number }) {
  if (status === 'blocked')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
        <AlertOctagon className="h-3 w-3" /> {blocking} blocking
      </span>
    )
  if (status === 'passed_with_warnings')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <AlertTriangle className="h-3 w-3" /> Passed · {warnings} warning{warnings === 1 ? '' : 's'}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
      <CheckCircle2 className="h-3 w-3" /> Passed
    </span>
  )
}

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  if (severity === 'blocking') return <AlertOctagon className={cn('h-4 w-4 shrink-0 text-red-600', className)} aria-label="Blocking" />
  if (severity === 'warning') return <AlertTriangle className={cn('h-4 w-4 shrink-0 text-amber-600', className)} aria-label="Warning" />
  return <Info className={cn('h-4 w-4 shrink-0 text-sky-600', className)} aria-label="Info" />
}

export const fmtMm = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v * 10) / 10} mm`)

export function shortHash(h: string | null | undefined) {
  return h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '—'
}
