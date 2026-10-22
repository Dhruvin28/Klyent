import { useEffect, useState } from 'react'
import { IndianRupee, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement } from '@/hooks/useProcurement'
import { formatCurrency } from '@/lib/utils'
import type { PurchaseOrder } from '@/types'

interface Props {
  order: PurchaseOrder
  open: boolean
  onOpenChange: (open: boolean) => void
}

// The running total paid to the vendor against this PO, like an invoice's
// amount received.
export function VendorPaymentDialog({ order, open, onOpenChange }: Props) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setAmount(String(order.amountPaid ?? 0))
  }, [open, order.amountPaid])

  const value = Number(amount) || 0

  const handleSave = async () => {
    setSaving(true)
    try {
      await procurementApi.recordOrderPayment(order.id, value)
      invalidate()
      toast({ title: value >= order.totalAmount ? 'Vendor paid in full' : 'Payment recorded' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to record the payment.'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><IndianRupee className="h-4 w-4" /> Payment to {order.vendorName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">PO Total</p>
              <p className="text-sm font-semibold mt-0.5">{formatCurrency(order.totalAmount)}</p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Payable After</p>
              <p className="text-sm font-semibold mt-0.5">{formatCurrency(Math.max(0, order.totalAmount - value))}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Total Paid to Vendor</Label>
            <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            <p className="text-xs text-muted-foreground">Enter the cumulative amount paid, including any advance.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setAmount(String(Math.round(order.totalAmount * 0.5)))}>50% advance</Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setAmount(String(order.totalAmount))}>Paid in full</Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || value < 0}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
