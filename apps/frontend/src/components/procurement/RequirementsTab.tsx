import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Plus, ShoppingCart, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/common/EmptyState'
import { useProcurementItems } from '@/hooks/useProcurement'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ItemDialog } from './ItemDialog'
import { ITEM_STATUS_COLORS, ITEM_STATUS_LABELS, landedTotal } from './common'
import type { ProcurementItem } from '@/types'

interface VendorBatch {
  vendorId: string
  vendorName: string
  projectId: string | null
  items: ProcurementItem[]
  total: number
}

export function RequirementsTab({ projectId }: { projectId?: string }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: items = [], isLoading } = useProcurementItems({ projectId })

  const visible = status ? items.filter((i) => i.status === status) : items.filter((i) => i.status !== 'cancelled')

  // Approved items not yet on a PO, one batch per vendor (and project), so a
  // single PO can be raised for everything bought from that vendor.
  const readyToOrder = useMemo(() => {
    const batches = new Map<string, VendorBatch>()
    for (const item of items) {
      const q = item.approvedQuote
      if (item.status !== 'approved' || !q?.vendorId) continue
      const key = `${q.vendorId}:${item.projectId ?? ''}`
      const batch = batches.get(key) ?? {
        vendorId: q.vendorId, vendorName: q.vendorName ?? 'Vendor', projectId: item.projectId ?? null, items: [], total: 0,
      }
      batch.items.push(item)
      batch.total += landedTotal(q, item.quantity) ?? 0
      batches.set(key, batch)
    }
    return [...batches.values()]
  }, [items])

  const orderBatch = (b: VendorBatch) =>
    navigate(`/procurement/orders/new?vendorId=${b.vendorId}&itemIds=${b.items.map((i) => i.id).join(',')}${b.projectId ? `&projectId=${b.projectId}` : ''}`)

  return (
    <div className="space-y-5">
      {readyToOrder.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <p className="text-sm font-semibold">Ready to order</p>
              <span className="text-xs text-muted-foreground">Approved quotes not yet on a purchase order</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {readyToOrder.map((b) => (
                <div key={`${b.vendorId}:${b.projectId}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.vendorName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {b.items.length} item{b.items.length > 1 ? 's' : ''}
                      {!projectId && b.items[0].projectName ? ` · ${b.items[0].projectName}` : ''}
                      {' · '}{formatCurrency(b.total)}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => orderBatch(b)}>Create PO</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Status</p>
          <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All active</SelectItem>
              {(Object.keys(ITEM_STATUS_LABELS) as (keyof typeof ITEM_STATUS_LABELS)[]).map((s) => (
                <SelectItem key={s} value={s}>{ITEM_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Requirement
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={items.length === 0 ? 'Nothing to buy yet' : 'No requirements with this status'}
          description="List what the project needs — plywood, laminates, hardware, tiles — then compare vendor quotes side by side and order the best one."
          action={{ label: 'New Requirement', onClick: () => setDialogOpen(true) }}
        />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {visible.map((item) => {
              const approved = item.approvedQuote
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(`/procurement/items/${item.id}`)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{item.title}</span>
                      <Badge className={ITEM_STATUS_COLORS[item.status]}>{ITEM_STATUS_LABELS[item.status]}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {item.quantity} {item.unit}
                      {!projectId && item.projectName && ` · ${item.projectName}`}
                      {item.neededBy && ` · by ${formatDate(item.neededBy)}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {approved ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums">{formatCurrency(approved.price ?? 0)}/{approved.unit ?? item.unit}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[160px]">{approved.vendorName}</p>
                      </>
                    ) : item.quoteCount ? (
                      <>
                        <p className="text-sm tabular-nums">
                          {item.lowestPrice !== null ? `from ${formatCurrency(item.lowestPrice!)}` : 'No prices'}
                        </p>
                        <p className="text-xs text-muted-foreground">{item.quoteCount} quote{item.quoteCount > 1 ? 's' : ''}</p>
                      </>
                    ) : (
                      <p className="text-xs text-amber-600 dark:text-amber-400">No quotes yet</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              )
            })}
          </CardContent>
        </Card>
      )}

      <ItemDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultProjectId={projectId} />
    </div>
  )
}
