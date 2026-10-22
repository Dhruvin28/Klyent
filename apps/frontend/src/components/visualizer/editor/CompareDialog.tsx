import { useEffect, useState } from 'react'
import { BadgeCheck, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Segmented } from '../common'
import { SwipeCompare } from '../SwipeCompare'
import type { VizEditor } from './useVizEditor'

async function frameToUrl(pixels: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<string> {
  const max = 1400
  const s = Math.min(1, max / Math.max(w, h))
  const full = new OffscreenCanvas(w, h)
  full.getContext('2d')!.putImageData(new ImageData(pixels, w, h), 0, 0)
  const out = new OffscreenCanvas(Math.round(w * s), Math.round(h * s))
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, 0, 0, out.width, out.height)
  return URL.createObjectURL(await out.convertToBlob({ type: 'image/jpeg', quality: 0.9 }))
}

/** Grid or before/after swipe of the original and every option (rendered at full quality). */
export function CompareDialog({ open, onOpenChange, editor }: { open: boolean; onOpenChange: (o: boolean) => void; editor: VizEditor }) {
  const [items, setItems] = useState<{ id: string; name: string; url: string | null }[]>([])
  const [mode, setMode] = useState<'grid' | 'swipe'>('grid')
  const [left, setLeft] = useState('__original__')
  const [right, setRight] = useState(editor.state.activeOptionId)
  useEffect(() => {
    if (open) setRight(editor.state.approvedOptionId ?? editor.state.activeOptionId)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const leftItem = items.find((x) => x.id === left)
  const rightItem = items.find((x) => x.id === right)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const urls: string[] = []
    const list = [{ id: '__original__', name: 'Original render' }, ...editor.state.options.map((o) => ({ id: o.id, name: o.name }))]
    setItems(list.map((x) => ({ ...x, url: null })))
    ;(async () => {
      const img = editor.original.current
      if (img) {
        const u = await frameToUrl(new Uint8ClampedArray(img.data), img.width, img.height)
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        urls.push(u)
        if (!cancelled) setItems((it) => it.map((x) => (x.id === '__original__' ? { ...x, url: u } : x)))
      }
      for (const o of editor.state.options) {
        if (cancelled) break
        try {
          const f = await editor.renderOption(o.id)
          const u = await frameToUrl(f.pixels, f.width, f.height)
          if (cancelled) {
            URL.revokeObjectURL(u)
            break
          }
          urls.push(u)
          if (!cancelled) setItems((it) => it.map((x) => (x.id === o.id ? { ...x, url: u } : x)))
        } catch {
          /* leave the spinner replaced below */
        }
      }
    })()
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[min(1400px,96vw)]">
        <DialogHeader>
          <DialogTitle>Compare options</DialogTitle>
          <DialogDescription>Every option uses the same surfaces and selections — only the materials differ.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Segmented value={mode} onChange={setMode} options={[{ value: 'grid', label: 'Grid' }, { value: 'swipe', label: 'Swipe' }]} />
          </div>
          {mode === 'swipe' && (
            <>
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={left} onChange={(e) => setLeft(e.target.value)} aria-label="Left image">
                {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">vs</span>
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={right} onChange={(e) => setRight(e.target.value)} aria-label="Right image">
                {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </>
          )}
        </div>
        {mode === 'swipe' ? (
          leftItem?.url && rightItem?.url ? (
            <SwipeCompare before={leftItem.url} after={rightItem.url} beforeLabel={leftItem.name} afterLabel={rightItem.name} />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )
        ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((it) => (
            <figure key={it.id} className="space-y-1.5">
              {it.url ? (
                <img src={it.url} alt={it.name} className="w-full rounded-md border" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
              <figcaption className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  {editor.state.approvedOptionId === it.id && <BadgeCheck className="h-4 w-4 text-green-600" />}
                  {it.name}
                </span>
                {it.id !== '__original__' && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        editor.setState((s) => ({ ...s, activeOptionId: it.id }))
                        onOpenChange(false)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant={editor.state.approvedOptionId === it.id ? 'default' : 'outline'}
                      className="h-7 text-xs"
                      onClick={() => editor.setState((s) => ({ ...s, approvedOptionId: s.approvedOptionId === it.id ? null : it.id }))}
                    >
                      {editor.state.approvedOptionId === it.id ? 'Approved' : 'Approve'}
                    </Button>
                  </div>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
