import { useState } from 'react'
import { Pencil, Trash2, Banknote, Wifi, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PaymentForm } from './PaymentForm'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useDeletePayment } from '@/hooks/usePayments'
import { useToast } from '@/components/ui/toast'
import type { Payment, PaymentMethod } from '@/types'

interface PaymentTimelineProps {
  payments: Payment[]
  isLoading: boolean
  clientId: string
}

const methodConfig: Record<PaymentMethod, { label: string; icon: typeof Banknote; className: string }> = {
  CASH: {
    label: 'Cash',
    icon: Banknote,
    className: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  ONLINE: {
    label: 'Online',
    icon: Wifi,
    className: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  CHEQUE: {
    label: 'Cheque',
    icon: FileText,
    className: 'border-transparent bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  },
}

export function PaymentTimeline({ payments, isLoading, clientId }: PaymentTimelineProps) {
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deletePayment = useDeletePayment()
  const { toast } = useToast()

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      await deletePayment.mutateAsync(deletingId)
      toast({ title: 'Payment deleted' })
    } catch {
      toast({ title: 'Error', description: 'Failed to delete payment.', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!payments.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No payments recorded yet.</p>
      </div>
    )
  }

  return (
    <>
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />

        <div className="space-y-6">
          {payments.map((payment) => {
            const config = methodConfig[payment.method]
            const Icon = config.icon
            return (
              <div key={payment.id} className="relative flex gap-4 pl-12">
                {/* Timeline dot */}
                <div className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full bg-background border-2 border-border">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>

                <div className="flex-1 rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-semibold text-foreground">
                          {formatCurrency(payment.amount)}
                        </span>
                        <Badge className={config.className}>{config.label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{formatDate(payment.date)}</p>
                      {payment.notes && (
                        <p className="text-sm text-foreground/80 mt-1">{payment.notes}</p>
                      )}
                      {payment.user && (
                        <p className="text-xs text-muted-foreground">
                          Recorded by {payment.user.name}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditingPayment(payment)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeletingId(payment.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {editingPayment && (
        <PaymentForm
          clientId={clientId}
          payment={editingPayment}
          open={!!editingPayment}
          onOpenChange={(open) => { if (!open) setEditingPayment(null) }}
        />
      )}

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null) }}
        title="Delete Payment"
        description="Are you sure you want to delete this payment record?"
        confirmLabel="Delete"
        onConfirm={handleDelete}
        isLoading={deletePayment.isPending}
      />
    </>
  )
}
