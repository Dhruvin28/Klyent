import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft, Download, Share2, Check, Trash2, Pencil, IndianRupee, MessageCircle, Truck, ShoppingCart, Ban, RotateCcw, CheckCircle2,
} from 'lucide-react'
import { PDFDownloadLink, PDFViewer } from '@react-pdf/renderer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/ui/toast'
import { PurchaseOrderPDF } from '@/components/procurement/PurchaseOrderPDF'
import { ReceiveDeliveryDialog } from '@/components/procurement/ReceiveDeliveryDialog'
import { VendorPaymentDialog } from '@/components/procurement/VendorPaymentDialog'
import { isDeliveryLate } from '@/components/procurement/OrdersTab'
import { PO_STATUS_COLORS, PO_STATUS_LABELS } from '@/components/procurement/common'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement, usePurchaseOrder } from '@/hooks/useProcurement'
import { useLogoDataUrl } from '@/hooks/useLogoDataUrl'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const logoDataUrl = useLogoDataUrl()
  const { data: po, isLoading } = usePurchaseOrder(id)

  const [copied, setCopied] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="w-full h-[80vh]" />
      </div>
    )
  }

  if (!po) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <ShoppingCart className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Purchase order not found.</p>
        <Button variant="outline" onClick={() => navigate('/procurement?tab=orders')}>Back to Purchase Orders</Button>
      </div>
    )
  }

  const cancelled = po.status === 'CANCELLED'
  const lines = po.lineItems ?? []
  const ordered = lines.reduce((s, l) => s + l.quantity, 0)
  const received = lines.reduce((s, l) => s + Math.min(l.receivedQuantity ?? 0, l.quantity), 0)
  const pdfOrder = { ...po, companyLogoUrl: logoDataUrl }
  const fileName = `PO-${po.poNumber.replace(/\//g, '-')}.pdf`

  const shareUrl = async () => {
    const token = po.shareToken ?? await procurementApi.shareOrder(po.id)
    invalidate()
    return `${window.location.origin}/procurement/orders/share/${token}`
  }

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(await shareUrl())
      setCopied(true)
      toast({ title: 'Share link copied!', description: 'The vendor can view, download and accept the order.' })
      setTimeout(() => setCopied(false), 3000)
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to create the link.'), variant: 'destructive' })
    }
  }

  const handleWhatsApp = async () => {
    try {
      const url = await shareUrl()
      const text = [
        `Dear ${po.vendorName},`,
        '',
        `Please find our purchase order *${po.poNumber}* for *${formatCurrency(po.totalAmount)}*.`,
        po.expectedDelivery ? `Required delivery by *${formatDate(po.expectedDelivery)}*.` : null,
        '',
        `View, download & accept: ${url}`,
        '',
        'Kindly confirm and share the dispatch date.',
        po.companyName ?? '',
      ].filter((l) => l !== null).join('\n')
      const phone = po.vendorPhone?.replace(/\D/g, '') ?? ''
      const encoded = encodeURIComponent(text)
      window.open(phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`, '_blank', 'noopener')
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to create the link.'), variant: 'destructive' })
    }
  }

  const setStatus = async (status: 'SENT' | 'CANCELLED') => {
    setBusy(true)
    try {
      await procurementApi.updateOrder(po.id, { status })
      invalidate()
      toast({ title: status === 'CANCELLED' ? 'Purchase order cancelled' : 'Purchase order re-opened' })
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to update the order.'), variant: 'destructive' })
    } finally {
      setBusy(false)
      setCancelOpen(false)
    }
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-col 2xl:flex-row 2xl:items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={() => navigate('/procurement?tab=orders')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ChevronLeft className="h-4 w-4" /> Purchase Orders
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">{po.vendorName}</h2>
            <Badge className={PO_STATUS_COLORS[po.status]}>{PO_STATUS_LABELS[po.status]}</Badge>
            {isDeliveryLate(po) && <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Delivery late</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {po.poNumber} · {formatCurrency(po.totalAmount)}
            {po.projectName && ` · ${po.projectName}`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!cancelled && (
            <>
              <Button variant="outline" size="sm" onClick={() => setReceiveOpen(true)}>
                <Truck className="h-4 w-4 mr-1" /> Record Delivery
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPayOpen(true)}>
                <IndianRupee className="h-4 w-4 mr-1" /> Payment
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/procurement/orders/new?editId=${po.id}`)}>
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={handleWhatsApp}>
                <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
              </Button>
              <Button variant="outline" size="sm" onClick={handleShare}>
                {copied ? <Check className="h-4 w-4 mr-1 text-green-600" /> : <Share2 className="h-4 w-4 mr-1" />}
                {copied ? 'Copied!' : 'Share Link'}
              </Button>
            </>
          )}
          <PDFDownloadLink document={<PurchaseOrderPDF order={pdfOrder} />} fileName={fileName}>
            {({ loading }) => (
              <Button size="sm" disabled={loading}>
                <Download className="h-4 w-4 mr-1" /> {loading ? 'Preparing…' : 'Download PDF'}
              </Button>
            )}
          </PDFDownloadLink>
          {cancelled ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus('SENT')}>
              <RotateCcw className="h-4 w-4 mr-1" /> Re-open
            </Button>
          ) : (
            <Button variant="ghost" size="sm" title="Cancel order" onClick={() => setCancelOpen(true)}>
              <Ban className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Delivery</p>
          <p className="text-xl font-semibold mt-1">{ordered > 0 ? Math.round((received / ordered) * 100) : 0}% received</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {po.expectedDelivery ? `Due ${formatDate(po.expectedDelivery)}` : 'No delivery date set'}
          </p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Paid to vendor</p>
          <p className="text-xl font-semibold mt-1">{formatCurrency(po.amountPaid ?? 0)}</p>
          <p className={`text-xs mt-0.5 ${(po.balanceDue ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
            {(po.balanceDue ?? 0) > 0 ? `${formatCurrency(po.balanceDue ?? 0)} payable` : 'Fully paid'}
          </p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Vendor confirmation</p>
          {po.vendorAcknowledgedAt ? (
            <>
              <p className="text-xl font-semibold mt-1 text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-5 w-5" /> Accepted
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(po.vendorAcknowledgedAt)}</p>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold mt-1 text-muted-foreground">Awaiting</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {po.shareToken ? 'Link shared — not accepted yet' : 'Share the PO link so the vendor can accept'}
              </p>
            </>
          )}
        </CardContent></Card>
      </div>

      <div className="rounded-lg overflow-hidden shadow border border-border" style={{ height: '80vh' }}>
        <PDFViewer width="100%" height="100%" showToolbar={false}>
          <PurchaseOrderPDF order={pdfOrder} />
        </PDFViewer>
      </div>

      <ReceiveDeliveryDialog order={po} open={receiveOpen} onOpenChange={setReceiveOpen} />
      <VendorPaymentDialog order={po} open={payOpen} onOpenChange={setPayOpen} />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel purchase order"
        description="The order is kept for your records but the vendor's link stops working, and its items go back to 'Approved' so they can be ordered again."
        confirmLabel="Cancel Order"
        cancelLabel="Keep"
        isLoading={busy}
        onConfirm={() => setStatus('CANCELLED')}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete purchase order"
        description="This permanently deletes the purchase order. To keep a record, cancel it instead."
        isLoading={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            await procurementApi.deleteOrder(po.id)
            invalidate()
            toast({ title: 'Purchase order deleted' })
            navigate('/procurement?tab=orders')
          } catch (err) {
            toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to delete.'), variant: 'destructive' })
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}
