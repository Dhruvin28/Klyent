import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateFreelanceProject, useUpdateFreelanceProject } from '@/hooks/useFreelance'
import { useToast } from '@/components/ui/toast'
import type { FreelanceProject } from '@/types'

const schema = z.object({
  clientName: z.string().min(1, 'Client name is required').max(200),
  workType: z.string().min(1, 'Work type is required').max(200),
  chargeType: z.string().min(1, 'Charge type is required').max(100),
  rate: z.coerce.number().positive('Rate must be positive'),
  notes: z.string().max(2000).optional(),
})

type FormData = z.infer<typeof schema>

const CHARGE_PRESETS = ['Hours', 'Pages', 'Sheets', 'Words', 'Slides', 'Tasks']

interface FreelanceFormProps {
  project?: FreelanceProject
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FreelanceForm({ project, open, onOpenChange }: FreelanceFormProps) {
  const { toast } = useToast()
  const create = useCreateFreelanceProject()
  const update = useUpdateFreelanceProject()

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { clientName: '', workType: '', chargeType: '', rate: 0, notes: '' },
  })

  const chargeType = watch('chargeType')

  useEffect(() => {
    if (project) {
      reset({
        clientName: project.clientName,
        workType: project.workType,
        chargeType: project.chargeType,
        rate: project.rate,
        notes: project.notes ?? '',
      })
    } else {
      reset({ clientName: '', workType: '', chargeType: '', rate: 0, notes: '' })
    }
  }, [project, open, reset])

  const onSubmit = async (data: FormData) => {
    try {
      if (project) {
        await update.mutateAsync({ id: project.id, data })
        toast({ title: 'Project updated' })
      } else {
        await create.mutateAsync(data)
        toast({ title: 'Project created' })
      }
      onOpenChange(false)
    } catch {
      toast({ title: 'Error', description: 'Failed to save project.', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? 'Edit Freelance Project' : 'New Freelance Project'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label>Client Name</Label>
            <Input {...register('clientName')} placeholder="e.g. Acme Corp" />
            {errors.clientName && <p className="text-xs text-destructive">{errors.clientName.message}</p>}
          </div>

          <div className="space-y-1">
            <Label>Type of Work</Label>
            <Input {...register('workType')} placeholder="e.g. Logo Design, Content Writing" />
            {errors.workType && <p className="text-xs text-destructive">{errors.workType.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Charge Type (unit)</Label>
              <div className="space-y-2">
                <Select value={CHARGE_PRESETS.includes(chargeType) ? chargeType : 'custom'} onValueChange={(v) => { if (v !== 'custom') setValue('chargeType', v) }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHARGE_PRESETS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    <SelectItem value="custom">Custom...</SelectItem>
                  </SelectContent>
                </Select>
                {(!CHARGE_PRESETS.includes(chargeType) || chargeType === '') && (
                  <Input {...register('chargeType')} placeholder="e.g. Revisions, Sessions" />
                )}
              </div>
              {errors.chargeType && <p className="text-xs text-destructive">{errors.chargeType.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Rate per {chargeType || 'unit'} (₹)</Label>
              <Input type="number" step="0.01" min="0" {...register('rate')} placeholder="0.00" />
              {errors.rate && <p className="text-xs text-destructive">{errors.rate.message}</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea {...register('notes')} placeholder="Project details, deadlines, scope..." rows={3} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {project ? 'Save Changes' : 'Create Project'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
