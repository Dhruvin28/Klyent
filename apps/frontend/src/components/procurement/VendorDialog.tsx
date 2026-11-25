import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage, type VendorData } from '@/api/procurement'
import { useInvalidateProcurement } from '@/hooks/useProcurement'
import { CATEGORIES } from './common'
import type { Vendor } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  vendor?: Vendor | null
  onSaved?: (vendor: Vendor) => void
}

const EMPTY: VendorData = { name: '', phone: '', email: '', gstin: '', address: '', category: '', notes: '' }

export function VendorDialog({ open, onOpenChange, vendor, onSaved }: Props) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const [form, setForm] = useState<VendorData>(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(vendor
      ? {
          name: vendor.name,
          phone: vendor.phone ?? '',
          email: vendor.email ?? '',
          gstin: vendor.gstin ?? '',
          address: vendor.address ?? '',
          category: vendor.category ?? '',
          notes: vendor.notes ?? vendor.contactInfo ?? '',
        }
      : EMPTY)
  }, [open, vendor])

  const set = <K extends keyof VendorData>(key: K, value: VendorData[K]) => setForm((f) => ({ ...f, [key]: value }))

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Vendor name is required', variant: 'destructive' })
      return
    }
    const payload: VendorData = {
      name: form.name.trim(),
      phone: form.phone || null,
      email: form.email || null,
      gstin: form.gstin || null,
      address: form.address || null,
      category: form.category || null,
      notes: form.notes || null,
    }
    setSaving(true)
    try {
      const saved = vendor
        ? await procurementApi.updateVendor(vendor.id, payload)
        : await procurementApi.createVendor(payload)
      invalidate()
      toast({ title: vendor ? 'Vendor updated' : 'Vendor added' })
      onSaved?.(saved)
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to save the vendor.'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{vendor ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2 pt-1">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Vendor Name *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sharma Plywood House" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Phone / WhatsApp</Label>
            <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>GSTIN</Label>
            <Input value={form.gstin ?? ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} placeholder="24ABCDE1234F1Z5" />
          </div>
          <div className="space-y-1.5">
            <Label>Supplies</Label>
            <Input value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} list="vendor-categories" placeholder="e.g. Hardware" />
            <datalist id="vendor-categories">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Address</Label>
            <Textarea rows={2} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Payment terms, contact person, delivery days…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
