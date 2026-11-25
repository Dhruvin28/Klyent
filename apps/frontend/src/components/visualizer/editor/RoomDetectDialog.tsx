import { useEffect, useRef, useState } from 'react'
import { Loader2, ScanSearch } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { hexToRgb } from '@/lib/visualizer/color'
import type { RoomDetection } from '@/lib/visualizer/segClient'
import { SURFACE_TYPES, type SurfaceType, type VizSurface } from '@/lib/visualizer/types'
import { SURFACE_COLORS } from '../common'
import { DEFAULT_SIZE, MAX_SURFACES } from './surfaceDefaults'
import type { VizEditor } from './useVizEditor'

interface Row extends RoomDetection {
  selected: boolean
  name: string
  kind: SurfaceType
}

const PREVIEW_SIDE = 640
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/**
 * Finds the room's surfaces with semantic segmentation and creates the chosen ones as
 * surfaces with their selections (edges snapped to the render, corners auto-fitted).
 */
export function RoomDetectDialog({
  open,
  onOpenChange,
  editor,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editor: VizEditor
  onCreated: (firstId: string) => void
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRows(null)
    setError(null)
    const img = editor.original.current
    const seg = editor.seg.current
    if (!img || !seg) return
    setStatus('Starting…')
    seg
      .detect(img, (p) => setStatus(p.stage === 'download' ? `Downloading room model${p.progress != null ? ` ${Math.round(p.progress * 100)}%` : '…'}` : 'Analysing the room…'))
      .then((found) => {
        if (cancelled) return
        const counts = new Map<SurfaceType, number>()
        const total = found.reduce((m, d) => m.set(d.type, (m.get(d.type) ?? 0) + 1), new Map<SurfaceType, number>())
        setRows(
          found.map((d) => {
            const n = (counts.get(d.type) ?? 0) + 1
            counts.set(d.type, n)
            return { ...d, kind: d.type, selected: true, name: `${cap(d.type)}${(total.get(d.type) ?? 0) > 1 ? ` ${n}` : ''}` }
          })
        )
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Room detection failed'))
      .finally(() => !cancelled && setStatus(null))
    return () => {
      cancelled = true
    }
  }, [open, editor])

  // Preview: the render with each selected detection tinted in its list colour.
  useEffect(() => {
    const c = canvas.current
    const img = editor.original.current
    if (!c || !img || !rows) return
    const s = Math.min(1, PREVIEW_SIDE / Math.max(img.width, img.height))
    const w = Math.round(img.width * s)
    const h = Math.round(img.height * s)
    c.width = w
    c.height = h
    const out = new ImageData(w, h)
    const colours = rows.map((_, i) => hexToRgb(SURFACE_COLORS[i % SURFACE_COLORS.length]))
    for (let y = 0; y < h; y++) {
      const sy = Math.min(img.height - 1, Math.floor(y / s))
      for (let x = 0; x < w; x++) {
        const sx = Math.min(img.width - 1, Math.floor(x / s))
        const p = sy * img.width + sx
        const o = (y * w + x) * 4
        let r = img.data[p * 4], g = img.data[p * 4 + 1], b = img.data[p * 4 + 2]
        for (let k = 0; k < rows.length; k++) {
          if (rows[k].selected && rows[k].mask[p]) {
            const [cr, cg, cb] = colours[k]
            r = r * 0.45 + cr * 0.55
            g = g * 0.45 + cg * 0.55
            b = b * 0.45 + cb * 0.55
            break
          }
        }
        out.data[o] = r
        out.data[o + 1] = g
        out.data[o + 2] = b
        out.data[o + 3] = 255
      }
    }
    c.getContext('2d')!.putImageData(out, 0, 0)
  }, [rows, editor])

  const room = MAX_SURFACES - editor.state.surfaces.length
  const chosen = rows?.filter((r) => r.selected) ?? []

  const create = async () => {
    if (!chosen.length) return
    const engine = editor.engine.current
    if (!engine) return
    setCreating(true)
    try {
      const items: { surface: VizSurface; mask: Uint8Array }[] = []
      for (const r of chosen.slice(0, room)) {
        const [w, h] = DEFAULT_SIZE[r.kind]
        const mask = await engine.snapEdges(r.mask)
        items.push({
          surface: { id: crypto.randomUUID(), name: r.name.trim().slice(0, 120) || cap(r.kind), type: r.kind, maskAssetId: null, quad: null, widthMm: w, heightMm: h, heightManual: false, feather: 1, edgeSnap: true },
          mask,
        })
      }
      editor.addSurfaces(items)
      // Planar, four-sided selections get perspective corners straight away.
      let fitted = 0
      for (const it of items) if (await editor.fitCorners(it.surface.id)) fitted++
      toast({
        title: `${items.length} surface${items.length > 1 ? 's' : ''} added`,
        description: `${fitted} with perspective corners fitted. Check outlines and enter each surface's real width.`,
      })
      onCreated(items[0].surface.id)
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Could not add surfaces', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !creating && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[920px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanSearch className="h-5 w-5" /> Detect room surfaces</DialogTitle>
          <DialogDescription>
            An AI model ({'~'}29MB, downloaded once) labels walls, floor, ceiling, wardrobes, cabinets, doors and countertops. Choose which to add; outlines are
            snapped to the render and can be corrected with Brush or Polygon afterwards.
          </DialogDescription>
        </DialogHeader>

        {status && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" data-testid="viz-detect-status">
            <Loader2 className="h-4 w-4 animate-spin" /> {status}
          </div>
        )}
        {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Room detection failed: {error}</p>}
        {rows && rows.length === 0 && <p className="py-6 text-sm text-muted-foreground">No room surfaces were recognised in this render. Add surfaces by hand instead.</p>}

        {rows && rows.length > 0 && (
          <div className="grid gap-4 md:grid-cols-[1fr_300px]">
            <canvas ref={canvas} className="w-full rounded-md border" />
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto" data-testid="viz-detect-list">
              {rows.map((r, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border p-1.5">
                  <input
                    type="checkbox"
                    checked={r.selected}
                    onChange={(e) => setRows((rs) => rs!.map((x, k) => (k === i ? { ...x, selected: e.target.checked } : x)))}
                    aria-label={`Add ${r.name}`}
                  />
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: SURFACE_COLORS[i % SURFACE_COLORS.length] }} />
                  <input
                    className="h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs"
                    value={r.name}
                    onChange={(e) => setRows((rs) => rs!.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
                    aria-label="Surface name"
                  />
                  <select
                    className="h-7 rounded border bg-background px-1 text-xs"
                    value={r.kind}
                    onChange={(e) => setRows((rs) => rs!.map((x, k) => (k === i ? { ...x, kind: e.target.value as SurfaceType } : x)))}
                    aria-label="Surface type"
                  >
                    {SURFACE_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
                  </select>
                  <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
                    {((r.area / (editor.W * editor.H)) * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          {chosen.length > room && <span className="mr-auto text-xs text-amber-600">Only {room} more surface{room === 1 ? '' : 's'} fit (max {MAX_SURFACES}).</span>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>Cancel</Button>
          <Button onClick={create} disabled={creating || !chosen.length || room <= 0} className="gap-2" data-testid="viz-detect-add">
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            Add {Math.min(chosen.length, Math.max(0, room))} surface{chosen.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
