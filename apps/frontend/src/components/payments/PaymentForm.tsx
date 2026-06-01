import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreatePayment, useUpdatePayment } from '@/hooks/usePayments'
import { useToast } from '@/components/ui/toast'
import type { Client, Payment } from '@/types'

const schema = z.object({
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  method: z.enum(['CASH', 'ONLINE', 'CHEQUE']),
  date: z.string().min(1, 'Date is required'),
  notes: z.string().optional(),
  // one of these will be set externally; selector only shown when neither is pre-set
  clientId: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface PaymentFormProps {
  // Client mode
  clientId?: string
  clients?: Client[]
  // Freelance mode
  freelanceProjectId?: string
  freelanceProjectName?: string
  // Edit mode
  payment?: Payment
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PaymentForm({ clientId, clients, freelanceProjectId, freelanceProjectName, payment, open, onOpenChange }: PaymentFormProps) {
  const isEdit = !!payment
  const isFreelanceMode = !!freelanceProjectId
  const showClientSelector = !clientId && !isFreelanceMode && !isEdit
  const createPayment = useCreatePayment()
  const updatePayment = useUpdatePayment()
  const { toast } = useToast()

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      clientId: clientId ?? '',
      amount: undefined,
      method: 'ONLINE',
      date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
    },
  })

  useEffect(() => {
    if (payment) {
      reset({
        clientId: payment.clientId ?? '',
        amount: payment.amount,
        method: payment.method,
        date: format(new Date(payment.date), 'yyyy-MM-dd'),
        notes: payment.notes ?? '',
      })
    } else {
      reset({
        clientId: clientId ?? '',
        amount: undefined,
        method: 'ONLINE',
        date: format(new Date(), 'yyyy-MM-dd'),
        notes: '',
      })
    }
  }, [payment, clientId, reset, open])

  const methodValue = watch('method')
  const clientIdValue = watch('clientId')

  const onSubmit = async (data: FormData) => {
    try {
      const isoDate = new Date(data.date).toISOString()
      if (isEdit && payment) {
        await updatePayment.mutateAsync({ id: payment.id, data: { amount: data.amount, method: data.method, date: isoDate, notes: data.notes || undefined } })
        toast({ title: 'Payment updated' })
      } else {
        await createPayment.mutateAsync({
          clientId: isFreelanceMode ? undefined : (data.clientId || clientId),
          freelanceProjectId: isFreelanceMode ? freelanceProjectId : undefined,
          amount: data.amount,
          method: data.method,
          date: isoDate,
          notes: data.notes || undefined,
        })
        toast({ title: 'Payment recorded' })
      }
      onOpenChange(false)
    } catch {
      toast({ title: 'Error', description: 'Failed to save payment.', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Payment' : 'Record Payment'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          {isFreelanceMode && (
            <div className="rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">Project: </span>
              <span className="font-medium">{freelanceProjectName}</span>
            </div>
          )}

          {showClientSelector && (
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Select value={clientIdValue} onValueChange={(v) => setValue('clientId', v, { shouldValidate: true })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount (₹) *</Label>
            <Input id="amount" type="number" min="0" step="0.01" placeholder="0.00" {...register('amount')} />
            {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Payment Method *</Label>
              <Select value={methodValue} onValueChange={(v) => setValue('method', v as FormData['method'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="ONLINE">Online</SelectItem>
                  <SelectItem value="CHEQUE">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">Date *</Label>
              <Input id="date" type="date" {...register('date')} />
              {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" placeholder="Optional notes..." rows={2} {...register('notes')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
