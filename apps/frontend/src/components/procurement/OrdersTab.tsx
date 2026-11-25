import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ShoppingCart, CheckCircle2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/common/EmptyState'
import { usePurchaseOrders } from '@/hooks/useProcurement'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PO_STATUS_COLORS, PO_STATUS_LABELS } from './common'
import type { PurchaseOrder } from '@/types'

// An order still awaiting goods after its expected date.
export function isDeliveryLate(po: Pick<PurchaseOrder, 'status' | 'expectedDelivery'>): boolean {
  if (po.status !== 'SENT' && po.status !== 'PARTIALLY_RECEIVED') return false
  return !!po.expectedDelivery && new Date(po.expectedDelivery) < new Date(new Date().toDateString())
}

export function OrdersTab({ projectId }: { projectId?: string }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = usePurchaseOrders({ projectId, status: status || undefined, page })

  const orders = data?.data ?? []
  const newOrderUrl = `/procurement/orders/new${projectId ? `?projectId=${projectId}` : ''}`

  return (
    <div className="space-y-5">
      {data?.summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ordered (incl. GST)</p>
            <p className="text-xl font-semibold mt-1">{formatCurrency(data.summary.ordered)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Paid to vendors</p>
            <p className="text-xl font-semibold mt-1 text-green-600 dark:text-green-400">{formatCurrency(data.summary.paid)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Payable</p>
            <p className="text-xl font-semibold mt-1 text-amber-600 dark:text-amber-400">{formatCurrency(data.summary.outstanding)}</p>
          </CardContent></Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Status</p>
          <Select value={status || 'all'} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {(Object.keys(PO_STATUS_LABELS) as (keyof typeof PO_STATUS_LABELS)[]).map((s) => (
                <SelectItem key={s} value={s}>{PO_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => navigate(newOrderUrl)}>
          <Plus className="h-4 w-4 mr-1" /> New Purchase Order
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No purchase orders"
          description="Raise a GST purchase order from approved quotes, share it with the vendor on WhatsApp, and track deliveries and payments."
          action={{ label: 'New Purchase Order', onClick: () => navigate(newOrderUrl) }}
        />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {orders.map((po) => {
              const late = isDeliveryLate(po)
              return (
                <button
                  key={po.id}
                  onClick={() => navigate(`/procurement/orders/${po.id}`)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{po.vendorName}</span>
                      <Badge className={PO_STATUS_COLORS[po.status]}>{PO_STATUS_LABELS[po.status]}</Badge>
                      {late && <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Delivery late</Badge>}
                      {po.vendorAcknowledgedAt && po.status !== 'CANCELLED' && (
                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-0.5">
                          <CheckCircle2 className="h-3 w-3" /> Accepted
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {po.poNumber} · {formatDate(po.poDate)}
                      {!projectId && po.projectName && ` · ${po.projectName}`}
                      {po.expectedDelivery && ` · due ${formatDate(po.expectedDelivery)}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{formatCurrency(po.totalAmount)}</p>
                    {(po.balanceDue ?? 0) > 0 && po.status !== 'CANCELLED' ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">{formatCurrency(po.balanceDue ?? 0)} payable</p>
                    ) : po.totalAmount > 0 && po.status !== 'CANCELLED' ? (
                      <p className="text-xs text-green-600 dark:text-green-400">Paid</p>
                    ) : null}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              )
            })}
          </CardContent>
        </Card>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}
