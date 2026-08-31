import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Receipt, Download, Share2, Trash2, Eye, Copy, Check, Pencil, IndianRupee } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { InvoicePDF } from '@/components/invoices/InvoicePDF'
import { RecordPaymentDialog } from '@/components/invoices/RecordPaymentDialog'
import { invoicesApi } from '@/api/invoices'
import { useToast } from '@/components/ui/toast'
import { useLogoDataUrl } from '@/hooks/useLogoDataUrl'
import { useAuthStore } from '@/store/auth.store'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Invoice } from '@/types'

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'border-transparent bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SENT: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  PART_PAID: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  PAID: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  OVERDUE: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  CANCELLED: 'border-transparent bg-gray-100 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-500',
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PART_PAID: 'Part Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
}

// An unpaid invoice past its due date reads as overdue, whatever the stored
// status says — nothing sweeps the table on a schedule.
export function isOverdue(inv: Invoice): boolean {
  if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'DRAFT') return false
  return new Date(inv.dueDate) < new Date(new Date().toDateString())
}

function CopyShareButton({ invoiceId }: { invoiceId: string }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const qc = useQueryClient()

  const handleShare = async () => {
    setSharing(true)
    try {
      const token = await invoicesApi.generateShareToken(invoiceId)
      const url = `${window.location.origin}/invoices/share/${token}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      toast({ title: 'Share link copied!', description: 'Anyone with the link can view and download this invoice.' })
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast({ title: 'Error', description: 'Failed to generate share link.', variant: 'destructive' })
    } finally {
      setSharing(false)
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleShare} disabled={sharing} title="Copy share link">
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Share2 className="h-4 w-4" />}
    </Button>
  )
}

function InvoiceCard({
  invoice,
  onDelete,
  onRecordPayment,
  logoDataUrl,
  company,
}: {
  invoice: Invoice
  onDelete: (id: string) => void
  onRecordPayment: (inv: Invoice) => void
  logoDataUrl: string | null
  company: Partial<Invoice>
}) {
  const navigate = useNavigate()
  const overdue = isOverdue(invoice)
  const statusKey = overdue ? 'OVERDUE' : invoice.status

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Receipt className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm truncate">{invoice.clientName}</span>
                <Badge className={INVOICE_STATUS_COLORS[statusKey]}>{INVOICE_STATUS_LABELS[statusKey]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{invoice.invoiceNumber}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(invoice.invoiceDate)} · Due {formatDate(invoice.dueDate)}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold">{formatCurrency(invoice.totalAmount)}</p>
            {invoice.balanceDue > 0 && invoice.amountPaid > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{formatCurrency(invoice.balanceDue)} due</p>
            )}
            {invoice.balanceDue <= 0 && invoice.totalAmount > 0 && (
              <p className="text-xs text-green-600 dark:text-green-400">Fully paid</p>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/invoices/${invoice.id}`)} title="View invoice">
            <Eye className="h-4 w-4" />
          </Button>

          <PDFDownloadLink
            document={<InvoicePDF invoice={{ ...invoice, ...company, companyLogoUrl: logoDataUrl }} />}
            fileName={`Invoice-${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`}
          >
            {({ loading }) => (
              <Button variant="ghost" size="sm" disabled={loading} title="Download PDF">
                <Download className="h-4 w-4" />
              </Button>
            )}
          </PDFDownloadLink>

          <CopyShareButton invoiceId={invoice.id} />

          <Button variant="ghost" size="sm" onClick={() => onRecordPayment(invoice)} title="Record payment received">
            <IndianRupee className="h-4 w-4" />
          </Button>

          <Button variant="ghost" size="sm" onClick={() => navigate(`/invoices/new?editId=${invoice.id}`)} title="Edit invoice">
            <Pencil className="h-4 w-4" />
          </Button>

          <Button variant="ghost" size="sm" onClick={() => navigate(`/invoices/new?copyFrom=${invoice.id}`)} title="Duplicate as a new invoice">
            <Copy className="h-4 w-4" />
          </Button>

          <div className="flex-1" />

          <Button
            variant="ghost" size="sm"
            onClick={() => onDelete(invoice.id)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete invoice"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function InvoicesPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null)
  const logoDataUrl = useLogoDataUrl()
  const user = useAuthStore((s) => s.user)

  // The list endpoint returns invoices without the company letterhead, so the
  // PDF buttons here fill it in from the signed-in user's profile.
  const company: Partial<Invoice> = {
    companyName: user?.companyName ?? null,
    companyPhone: user?.companyPhone ?? null,
    companyAddress: user?.companyAddress ?? null,
    companyWebsite: user?.companyWebsite ?? null,
    companyGstin: user?.companyGstin ?? null,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', { status }],
    queryFn: () => invoicesApi.getInvoices({ status: status || undefined }),
  })

  const deleteInvoice = useMutation({
    mutationFn: (id: string) => invoicesApi.deleteInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      toast({ title: 'Invoice deleted' })
    },
    onError: () => toast({ title: 'Error', description: 'Failed to delete invoice.', variant: 'destructive' }),
  })

  const invoices = data?.data ?? []
  const summary = data?.summary

  const handleDelete = async () => {
    if (!deletingId) return
    await deleteInvoice.mutateAsync(deletingId)
    setDeletingId(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Invoices</h2>
          <p className="text-sm text-muted-foreground">GST tax invoices with PDF export and share links</p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => navigate('/invoices/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Invoice
        </Button>
      </div>

      {/* Summary tiles — computed over the current filter */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Billed</p>
            <p className="text-xl font-semibold mt-1">{formatCurrency(summary.billed)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Collected</p>
            <p className="text-xl font-semibold mt-1 text-green-600 dark:text-green-400">{formatCurrency(summary.collected)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-xl font-semibold mt-1 text-amber-600 dark:text-amber-400">{formatCurrency(summary.outstanding)}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-3 items-end">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Status</p>
          <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="PART_PAID">Part Paid</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          description="Raise your first GST invoice and share it straight with your client."
          action={{ label: 'Create Invoice', onClick: () => navigate('/invoices/new') }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {invoices.map((inv) => (
            <InvoiceCard
              key={inv.id}
              invoice={inv}
              onDelete={setDeletingId}
              onRecordPayment={setPayingInvoice}
              logoDataUrl={logoDataUrl}
              company={company}
            />
          ))}
        </div>
      )}

      <RecordPaymentDialog
        invoice={payingInvoice}
        open={!!payingInvoice}
        onOpenChange={(o) => !o && setPayingInvoice(null)}
      />

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(o) => !o && setDeletingId(null)}
        title="Delete Invoice"
        description="This will permanently delete the invoice. This action cannot be undone."
        onConfirm={handleDelete}
        isLoading={deleteInvoice.isPending}
      />
    </div>
  )
}
