import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement } from '@/hooks/useProcurement'
import { useStudioProjects } from '@/hooks/useStudio'
import { CATEGORIES, UNITS } from './common'
import type { ProcurementItem } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: ProcurementItem | null
  defaultProjectId?: string
}

interface FormState {
  projectId: string
  title: string
  category: string
  specification: string
  quantity: string
  unit: string
  clientRate: string
  neededBy: string
  notes: string
}

export function ItemDialog({ open, onOpenChange, item, defaultProjectId }: Props) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const { data: projects = [] } = useStudioProjects()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)

  useEffect(() => {
    if (!open) return
    setForm({
      projectId: item?.projectId ?? defaultProjectId ?? '',
      title: item?.title ?? '',
      category: item?.category ?? '',
      specification: item?.specification ?? '',
      quantity: item ? String(item.quantity) : '1',
      unit: item?.unit ?? 'Nos',
      clientRate: item?.clientRate != null ? String(item.clientRate) : '',
      neededBy: item?.neededBy ?? '',
      notes: item?.notes ?? '',
    })
  }, [open, item, defaultProjectId])

  if (!form) return null
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))

  const handleSave = async () => {
    if (!form.title.trim()) return toast({ title: 'Describe what is needed', variant: 'destructive' })
    if (!(Number(form.quantity) > 0)) return toast({ title: 'Quantity must be more than zero', variant: 'destructive' })

    const payload = {
      projectId: form.projectId || null,
      title: form.title.trim(),
      category: form.category || null,
      specification: form.specification || null,
      quantity: Number(form.quantity),
      unit: form.unit,
      clientRate: form.clientRate.trim() === '' ? null : Number(form.clientRate),
      neededBy: form.neededBy || null,
      notes: form.notes || null,
    }
    setSaving(true)
    try {
      const saved = item
        ? await procurementApi.updateItem(item.id, payload)
        : await procurementApi.createItem(payload)
      invalidate()
      onOpenChange(false)
      if (item) {
        toast({ title: 'Requirement updated' })
      } else {
        toast({ title: 'Requirement added', description: 'Now add vendor quotes to compare.' })
        navigate(`/procurement/items/${saved.id}`)
      }
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to save the requirement.'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Requirement' : 'New Requirement'}</DialogTitle>
          <DialogDescription>Something the project needs to buy. Collect quotes for it, approve one, then order.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2 pt-1">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Project</Label>
            <Select value={form.projectId || 'none'} onValueChange={(v) => set('projectId', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">No project (general stock)</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>What is needed *</Label>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. BWP Plywood 18mm for wardrobes" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Quantity *</Label>
            <Input type="number" min={0} step="any" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Unit</Label>
            <Select value={form.unit} onValueChange={(v) => set('unit', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...new Set([...UNITS, form.unit])].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Input value={form.category} onChange={(e) => set('category', e.target.value)} list="item-categories" />
            <datalist id="item-categories">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Needed by</Label>
            <Input type="date" value={form.neededBy} onChange={(e) => set('neededBy', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Client rate per {form.unit} (before GST)</Label>
            <Input type="number" min={0} step="any" value={form.clientRate} onChange={(e) => set('clientRate', e.target.value)} placeholder="What you charge the client — used for your margin" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Specification</Label>
            <Textarea rows={2} value={form.specification} onChange={(e) => set('specification', e.target.value)} placeholder="Grade, finish, size, colour code, brand preference…" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {item ? 'Save' : 'Add & Compare'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
