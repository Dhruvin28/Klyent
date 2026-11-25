import { useEffect, useState } from 'react'
import { Loader2, Truck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement } from '@/hooks/useProcurement'
import type { PurchaseOrder } from '@/types'

interface Props {
  order: PurchaseOrder
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Records the total quantity received so far on each line (not just today's
// delivery), which drives the PO's and the requirements' received status.
export function ReceiveDeliveryDialog({ order, open, onOpenChange }: Props) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const lines = order.lineItems ?? []
  const [received, setReceived] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setReceived(Object.fromEntries(lines.map((l) => [l.id, String(l.receivedQuantity ?? 0)])))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await procurementApi.receiveOrder(
        order.id,
        lines.map((l) => ({ id: l.id, receivedQuantity: Math.max(0, Number(received[l.id]) || 0) }))
      )
      invalidate()
      toast({ title: updated.status === 'RECEIVED' ? 'All items received' : 'Delivery recorded' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to record the delivery.'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="h-4 w-4" /> Record Delivery — {order.poNumber}</DialogTitle>
          <DialogDescription>Enter the total received to date for each item.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {lines.map((l) => {
            const value = Number(received[l.id]) || 0
            return (
              <div key={l.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{l.description}</p>
                  <p className="text-xs text-muted-foreground">Ordered {l.quantity} {l.unit ?? ''}</p>
                </div>
                <Input
                  type="number" min={0} step="any" className="w-24 text-right"
                  value={received[l.id] ?? ''}
                  onChange={(e) => setReceived((r) => ({ ...r, [l.id]: e.target.value }))}
                />
                <Button
                  variant={value >= l.quantity ? 'secondary' : 'outline'} size="sm"
                  onClick={() => setReceived((r) => ({ ...r, [l.id]: String(l.quantity) }))}
                >
                  All
                </Button>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setReceived(Object.fromEntries(lines.map((l) => [l.id, String(l.quantity)])))}>
            Mark everything received
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
