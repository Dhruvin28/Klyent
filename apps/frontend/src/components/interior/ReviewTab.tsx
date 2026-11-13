import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Crosshair, Layers, Loader2, Ruler, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { interiorApi } from '@/api/interior'
import { apiErrorMessage } from '@/api/visualizer'
import { interiorKeys, useInteriorPage, usePageImageUrl } from '@/hooks/useInterior'
import { PLAN_VIEW_ROLES, ROLE_LABEL, type Box, type Pt, type Registration, type Units, type WorkspaceSummary } from '@/lib/interior/types'
import { LAYERS, PageCanvas, type Layer } from './PageCanvas'
import { fmtMm } from './common'

const LAYER_LABEL: Record<Layer, string> = {
  walls: 'Walls',
  openings: 'Doors/windows',
  rooms: 'Rooms',
  furniture: 'Furniture',
  dimensions: 'Dimensions',
  ceilings: 'Ceiling zones',
  lights: 'Lights',
  elevation: 'Elevation',
  text: 'Text tokens',
  issues: 'AI notes',
}

export function ReviewTab({
  summary,
  pageId,
  setPageId,
  registrations,
  highlight,
}: {
  summary: WorkspaceSummary
  pageId: string | null
  setPageId: (id: string) => void
  registrations: Registration[]
  highlight: Box | null
}) {
  const pages = summary.pages.filter((p) => p.status !== 'excluded')
  const current = pageId ?? pages[0]?.id ?? null
  const meta = summary.pages.find((p) => p.id === current)
  const { data: page, isLoading } = useInteriorPage(current, meta ? `${meta.interpretationKey}:${JSON.stringify(meta.calibration)}` : null)
  const imageUrl = usePageImageUrl(current, 'full')
  const [layers, setLayers] = useState<Set<Layer>>(new Set(['walls', 'openings', 'rooms', 'furniture', 'dimensions', 'ceilings', 'lights', 'elevation', 'issues']))
  const [picking, setPicking] = useState(false)
  const [picks, setPicks] = useState<Pt[]>([])
  const [distance, setDistance] = useState('')
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const { toast } = useToast()
  const reg = registrations.find((r) => r.pageId === current)
  const [dx, setDx] = useState('')
  const [dy, setDy] = useState('')

  useEffect(() => {
    setPicking(false)
    setPicks([])
    setDistance('')
    setDx(meta?.registration ? String(meta.registration.dxMm) : reg ? String(Math.round(reg.offsetMm.x)) : '')
    setDy(meta?.registration ? String(meta.registration.dyMm) : reg ? String(Math.round(reg.offsetMm.y)) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  const save = async (body: Parameters<typeof interiorApi.updatePage>[1], ok: string) => {
    if (!current) return
    setBusy(true)
    try {
      await interiorApi.updatePage(current, body)
      await qc.invalidateQueries({ queryKey: interiorKeys.workspace(summary.workspace.id) })
      await qc.invalidateQueries({ queryKey: interiorKeys.page(current) })
      toast({ title: ok, description: summary.workspace.autoBuild ? 'The model will rebuild automatically.' : 'Rebuild the 3D model to apply it.' })
    } catch (err) {
      toast({ title: 'Could not save', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const cal = page?.computedCalibration
  const pxDist = picks.length === 2 ? Math.hypot(picks[1].x - picks[0].x, picks[1].y - picks[0].y) : 0
  const counts = useMemo(() => {
    const it = page?.interpretation
    if (!it) return []
    return [
      ['Walls', it.walls.length],
      ['Openings', it.openings.length],
      ['Rooms', it.rooms.length],
      ['Furniture', it.furniture.length],
      ['Dimensions', it.dimensions.length + (it.elevation?.heightDimensions.length ?? 0)],
      ['Ceiling zones', it.ceilingZones.length],
      ['Lights', it.lights.length],
      ['Elevation features', it.elevation?.features.length ?? 0],
    ].filter(([, n]) => (n as number) > 0) as [string, number][]
  }, [page])

  if (!pages.length) return <p className="py-10 text-center text-sm text-muted-foreground">Upload drawings first.</p>

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
      <div className="space-y-1 lg:max-h-[75vh] lg:overflow-y-auto">
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPageId(p.id)}
            className={cn('w-full rounded-md border px-2 py-1.5 text-left text-xs', p.id === current ? 'border-primary bg-primary/5' : 'hover:bg-muted')}
          >
            <p className="truncate font-medium">{p.title ?? `Page ${p.pageIndex + 1}`}</p>
            <p className="text-muted-foreground">
              {ROLE_LABEL[p.effectiveRole]}
              {p.status !== 'interpreted' && ` · ${p.status}`}
            </p>
          </button>
        ))}
      </div>

      <div className="relative min-h-[60vh] overflow-hidden rounded-lg border">
        {isLoading || !page ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <PageCanvas
            page={page}
            imageUrl={imageUrl}
            layers={layers}
            calibration={cal}
            highlight={highlight && pageId === current ? highlight : null}
            picking={picking}
            picks={picks}
            onPick={(p) => setPicks((prev) => (prev.length >= 2 ? [p] : [...prev, p]))}
            className="h-[60vh] lg:h-[75vh]"
          />
        )}
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
          {picking ? 'Click two points of a known distance' : 'Scroll to zoom · drag to pan · double-click to fit · hover shapes for details'}
        </div>
      </div>

      <div className="space-y-4 text-sm lg:max-h-[75vh] lg:overflow-y-auto">
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 font-semibold">
            <Layers className="h-4 w-4" /> Layers
          </h4>
          <div className="flex flex-wrap gap-1">
            {LAYERS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLayers((s) => (s.has(l) ? new Set([...s].filter((x) => x !== l)) : new Set([...s, l])))}
                className={cn('rounded-full border px-2 py-0.5 text-xs', layers.has(l) ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}
              >
                {LAYER_LABEL[l]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Dimensions: <span className="text-emerald-600">green</span> = used for scale, <span className="text-red-600">red</span> = disagrees with the drawn length,{' '}
            <span className="text-amber-600">amber</span> = read by vision only. Furniture: thick edge = front.
          </p>
        </section>

        {page && cal && (
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 font-semibold">
              <Ruler className="h-4 w-4" /> Scale
            </h4>
            <div className="rounded-md bg-muted/50 p-2 text-xs">
              <p>
                <span className={cn('font-medium', cal.status === 'verified' ? 'text-emerald-700 dark:text-emerald-400' : cal.status === 'provisional' ? 'text-amber-700 dark:text-amber-400' : 'text-red-700')}>{cal.status}</span> ·{' '}
                {cal.method.replace('_', ' ')} · {cal.mmPerPx ? `${cal.mmPerPx.toFixed(4)} mm/px` : 'no scale'}
                {cal.spread !== null && ` · spread ${(cal.spread * 100).toFixed(2)}%`}
              </p>
              <p className="text-muted-foreground">
                Units: {cal.units} ({cal.unitsSource}){page.interpretation?.sheet.scaleNote && ` · printed scale ${page.interpretation.sheet.scaleNote}`}
              </p>
              {cal.notes.map((n, i) => (
                <p key={i} className="mt-1 text-amber-700 dark:text-amber-400">
                  {n}
                </p>
              ))}
            </div>
            {cal.samples.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-2 py-1">Text</th>
                      <th className="px-2 py-1">Value</th>
                      <th className="px-2 py-1">Drawn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cal.samples.map((s, i) => (
                      <tr key={i} className={s.inlier ? '' : 'text-red-600'}>
                        <td className="px-2 py-0.5">{s.text}</td>
                        <td className="px-2 py-0.5">{fmtMm(s.mm)}</td>
                        <td className="px-2 py-0.5">{cal.mmPerPx ? fmtMm(s.px * cal.mmPerPx) : `${Math.round(s.px)} px`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Drawing units</span>
              <select
                className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
                value={page.calibration?.units ?? ''}
                disabled={busy}
                onChange={(e) => save({ calibration: { ...(page.calibration ?? {}), units: (e.target.value || undefined) as Units | undefined } }, 'Units saved')}
              >
                <option value="">Automatic ({cal.units})</option>
                <option value="mm">Millimetres</option>
                <option value="cm">Centimetres</option>
                <option value="m">Metres</option>
                <option value="ft_in">Feet / inches</option>
              </select>
            </div>
            {!picking ? (
              <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => (setPicking(true), setPicks([]))}>
                <Crosshair className="h-4 w-4" /> Calibrate with a known distance
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border p-2">
                <p className="text-xs">{picks.length < 2 ? `Click point ${picks.length + 1} of 2 on the drawing.` : `${Math.round(pxDist)} px between the points.`}</p>
                <div className="flex gap-1.5">
                  <Input type="number" min={1} placeholder="Distance (mm)" value={distance} onChange={(e) => setDistance(e.target.value)} className="h-8" />
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={busy || picks.length !== 2 || !(Number(distance) > 0)}
                    onClick={async () => {
                      await save({ calibration: { ...(page.calibration ?? {}), manual: { p1: picks[0], p2: picks[1], distanceMm: Number(distance) } } }, 'Calibration saved')
                      setPicking(false)
                    }}
                  >
                    Apply
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => (setPicking(false), setPicks([]))} aria-label="Cancel">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Pick the ends of the longest dimension you trust; two points fix scale only, so other dimensions still cross-check it.</p>
              </div>
            )}
            {page.calibration?.manual && (
              <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => save({ calibration: { ...(page.calibration ?? {}), manual: null } }, 'Manual calibration removed')}>
                Remove manual calibration ({fmtMm(page.calibration.manual.distanceMm)})
              </Button>
            )}
          </section>
        )}

        {page && PLAN_VIEW_ROLES.has(page.effectiveRole) && reg && reg.method !== 'reference' && (
          <section className="space-y-2">
            <h4 className="font-semibold">Alignment to the reference plan</h4>
            <p className="text-xs text-muted-foreground">
              {reg.method.replace('_', ' ')} · {reg.anchors} anchor(s) · residual {reg.residualMm === null ? 'unknown' : fmtMm(reg.residualMm)} ·{' '}
              <span className={reg.status === 'verified' ? 'text-emerald-600' : 'text-amber-600'}>{reg.status}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <Input type="number" value={dx} onChange={(e) => setDx(e.target.value)} className="h-8" aria-label="Offset X (mm)" placeholder="dx mm" />
              <Input type="number" value={dy} onChange={(e) => setDy(e.target.value)} className="h-8" aria-label="Offset Y (mm)" placeholder="dy mm" />
              <Button size="sm" className="h-8" disabled={busy || dx === '' || dy === ''} onClick={() => save({ registration: { dxMm: Number(dx), dyMm: Number(dy) } }, 'Alignment saved')}>
                Set
              </Button>
            </div>
            {page.registration && (
              <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => save({ registration: null }, 'Automatic alignment restored')}>
                Use automatic alignment
              </Button>
            )}
          </section>
        )}

        {page?.interpretation && (
          <section className="space-y-2">
            <h4 className="font-semibold">What the model read</h4>
            <div className="flex flex-wrap gap-1">
              {counts.map(([k, n]) => (
                <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {n} {k.toLowerCase()}
                </span>
              ))}
            </div>
            {page.interpretation.rejectedRefs.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{page.interpretation.rejectedRefs.length} invented text reference(s) were rejected.</p>
            )}
            {page.interpretation.sheet.notes.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {page.interpretation.sheet.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {page.interpretation.issues.map((i, k) => (
              <p key={k} className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <span className="font-medium capitalize">{i.kind}:</span> {i.message}
              </p>
            ))}
          </section>
        )}
        {page && page.extraction.warnings.length > 0 && (
          <section className="space-y-1">
            <h4 className="font-semibold">Extraction</h4>
            {page.extraction.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
                {w}
              </p>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
