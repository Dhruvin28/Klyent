import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement, useProducts, useVendors } from '@/hooks/useProcurement'
import { GST_RATES } from '@/lib/indianStates'
import { cn, formatCurrency } from '@/lib/utils'
import { UNITS, sameUnit } from './common'
import type { ProcurementItemDetail, ProcurementQuote } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ProcurementItemDetail
  // Editing an existing quote; otherwise a new one is added.
  quote?: ProcurementQuote | null
}

type Mode = 'catalog' | 'manual'
const NEW_VENDOR = '__new__'

interface FormState {
  vendorId: string
  newVendorName: string
  price: string
  unit: string
  gstRate: string
  leadTimeDays: string
  validTill: string
  notes: string
}

export function QuoteDialog({ open, onOpenChange, item, quote }: Props) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const { data: vendors = [] } = useVendors()
  const [mode, setMode] = useState<Mode>('catalog')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({
    vendorId: '', newVendorName: '', price: '', unit: item.unit, gstRate: '18', leadTimeDays: '', validTill: '', notes: '',
  })

  useEffect(() => {
    if (!open) return
    setMode(quote ? 'manual' : 'catalog')
    // Start the catalog search from the item's category, or its first words.
    setSearch(item.category ?? item.title.split(/\s+/).slice(0, 2).join(' '))
    setForm({
      vendorId: quote?.vendorId ?? '',
      newVendorName: '',
      price: quote?.price != null ? String(quote.price) : '',
      unit: quote?.unit ?? item.unit,
      gstRate: String(quote?.gstRate ?? 18),
      leadTimeDays: quote?.leadTimeDays != null ? String(quote.leadTimeDays) : '',
      validTill: quote?.validTill ?? '',
      notes: quote?.notes ?? '',
    })
    // Only on opening: adding from the catalog refetches the item, and that must
    // not reset the search the designer is working through.
  }, [open, quote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: products = [], isFetching } = useProducts({ q: search }, open && mode === 'catalog' && !quote)
  const quotedProducts = new Set(item.quotes.map((q) => q.productId).filter(Boolean))

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  const addFromCatalog = async (productId: string) => {
    setAddingId(productId)
    try {
      await procurementApi.addQuote(item.id, { productId })
      invalidate()
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to add the quote.'), variant: 'destructive' })
    } finally {
      setAddingId(null)
    }
  }

  const handleSave = async () => {
    if (form.price.trim() === '' || Number(form.price) < 0) return toast({ title: 'Enter the quoted price', variant: 'destructive' })
    const isNew = form.vendorId === NEW_VENDOR
    if (!quote && !form.vendorId) return toast({ title: 'Choose a vendor', variant: 'destructive' })
    if (isNew && !form.newVendorName.trim()) return toast({ title: 'Enter the new vendor\'s name', variant: 'destructive' })

    const common = {
      price: Number(form.price),
      unit: form.unit || null,
      gstRate: Number(form.gstRate),
      leadTimeDays: form.leadTimeDays.trim() === '' ? null : Math.round(Number(form.leadTimeDays)),
      validTill: form.validTill || null,
      notes: form.notes || null,
    }
    setSaving(true)
    try {
      if (quote) {
        await procurementApi.updateQuote(quote.id, {
          ...common,
          ...(form.vendorId && !isNew ? { vendorId: form.vendorId } : {}),
          // A changed price on a quote that has not won yet is a revision.
          ...(quote.status !== 'approved' && quote.price !== null && quote.price !== common.price ? { status: 'revised' as const } : {}),
        })
      } else {
        await procurementApi.addQuote(item.id, {
          ...common,
          ...(isNew ? { vendorName: form.newVendorName.trim() } : { vendorId: form.vendorId }),
        })
      }
      invalidate()
      toast({ title: quote ? 'Quote updated' : 'Quote added' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to save the quote.'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{quote ? `Edit quote — ${quote.vendorName ?? 'Vendor'}` : 'Add quotes'}</DialogTitle>
          <p className="text-sm text-muted-foreground">{item.title} · {item.quantity} {item.unit}</p>
        </DialogHeader>

        {!quote && (
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(['catalog', 'manual'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m === 'catalog' ? 'From price lists' : 'Enter a quote'}
              </button>
            ))}
          </div>
        )}

        {mode === 'catalog' && !quote ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products, brands, vendors…" />
            </div>
            <div className="rounded-lg border border-border divide-y divide-border max-h-[50vh] overflow-y-auto">
              {isFetching && products.length === 0 ? (
                <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : products.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground space-y-2">
                  <p>No matching products in your vendors&apos; price lists.</p>
                  <Button variant="link" size="sm" onClick={() => setMode('manual')}>Enter a quote by hand instead</Button>
                </div>
              ) : (
                products.map((p) => {
                  const added = quotedProducts.has(p.id)
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}{p.brand ? ` · ${p.brand}` : ''}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.vendorName}
                          {p.leadTimeDays != null && ` · ${p.leadTimeDays}d delivery`}
                          {!sameUnit(p.unit, item.unit) && (
                            <span className="text-amber-600 dark:text-amber-400"> · sold per {p.unit}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular-nums">{formatCurrency(p.price)}</p>
                          <p className="text-xs text-muted-foreground">/{p.unit} + {p.gstRate}%</p>
                        </div>
                        <Button size="sm" variant={added ? 'ghost' : 'outline'} disabled={added || addingId === p.id} onClick={() => addFromCatalog(p.id)}>
                          {addingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : added ? <Check className="h-4 w-4 text-green-600" /> : <Plus className="h-4 w-4" />}
                          <span className="ml-1">{added ? 'Added' : 'Add'}</span>
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Vendor {quote ? '' : '*'}</Label>
              <Select value={form.vendorId || 'none'} onValueChange={(v) => set('vendorId', v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none" disabled>Select vendor</SelectItem>
                  {!quote && <SelectItem value={NEW_VENDOR}>+ New vendor…</SelectItem>}
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.vendorId === NEW_VENDOR && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>New vendor name *</Label>
                <Input value={form.newVendorName} onChange={(e) => set('newVendorName', e.target.value)} autoFocus />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Price per unit (before GST) *</Label>
              <Input type="number" min={0} step="any" value={form.price} onChange={(e) => set('price', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Select value={form.unit} onValueChange={(v) => set('unit', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...new Set([...UNITS, form.unit, item.unit])].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
              {!sameUnit(form.unit, item.unit) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">The requirement is in {item.unit} — totals assume one {form.unit} per {item.unit}.</p>
              )}
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
              <Label>Delivery in (days)</Label>
              <Input type="number" min={0} value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Quote valid till</Label>
              <Input type="date" value={form.validTill} onChange={(e) => set('validTill', e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Transport extra, 50% advance, brand offered…" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{mode === 'catalog' && !quote ? 'Done' : 'Cancel'}</Button>
          {(mode === 'manual' || quote) && (
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {quote ? 'Save' : 'Add Quote'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
