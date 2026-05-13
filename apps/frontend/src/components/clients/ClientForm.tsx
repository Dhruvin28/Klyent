import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateClient, useUpdateClient } from '@/hooks/useClients'
import { useToast } from '@/components/ui/toast'
import type { Client } from '@/types'

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  projectDescription: z.string().optional(),
  totalDealAmount: z.coerce.number().min(0, 'Amount must be positive'),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ON_HOLD']),
})

type FormData = z.infer<typeof schema>

interface ClientFormProps {
  client?: Client
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ClientForm({ client, open, onOpenChange }: ClientFormProps) {
  const isEdit = !!client
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const { toast } = useToast()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      address: '',
      projectDescription: '',
      totalDealAmount: 0,
      status: 'ACTIVE',
    },
  })

  useEffect(() => {
    if (client) {
      reset({
        name: client.name,
        email: client.email ?? '',
        phone: client.phone ?? '',
        address: client.address ?? '',
        projectDescription: client.projectDescription ?? '',
        totalDealAmount: client.totalDealAmount,
        status: client.status,
      })
    } else {
      reset({
        name: '',
        email: '',
        phone: '',
        address: '',
        projectDescription: '',
        totalDealAmount: 0,
        status: 'ACTIVE',
      })
    }
  }, [client, reset])

  const onSubmit = async (data: FormData) => {
    try {
      const payload = {
        ...data,
        email: data.email || undefined,
        phone: data.phone || undefined,
        address: data.address || undefined,
        projectDescription: data.projectDescription || undefined,
      }

      if (isEdit && client) {
        await updateClient.mutateAsync({ id: client.id, data: payload })
        toast({ title: 'Client updated', description: 'Changes saved successfully.' })
      } else {
        await createClient.mutateAsync(payload)
        toast({ title: 'Client created', description: 'New client has been added.' })
      }
      onOpenChange(false)
    } catch {
      toast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' })
    }
  }

  const statusValue = watch('status')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Client' : 'Add New Client'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="Client name" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="client@example.com" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" placeholder="+91 98765 43210" {...register('phone')} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input id="address" placeholder="Street, City, State" {...register('address')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="totalDealAmount">Deal Amount (₹) *</Label>
              <Input
                id="totalDealAmount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                {...register('totalDealAmount')}
              />
              {errors.totalDealAmount && (
                <p className="text-xs text-destructive">{errors.totalDealAmount.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Status *</Label>
              <Select
                value={statusValue}
                onValueChange={(v) => setValue('status', v as FormData['status'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="ON_HOLD">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="projectDescription">Project Description</Label>
              <Textarea
                id="projectDescription"
                placeholder="Brief description of the project..."
                rows={3}
                {...register('projectDescription')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
