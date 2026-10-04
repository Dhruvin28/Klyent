import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCreateStudioProject } from '@/hooks/useStudio'
import { useToast } from '@/components/ui/toast'

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  clientName: z.string().optional(),
  siteAddress: z.string().optional(),
  projectType: z.string().optional(),
  budget: z.coerce.number().min(0).optional(),
  timelineNotes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface StudioProjectFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StudioProjectForm({ open, onOpenChange }: StudioProjectFormProps) {
  const createProject = useCreateStudioProject()
  const { toast } = useToast()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { name: '' } })

  const onSubmit = async (data: FormData) => {
    try {
      await createProject.mutateAsync(data)
      toast({ title: 'Project created' })
      reset()
      onOpenChange(false)
    } catch {
      toast({ title: 'Failed to create project', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Studio Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Project name</Label>
            <Input id="name" placeholder="e.g. Patel Residence" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="clientName">Client name</Label>
            <Input id="clientName" {...register('clientName')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="siteAddress">Site address</Label>
            <Textarea id="siteAddress" {...register('siteAddress')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="projectType">Project type</Label>
              <Input id="projectType" placeholder="Residential / Commercial" {...register('projectType')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget">Budget</Label>
              <Input id="budget" type="number" {...register('budget')} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timelineNotes">Timeline notes</Label>
            <Textarea id="timelineNotes" {...register('timelineNotes')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
