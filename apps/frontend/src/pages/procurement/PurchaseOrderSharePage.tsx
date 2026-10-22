import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Download, Layers, Loader2 } from 'lucide-react'
import { pdf } from '@react-pdf/renderer'
import { Button } from '@/components/ui/button'
import { PurchaseOrderPDF } from '@/components/procurement/PurchaseOrderPDF'
import { procurementApi } from '@/api/procurement'
import { fetchLogoAsDataUrl } from '@/lib/logoProxy'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import type { PurchaseOrder } from '@/types'

async function renderBlob(order: PurchaseOrder) {
  const logoDataUrl = await fetchLogoAsDataUrl(order.companyLogoUrl)
  return pdf(<PurchaseOrderPDF order={{ ...order, companyLogoUrl: logoDataUrl }} />).toBlob()
}

// Native <iframe> over a blob URL, as on the invoice and proposal share pages.
function PdfFrame({ order }: { order: PurchaseOrder }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined
    renderBlob(order).then((blob) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setSrc(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // Accepting the order updates it in place; the document itself is unchanged.
  }, [order.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!src) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <div className="h-10 w-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
        <p className="text-sm">Preparing the purchase order…</p>
      </div>
    )
  }
  return <iframe src={src} title="Purchase Order PDF" className="flex-1 w-full border-0" style={{ minHeight: 0 }} />
}

export function PurchaseOrderSharePage() {
  const { token } = useParams<{ token: string }>()
  const qc = useQueryClient()
  const [accepting, setAccepting] = useState(false)

  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['po-share', token],
    queryFn: () => procurementApi.getOrderByToken(token!),
    enabled: !!token,
    retry: false,
  })

  const handleDownload = async () => {
    if (!order) return
    const url = URL.createObjectURL(await renderBlob(order))
    const a = document.createElement('a')
    a.href = url
    a.download = `PO-${order.poNumber.replace(/\//g, '-')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleAccept = async () => {
    if (!token) return
    setAccepting(true)
    try {
      const at = await procurementApi.acknowledgeOrder(token)
      qc.setQueryData<PurchaseOrder>(['po-share', token], (o) => (o ? { ...o, vendorAcknowledgedAt: at } : o))
    } finally {
      setAccepting(false)
    }
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-background">
        <AlertCircle className="h-14 w-14 text-destructive" />
        <h1 className="text-2xl font-semibold">Link Not Found</h1>
        <p className="text-muted-foreground max-w-sm">
          This purchase order link is invalid or the order was cancelled. Please contact the buyer.
        </p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-muted/30">
      <header className="shrink-0 bg-background border-b border-border min-h-14 flex flex-wrap items-center justify-between px-4 sm:px-6 gap-x-4 gap-y-2 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Layers className="h-4 w-4" />
          </div>
          <span className="font-bold text-primary text-base">Klyent</span>
        </div>

        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          {order && (
            <p className="text-sm text-muted-foreground hidden sm:block truncate">
              {order.poNumber} · {formatCurrency(order.totalAmount)} · from {order.companyName ?? 'buyer'}
            </p>
          )}
          {order && (order.vendorAcknowledgedAt ? (
            <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1" title={formatDateTime(order.vendorAcknowledgedAt)}>
              <CheckCircle2 className="h-4 w-4" /> Order accepted
            </span>
          ) : (
            <Button size="sm" variant="outline" onClick={handleAccept} disabled={accepting}>
              {accepting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Accept Order
            </Button>
          ))}
          <Button size="sm" disabled={!order} onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" /> Download PDF
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="h-10 w-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
          <p className="text-sm">Loading purchase order…</p>
        </div>
      ) : order ? (
        <PdfFrame order={order} />
      ) : null}
    </div>
  )
}
