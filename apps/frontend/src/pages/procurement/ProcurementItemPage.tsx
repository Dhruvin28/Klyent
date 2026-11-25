import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft, Plus, Pencil, Trash2, Check, Undo2, X, MessageCircle, FileText, BookOpen, PenLine,
  ShoppingCart, Truck, Clock, AlertTriangle, Ban, RotateCcw, Package,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { useToast } from '@/components/ui/toast'
import { ItemDialog } from '@/components/procurement/ItemDialog'
import { QuoteDialog } from '@/components/procurement/QuoteDialog'
import { LinkQuotesDialog } from '@/components/procurement/LinkQuotesDialog'
import {
  ITEM_STATUS_COLORS, ITEM_STATUS_LABELS, PO_STATUS_COLORS, PO_STATUS_LABELS, QUOTE_SOURCE_LABELS,
  landedTotal, isExpired, sameUnit,
} from '@/components/procurement/common'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement, useProcurementItem } from '@/hooks/useProcurement'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { ProcurementQuote, ProcurementQuoteSource } from '@/types'

const SOURCE_ICONS: Record<ProcurementQuoteSource, typeof FileText> = {
  whatsapp: MessageCircle,
  document: FileText,
  catalog: BookOpen,
  manual: PenLine,
}

function addDays(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

export function ProcurementItemPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const { data: item, isLoading } = useProcurementItem(id)

  const [editOpen, setEditOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [editingQuote, setEditingQuote] = useState<ProcurementQuote | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [removingQuote, setRemovingQuote] = useState<ProcurementQuote | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Quotes ranked by what they cost landed (GST included); unpriced and
  // rejected ones go to the end.
  const ranked = useMemo(() => {
    if (!item) return []
    const score = (q: ProcurementQuote) =>
      q.status === 'rejected' ? Infinity : landedTotal(q, item.quantity) ?? Number.MAX_VALUE
    return [...item.quotes].sort((a, b) => score(a) - score(b))
  }, [item])

  const live = ranked.filter((q) => q.status !== 'rejected' && q.price !== null)
  const cheapest = live[0]
  const fastest = live.filter((q) => q.leadTimeDays != null)
    .sort((a, b) => (a.leadTimeDays ?? 0) - (b.leadTimeDays ?? 0))[0]

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key)
    try {
      await fn()
      invalidate()
      if (success) toast({ title: success })
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Something went wrong.'), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Package className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Requirement not found.</p>
        <Button variant="outline" onClick={() => navigate('/procurement')}>Back to Procurement</Button>
      </div>
    )
  }

  const approved = item.quotes.find((q) => q.id === item.approvedQuoteId) ?? null
  const clientValue = item.clientRate !== null ? item.clientRate * item.quantity : null
  const approvedCost = approved?.price != null ? approved.price * item.quantity : null
  const canOrder = item.status === 'approved' && approved?.vendorId
  const cancelled = item.status === 'cancelled'
  const backTo = item.projectId ? `/procurement?projectId=${item.projectId}` : '/procurement'

  // A request for quotes the designer can paste into a vendor chat.
  const rfqText = [
    'Hello,',
    '',
    `Please share your best rate for: *${item.title}*`,
    `Quantity: ${item.quantity} ${item.unit}`,
    item.specification ? `Specification: ${item.specification}` : null,
    item.neededBy ? `Required by: ${formatDate(item.neededBy)}` : null,
    '',
    'Kindly mention GST, delivery time and validity of the quote.',
    'Thank you.',
  ].filter((l) => l !== null).join('\n')

  const whatsappVendor = (q: ProcurementQuote) => {
    const phone = q.vendorPhone?.replace(/\D/g, '') ?? ''
    const encoded = encodeURIComponent(rfqText)
    window.open(phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`, '_blank', 'noopener')
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-1">
            <ChevronLeft className="h-4 w-4" /> Procurement
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">{item.title}</h2>
            <Badge className={ITEM_STATUS_COLORS[item.status]}>{ITEM_STATUS_LABELS[item.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {item.quantity} {item.unit}
            {item.category && ` · ${item.category}`}
            {item.projectName && ` · ${item.projectName}`}
            {item.neededBy && ` · needed by ${formatDate(item.neededBy)}`}
          </p>
          {item.specification && <p className="text-sm mt-1 whitespace-pre-line">{item.specification}</p>}
        </div>
        <div className="flex gap-2 flex-wrap shrink-0">
          {canOrder && (
            <Button size="sm" onClick={() => navigate(
              `/procurement/orders/new?vendorId=${approved!.vendorId}&itemIds=${item.id}${item.projectId ? `&projectId=${item.projectId}` : ''}`
            )}>
              <ShoppingCart className="h-4 w-4 mr-1" /> Create Purchase Order
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          {cancelled ? (
            <Button variant="outline" size="sm" disabled={busy === 'status'}
              onClick={() => run('status', () => procurementApi.updateItem(item.id, { status: 'open' }), 'Requirement re-opened')}>
              <RotateCcw className="h-4 w-4 mr-1" /> Re-open
            </Button>
          ) : item.orders.length === 0 && (
            <Button variant="outline" size="sm" disabled={busy === 'status'}
              onClick={() => run('status', () => procurementApi.updateItem(item.id, { status: 'cancelled' }), 'Requirement cancelled')}>
              <Ban className="h-4 w-4 mr-1" /> Cancel
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Money strip ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Quotes</p>
          <p className="text-xl font-semibold mt-1">{item.quotes.length}</p>
          {live.length > 1 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Spread {formatCurrency(Math.max(...live.map((q) => q.price!)) - Math.min(...live.map((q) => q.price!)))}/{item.unit}
            </p>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Best landed (incl. GST)</p>
          <p className="text-xl font-semibold mt-1">{cheapest ? formatCurrency(landedTotal(cheapest, item.quantity)!) : '—'}</p>
          {cheapest && <p className="text-xs text-muted-foreground mt-0.5 truncate">{cheapest.vendorName ?? 'Unknown vendor'}</p>}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Client value</p>
          <p className="text-xl font-semibold mt-1">{clientValue !== null ? formatCurrency(clientValue) : '—'}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.clientRate !== null ? `${formatCurrency(item.clientRate)}/${item.unit}` : 'Set a client rate to see margin'}
          </p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Your margin</p>
          {clientValue !== null && approvedCost !== null ? (
            <>
              <p className={cn('text-xl font-semibold mt-1', clientValue - approvedCost < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
                {formatCurrency(clientValue - approvedCost)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {clientValue > 0 ? `${(((clientValue - approvedCost) / clientValue) * 100).toFixed(1)}% on approved quote` : ''}
              </p>
            </>
          ) : (
            <p className="text-xl font-semibold mt-1 text-muted-foreground">—</p>
          )}
        </CardContent></Card>
      </div>

      {/* ── Comparison ── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Compare quotes</h3>
            <p className="text-xs text-muted-foreground">Ranked by landed cost for {item.quantity} {item.unit}, GST included</p>
          </div>
          {!cancelled && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => {
                window.open(`https://wa.me/?text=${encodeURIComponent(rfqText)}`, '_blank', 'noopener')
              }}>
                <MessageCircle className="h-4 w-4 mr-1" /> Ask for quotes
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                <MessageCircle className="h-4 w-4 mr-1" /> From conversations
              </Button>
              <Button size="sm" onClick={() => { setEditingQuote(null); setQuoteOpen(true) }}>
                <Plus className="h-4 w-4 mr-1" /> Add Quote
              </Button>
            </div>
          )}
        </div>

        {ranked.length === 0 ? (
          <Card><CardContent className="p-0">
            <EmptyState
              icon={BookOpen}
              title="No quotes yet"
              description="Pick prices from your vendors' price lists, type in a quote you received, or pull in prices AI Studio found in WhatsApp chats."
              action={cancelled ? undefined : { label: 'Add Quote', onClick: () => { setEditingQuote(null); setQuoteOpen(true) } }}
            />
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ranked.map((q) => {
              const total = landedTotal(q, item.quantity)
              const best = cheapest ? landedTotal(cheapest, item.quantity) : null
              const delta = total !== null && best !== null && q.id !== cheapest?.id ? total - best : null
              const isApproved = q.id === item.approvedQuoteId
              const rejected = q.status === 'rejected'
              const expired = isExpired(q.validTill)
              const arrives = q.leadTimeDays != null ? addDays(q.leadTimeDays) : null
              const late = !!(arrives && item.neededBy && arrives > new Date(item.neededBy))
              const margin = item.clientRate !== null && q.price !== null ? (item.clientRate - q.price) * item.quantity : null
              const Icon = SOURCE_ICONS[q.source]

              return (
                <Card key={q.id} className={cn(
                  'flex flex-col',
                  isApproved && 'ring-2 ring-primary',
                  rejected && 'opacity-60',
                )}>
                  <CardHeader className="pb-2 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{q.vendorName ?? 'Unknown vendor'}</CardTitle>
                      <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0 mt-0.5">
                        <Icon className="h-3 w-3" /> {QUOTE_SOURCE_LABELS[q.source]}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {isApproved && <Badge className="border-transparent bg-primary text-primary-foreground">Approved</Badge>}
                      {!rejected && q.id === cheapest?.id && live.length > 1 && (
                        <Badge className="border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Lowest</Badge>
                      )}
                      {!rejected && q.id === fastest?.id && live.length > 1 && (
                        <Badge className="border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Fastest</Badge>
                      )}
                      {q.status === 'revised' && <Badge variant="secondary">Revised</Badge>}
                      {rejected && <Badge variant="secondary">Rejected</Badge>}
                      {expired && <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Expired</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-3">
                    <div>
                      <p className="text-2xl font-semibold tabular-nums">
                        {q.price !== null ? formatCurrency(q.price) : 'No price'}
                        {q.price !== null && <span className="text-sm font-normal text-muted-foreground"> / {q.unit ?? item.unit}</span>}
                      </p>
                      {(q.productName || q.materialName) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {q.productName ?? q.materialName}{q.productBrand ? ` · ${q.productBrand}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Landed ({q.gstRate ?? 0}% GST)</span>
                        <span className="font-medium tabular-nums">{total !== null ? formatCurrency(total) : '—'}</span>
                      </div>
                      {delta !== null && delta > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">vs lowest</span>
                          <span className="text-red-600 dark:text-red-400 tabular-nums">
                            +{formatCurrency(delta)} ({best ? ((delta / best) * 100).toFixed(1) : 0}%)
                          </span>
                        </div>
                      )}
                      {margin !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Your margin</span>
                          <span className={cn('font-medium tabular-nums', margin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
                            {formatCurrency(margin)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      {q.leadTimeDays != null && (
                        <p className={cn('flex items-center gap-1', late && 'text-amber-600 dark:text-amber-400')}>
                          <Truck className="h-3 w-3" />
                          {q.leadTimeDays} day{q.leadTimeDays === 1 ? '' : 's'} · arrives ~{formatDate(arrives!)}
                          {late && ' (after needed date)'}
                        </p>
                      )}
                      {q.validTill && (
                        <p className="flex items-center gap-1"><Clock className="h-3 w-3" /> Valid till {formatDate(q.validTill)}</p>
                      )}
                      {!sameUnit(q.unit, item.unit) && (
                        <p className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> Priced per {q.unit}, requirement is in {item.unit}
                        </p>
                      )}
                      {q.notes && <p className="whitespace-pre-line text-foreground/80">{q.notes}</p>}
                      {q.confidence !== null && q.source !== 'manual' && q.source !== 'catalog' && (
                        <p>Extracted by AI — check the figure before approving.</p>
                      )}
                    </div>

                    <div className="mt-auto flex items-center gap-1 border-t border-border pt-3">
                      {!cancelled && (isApproved ? (
                        <Button size="sm" variant="outline" disabled={busy === q.id}
                          onClick={() => run(q.id, () => procurementApi.unapproveQuote(item.id), 'Approval removed')}>
                          <Undo2 className="h-4 w-4 mr-1" /> Undo
                        </Button>
                      ) : (
                        <Button size="sm" disabled={busy === q.id || rejected || q.price === null || !q.vendorId}
                          onClick={() => run(q.id, () => procurementApi.approveQuote(item.id, q.id), `${q.vendorName ?? 'Quote'} approved`)}>
                          <Check className="h-4 w-4 mr-1" /> Approve
                        </Button>
                      ))}
                      <Button size="sm" variant="ghost" title="Message vendor on WhatsApp" onClick={() => whatsappVendor(q)}>
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Edit quote" onClick={() => { setEditingQuote(q); setQuoteOpen(true) }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!isApproved && (
                        <Button size="sm" variant="ghost" title={rejected ? 'Restore quote' : 'Reject quote'} disabled={busy === q.id}
                          onClick={() => run(q.id, () => procurementApi.updateQuote(q.id, { status: rejected ? 'quoted' : 'rejected' }))}>
                          {rejected ? <RotateCcw className="h-4 w-4" /> : <X className="h-4 w-4" />}
                        </Button>
                      )}
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" title="Remove from comparison"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setRemovingQuote(q)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Orders ── */}
      {item.orders.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Purchase orders</CardTitle></CardHeader>
          <CardContent className="divide-y divide-border">
            {item.orders.map((o) => (
              <Link key={o.id} to={`/procurement/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{o.poNumber}</p>
                  <p className="text-xs text-muted-foreground truncate">{o.vendorName}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm tabular-nums text-muted-foreground">{o.receivedQuantity} / {o.quantity} received</span>
                  <Badge className={PO_STATUS_COLORS[o.status]}>{PO_STATUS_LABELS[o.status]}</Badge>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <ItemDialog open={editOpen} onOpenChange={setEditOpen} item={item} />
      <QuoteDialog open={quoteOpen} onOpenChange={setQuoteOpen} item={item} quote={editingQuote} />
      <LinkQuotesDialog open={linkOpen} onOpenChange={setLinkOpen} item={item} />

      <ConfirmDialog
        open={!!removingQuote}
        onOpenChange={(o) => !o && setRemovingQuote(null)}
        title="Remove quote"
        description={removingQuote && removingQuote.source !== 'manual' && removingQuote.source !== 'catalog'
          ? 'This quote came from a conversation. It will be taken out of this comparison but stays in AI Studio.'
          : 'This quote will be deleted.'}
        confirmLabel="Remove"
        isLoading={busy === 'remove'}
        onConfirm={async () => {
          if (!removingQuote) return
          await run('remove', () => procurementApi.deleteQuote(removingQuote.id), 'Quote removed')
          setRemovingQuote(null)
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete requirement"
        description="The requirement and the quotes you entered for it will be deleted. Quotes from conversations are kept in AI Studio."
        isLoading={busy === 'delete'}
        onConfirm={async () => {
          setBusy('delete')
          try {
            await procurementApi.deleteItem(item.id)
            invalidate()
            toast({ title: 'Requirement deleted' })
            navigate(backTo)
          } catch (err) {
            toast({ title: 'Cannot delete', description: apiErrorMessage(err, 'Failed to delete.'), variant: 'destructive' })
            setDeleteOpen(false)
          } finally {
            setBusy(null)
          }
        }}
      />
    </div>
  )
}
