import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAddWorkLog, useUpdateWorkLog } from '@/hooks/useFreelance'
import { useToast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils'
import type { FreelanceProject, FreelanceWorkLog } from '@/types'

const schema = z.object({
  quantity: z.coerce.number().positive('Quantity must be positive'),
  description: z.string().max(1000).optional(),
  date: z.string().min(1, 'Date is required'),
})

type FormData = z.infer<typeof schema>

interface WorkLogFormProps {
  project: FreelanceProject
  log?: FreelanceWorkLog
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkLogForm({ project, log, open, onOpenChange }: WorkLogFormProps) {
  const { toast } = useToast()
  const add = useAddWorkLog(project.id)
  const update = useUpdateWorkLog(project.id)

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantity: 0,
      description: '',
      date: new Date().toISOString().slice(0, 10),
    },
  })

  const quantity = watch('quantity')
  const billingAmount = (Number(quantity) || 0) * project.rate

  useEffect(() => {
    if (log) {
      reset({
        quantity: log.quantity,
        description: log.description ?? '',
        date: log.date.slice(0, 10),
      })
    } else {
      reset({ quantity: 0, description: '', date: new Date().toISOString().slice(0, 10) })
    }
  }, [log, open, reset])

  const onSubmit = async (data: FormData) => {
    try {
      const isoDate = new Date(data.date).toISOString()
      if (log) {
        await update.mutateAsync({ logId: log.id, data: { ...data, date: isoDate } })
        toast({ title: 'Work log updated' })
      } else {
        await add.mutateAsync({ ...data, date: isoDate })
        toast({ title: 'Work logged successfully' })
      }
      onOpenChange(false)
    } catch {
      toast({ title: 'Error', description: 'Failed to save work log.', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{log ? 'Edit Work Log' : 'Log Completed Work'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{project.chargeType} Completed</Label>
              <Input type="number" step="0.01" min="0.01" {...register('quantity')} placeholder="0" />
              {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" {...register('date')} />
              {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
            </div>
          </div>

          {billingAmount > 0 && (
            <div className="rounded-lg bg-primary/10 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Billing amount: </span>
              <span className="font-semibold text-primary">{formatCurrency(billingAmount)}</span>
              <span className="text-muted-foreground ml-1">
                ({quantity} {project.chargeType} × ₹{project.rate})
              </span>
            </div>
          )}

          <div className="space-y-1">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea {...register('description')} placeholder="What did you work on?" rows={3} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {log ? 'Save Changes' : 'Log Work'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
