import { useEffect, useState } from 'react'
import { Loader2, MessageCircle, FileText } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement, useUnlinkedQuotes } from '@/hooks/useProcurement'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { ProcurementItemDetail } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ProcurementItemDetail
}

// Pulls prices the AI extracted from WhatsApp chats and documents into this
// item's comparison.
export function LinkQuotesDialog({ open, onOpenChange, item }: Props) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const [allProjects, setAllProjects] = useState(!item.projectId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setAllProjects(!item.projectId)
  }, [open, item.projectId])

  const { data: quotes = [], isLoading } = useUnlinkedQuotes(allProjects ? null : item.projectId, open)

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleLink = async () => {
    if (selected.size === 0) return
    setSaving(true)
    try {
      await procurementApi.linkQuotes(item.id, [...selected])
      invalidate()
      toast({ title: `${selected.size} quote${selected.size > 1 ? 's' : ''} added to the comparison` })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to link quotes.'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quotes from conversations</DialogTitle>
          <DialogDescription>
            Prices AI Studio picked up from WhatsApp messages and documents. Choose the ones that are for &quot;{item.title}&quot;.
          </DialogDescription>
        </DialogHeader>

        {item.projectId && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={allProjects} onChange={(e) => setAllProjects(e.target.checked)} />
            Show quotes from all projects
          </label>
        )}

        {isLoading ? (
          <LoadingSpinner className="py-10" />
        ) : quotes.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No unassigned quotes{allProjects ? '' : ' for this project'}. Import a WhatsApp chat in AI Studio and vendor prices will show up here.
          </p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border max-h-[50vh] overflow-y-auto">
            {quotes.map((q) => (
              <label key={q.id} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40">
                <input type="checkbox" className="h-4 w-4 mt-1" checked={selected.has(q.id)} onChange={() => toggle(q.id)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{q.materialName || q.description || 'Unnamed item'}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    {q.source === 'whatsapp' ? <MessageCircle className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                    {q.vendorName || 'Unknown vendor'} · {formatDate(q.createdAt)}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0">
                  {q.price !== null ? `${formatCurrency(q.price)}${q.unit ? `/${q.unit}` : ''}` : 'No price'}
                </span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleLink} disabled={saving || selected.size === 0}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Add {selected.size || ''} to comparison
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
