import { useEffect, useState } from 'react'
import { Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement, useProductPrices, useVendors } from '@/hooks/useProcurement'
import { GST_RATES } from '@/lib/indianStates'
import { formatCurrency, formatDate } from '@/lib/utils'
import { CATEGORIES, UNITS } from './common'
import type { VendorProduct } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: VendorProduct | null
  defaultVendorId?: string
}

interface FormState {
  vendorId: string
  name: string
  brand: string
  sku: string
  category: string
  unit: string
  price: string
  gstRate: string
  hsnCode: string
  leadTimeDays: string
  minOrderQty: string
  description: string
  isActive: boolean
}

const optNum = (s: string) => (s.trim() === '' ? null : Number(s))

export function ProductDialog({ open, onOpenChange, product, defaultVendorId }: Props) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const { data: vendors = [] } = useVendors()
  const { data: prices = [] } = useProductPrices(open && product ? product.id : null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)

  useEffect(() => {
    if (!open) return
    setForm({
      vendorId: product?.vendorId ?? defaultVendorId ?? '',
      name: product?.name ?? '',
      brand: product?.brand ?? '',
      sku: product?.sku ?? '',
      category: product?.category ?? '',
      unit: product?.unit ?? 'Nos',
      price: product ? String(product.price) : '',
      gstRate: String(product?.gstRate ?? 18),
      hsnCode: product?.hsnCode ?? '',
      leadTimeDays: product?.leadTimeDays != null ? String(product.leadTimeDays) : '',
      minOrderQty: product?.minOrderQty != null ? String(product.minOrderQty) : '',
      description: product?.description ?? '',
      isActive: product?.isActive ?? true,
    })
  }, [open, product, defaultVendorId])

  if (!form) return null
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))

  const handleSave = async () => {
    if (!form.vendorId) return toast({ title: 'Choose a vendor', variant: 'destructive' })
    if (!form.name.trim()) return toast({ title: 'Product name is required', variant: 'destructive' })
    if (form.price.trim() === '' || Number(form.price) < 0) return toast({ title: 'Enter a valid price', variant: 'destructive' })

    const payload = {
      vendorId: form.vendorId,
      name: form.name.trim(),
      brand: form.brand || null,
      sku: form.sku || null,
      category: form.category || null,
      unit: form.unit,
      price: Number(form.price),
      gstRate: Number(form.gstRate),
      hsnCode: form.hsnCode || null,
      leadTimeDays: optNum(form.leadTimeDays),
      minOrderQty: optNum(form.minOrderQty),
      description: form.description || null,
      isActive: form.isActive,
    }
    setSaving(true)
    try {
      if (product) await procurementApi.updateProduct(product.id, payload)
      else await procurementApi.createProduct(payload)
      invalidate()
      toast({ title: product ? 'Product updated' : 'Product added to catalog' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to save the product.'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // History is newest first: [0] is the current price, [1] the one before it.
  const previous = prices[1]
  const change = product && previous ? ((product.price - previous.price) / previous.price) * 100 : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? 'Edit Product' : 'Add Product'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2 pt-1">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Vendor *</Label>
            <Select value={form.vendorId || 'none'} onValueChange={(v) => set('vendorId', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none" disabled>Select vendor</SelectItem>
                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {vendors.length === 0 && (
              <p className="text-xs text-muted-foreground">Add a vendor in the Vendors tab first.</p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Product Name *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. BWP Plywood 18mm 8x4" />
          </div>
          <div className="space-y-1.5">
            <Label>Brand</Label>
            <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="e.g. Century" />
          </div>
          <div className="space-y-1.5">
            <Label>SKU / Code</Label>
            <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="Vendor's code" />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Input value={form.category} onChange={(e) => set('category', e.target.value)} list="product-categories" />
            <datalist id="product-categories">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
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
            <Label>Price per {form.unit} (before GST) *</Label>
            <Input type="number" min={0} step="any" value={form.price} onChange={(e) => set('price', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>GST %</Label>
            <Select value={form.gstRate} onValueChange={(v) => set('gstRate', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>HSN Code</Label>
            <Input value={form.hsnCode} onChange={(e) => set('hsnCode', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Lead Time (days)</Label>
            <Input type="number" min={0} value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Minimum Order Qty</Label>
            <Input type="number" min={0} step="any" value={form.minOrderQty} onChange={(e) => set('minOrderQty', e.target.value)} />
          </div>
          <div className="space-y-1.5 flex items-end">
            <label className="flex items-center gap-2 text-sm h-10">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-4 w-4" />
              Available (show in comparisons)
            </label>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
        </div>

        {product && prices.length > 0 && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Price history</p>
              {change !== null && change !== 0 && (
                <span className={`text-xs flex items-center gap-1 ${change > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  {change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {change > 0 ? '+' : ''}{change.toFixed(1)}% since last change
                </span>
              )}
            </div>
            <div className="max-h-32 overflow-y-auto divide-y divide-border text-sm">
              {prices.map((p, i) => (
                <div key={i} className="flex justify-between py-1">
                  <span className="text-muted-foreground">{formatDate(p.recordedAt)}</span>
                  <span className="tabular-nums">{formatCurrency(p.price)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
