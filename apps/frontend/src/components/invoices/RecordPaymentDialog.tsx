import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IndianRupee, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { invoicesApi } from '@/api/invoices'
import { useToast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils'
import type { Invoice } from '@/types'

interface Props {
  invoice: Invoice | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Records the running total received against an invoice. Payments are not
// linked to invoice rows, so this figure is entered by hand and drives the
// PAID / PART_PAID status.
export function RecordPaymentDialog({ invoice, open, onOpenChange }: Props) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')

  useEffect(() => {
    if (invoice && open) setAmount(String(invoice.amountPaid ?? 0))
  }, [invoice, open])

  const recordPayment = useMutation({
    mutationFn: (value: number) => invoicesApi.recordPayment(invoice!.id, value),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice', invoice!.id] })
      toast({
        title: updated.balanceDue <= 0 ? 'Invoice marked as paid' : 'Payment recorded',
        description: updated.balanceDue > 0 ? `${formatCurrency(updated.balanceDue)} still outstanding.` : undefined,
      })
      onOpenChange(false)
    },
    onError: () => toast({ title: 'Error', description: 'Failed to record the payment.', variant: 'destructive' }),
  })

  if (!invoice) return null

  const value = Number(amount) || 0
  const balance = invoice.totalAmount - value
  const exceedsTotal = value > invoice.totalAmount

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-4 w-4" />
            Record Payment — {invoice.invoiceNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Invoice Total</p>
              <p className="text-sm font-semibold mt-0.5">{formatCurrency(invoice.totalAmount)}</p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Balance After</p>
              <p className="text-sm font-semibold mt-0.5">{formatCurrency(Math.max(0, balance))}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Total Amount Received</Label>
            <Input
              type="number" min={0} step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Enter the cumulative amount received against this invoice, not just the latest instalment.
            </p>
            {exceedsTotal && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This is more than the invoice total. It will still be saved and the invoice marked paid.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setAmount(String(invoice.totalAmount))}>
              Mark fully paid
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setAmount('0')}>
              Clear
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => recordPayment.mutate(value)} disabled={recordPayment.isPending || value < 0}>
            {recordPayment.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
