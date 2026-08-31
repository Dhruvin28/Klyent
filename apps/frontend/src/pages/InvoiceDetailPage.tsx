import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Download, Share2, Check, Trash2, Receipt, Copy, Pencil, IndianRupee, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { PDFDownloadLink, PDFViewer } from '@react-pdf/renderer'
import { InvoicePDF } from '@/components/invoices/InvoicePDF'
import { RecordPaymentDialog } from '@/components/invoices/RecordPaymentDialog'
import { useLogoDataUrl } from '@/hooks/useLogoDataUrl'
import { invoicesApi } from '@/api/invoices'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils'
import { INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS, isOverdue } from '@/pages/InvoicesPage'

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [deletingOpen, setDeletingOpen] = useState(false)
  const [payingOpen, setPayingOpen] = useState(false)
  const logoDataUrl = useLogoDataUrl()

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesApi.getInvoice(id!),
    enabled: !!id,
  })

  const deleteInvoice = useMutation({
    mutationFn: () => invoicesApi.deleteInvoice(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      navigate('/invoices')
      toast({ title: 'Invoice deleted' })
    },
    onError: () => toast({ title: 'Error', description: 'Failed to delete invoice.', variant: 'destructive' }),
  })

  const handleShare = async () => {
    if (!invoice) return
    try {
      const token = invoice.shareToken ?? await invoicesApi.generateShareToken(invoice.id)
      const url = `${window.location.origin}/invoices/share/${token}`
      await navigator.clipboard.writeText(url)
      qc.invalidateQueries({ queryKey: ['invoice', id] })
      setCopied(true)
      toast({ title: 'Share link copied!', description: 'Anyone with the link can view and download this invoice.' })
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast({ title: 'Error', description: 'Failed to generate share link.', variant: 'destructive' })
    }
  }

  // Sends the client the invoice link and balance on WhatsApp, matching how
  // payment reminders already go out from the clients page.
  const handleWhatsApp = async () => {
    if (!invoice) return
    const token = invoice.shareToken ?? await invoicesApi.generateShareToken(invoice.id)
    qc.invalidateQueries({ queryKey: ['invoice', id] })
    const url = `${window.location.origin}/invoices/share/${token}`
    const lines = [
      `Dear ${invoice.clientName},`,
      '',
      `Please find invoice *${invoice.invoiceNumber}* for *${formatCurrency(invoice.totalAmount)}*.`,
      invoice.balanceDue > 0 ? `Balance due: *${formatCurrency(invoice.balanceDue)}*` : 'This invoice is fully paid.',
      '',
      `View & download: ${url}`,
      '',
      'Thank you,',
      invoice.companyName ?? 'Our Team',
    ]
    const phone = invoice.clientPhone?.replace(/\D/g, '') ?? ''
    const encoded = encodeURIComponent(lines.join('\n'))
    window.open(phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`, '_blank', 'noopener')
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="w-full h-[80vh]" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Receipt className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Invoice not found.</p>
        <Button variant="outline" onClick={() => navigate('/invoices')}>Back to Invoices</Button>
      </div>
    )
  }

  const statusKey = isOverdue(invoice) ? 'OVERDUE' : invoice.status
  const pdfInvoice = { ...invoice, companyLogoUrl: logoDataUrl }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate('/invoices')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">{invoice.clientName}</h2>
            <Badge className={INVOICE_STATUS_COLORS[statusKey]}>{INVOICE_STATUS_LABELS[statusKey]}</Badge>
            <Badge className="border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {invoice.isInterState ? 'IGST' : 'CGST + SGST'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {invoice.invoiceNumber} · {formatCurrency(invoice.totalAmount)}
            {invoice.balanceDue > 0 && ` · ${formatCurrency(invoice.balanceDue)} due`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setPayingOpen(true)}>
            <IndianRupee className="h-4 w-4 mr-1" /> Record Payment
          </Button>

          <Button variant="outline" size="sm" onClick={() => navigate(`/invoices/new?editId=${invoice.id}`)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>

          <Button variant="outline" size="sm" onClick={() => navigate(`/invoices/new?copyFrom=${invoice.id}`)}>
            <Copy className="h-4 w-4 mr-1" /> Copy
          </Button>

          <Button variant="outline" size="sm" onClick={handleWhatsApp}>
            <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
          </Button>

          <Button variant="outline" size="sm" onClick={handleShare}>
            {copied ? <Check className="h-4 w-4 mr-1 text-green-600" /> : <Share2 className="h-4 w-4 mr-1" />}
            {copied ? 'Copied!' : 'Share Link'}
          </Button>

          <PDFDownloadLink
            document={<InvoicePDF invoice={pdfInvoice} />}
            fileName={`Invoice-${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`}
          >
            {({ loading }) => (
              <Button size="sm" disabled={loading}>
                <Download className="h-4 w-4 mr-1" />
                {loading ? 'Preparing…' : 'Download PDF'}
              </Button>
            )}
          </PDFDownloadLink>

          <Button
            variant="ghost" size="sm"
            onClick={() => setDeletingOpen(true)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="rounded-lg overflow-hidden shadow border border-border" style={{ height: '80vh' }}>
        <PDFViewer width="100%" height="100%" showToolbar={false}>
          <InvoicePDF invoice={pdfInvoice} />
        </PDFViewer>
      </div>

      <RecordPaymentDialog invoice={invoice} open={payingOpen} onOpenChange={setPayingOpen} />

      <ConfirmDialog
        open={deletingOpen}
        onOpenChange={setDeletingOpen}
        title="Delete Invoice"
        description="This will permanently delete the invoice. This action cannot be undone."
        onConfirm={() => { deleteInvoice.mutate() }}
        isLoading={deleteInvoice.isPending}
      />
    </div>
  )
}
