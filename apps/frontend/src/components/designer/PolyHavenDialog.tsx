import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'
import { designerApi } from '@/api/designer'
import { apiErrorMessage } from '@/api/visualizer'

const CATEGORIES = ['furniture', 'seating', 'table', 'shelves', 'bed', 'lighting', 'decorative', 'appliances', 'electronics', 'potted plants', 'vases', 'wall decoration', 'dishes', 'books']

/** Browse Poly Haven's CC0 model library and import models into the user's catalog. */
export function PolyHavenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [category, setCategory] = useState('furniture')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data, isLoading, error } = useQuery({
    queryKey: ['designer', 'polyhaven', category],
    queryFn: () => designerApi.listPolyHaven(category),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  })
  const list = (data ?? []).filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()))

  const importModel = async (id: string, name: string) => {
    setBusy((s) => new Set(s).add(id))
    try {
      await designerApi.importPolyHaven(id)
      await Promise.all([qc.invalidateQueries({ queryKey: ['designer', 'models'] }), qc.invalidateQueries({ queryKey: ['designer', 'polyhaven'] })])
      toast({ title: `${name} added to My models` })
    } catch (err) {
      toast({ title: 'Import failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Free 3D models (CC0)</DialogTitle>
          <DialogDescription>
            Photoreal models from Poly Haven, free for commercial use without attribution. Imported models are stored in your catalog.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs capitalize', category === c ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              {c}
            </button>
          ))}
        </div>
        <Input placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 max-w-xs" />
        <div className="max-h-[55vh] overflow-y-auto">
          {isLoading ? (
            <LoadingSpinner />
          ) : error ? (
            <p className="py-10 text-center text-sm text-destructive">{apiErrorMessage(error)}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {list.map((m) => (
                <div key={m.id} className="overflow-hidden rounded-md border">
                  <img src={m.thumbnailUrl} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain" />
                  <div className="space-y-1 p-1.5">
                    <p className="truncate text-xs font-medium" title={m.name}>
                      {m.name}
                    </p>
                    {m.dimensions && (
                      <p className="text-[10px] text-muted-foreground">
                        {m.dimensions.map((d) => Math.round(d)).join(' × ')} mm
                      </p>
                    )}
                    <Button size="sm" variant={m.imported ? 'secondary' : 'default'} className="h-7 w-full gap-1 text-xs" disabled={m.imported || busy.has(m.id)} onClick={() => importModel(m.id, m.name)}>
                      {busy.has(m.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : m.imported ? <Check className="h-3 w-3" /> : <Download className="h-3 w-3" />}
                      {m.imported ? 'Imported' : busy.has(m.id) ? 'Importing…' : 'Import'}
                    </Button>
                  </div>
                </div>
              ))}
              {!list.length && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No models in this category.</p>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
