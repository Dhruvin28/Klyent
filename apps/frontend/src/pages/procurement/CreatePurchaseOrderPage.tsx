import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, FileText, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { PurchaseOrderPDF } from '@/components/procurement/PurchaseOrderPDF'
import { VendorDialog } from '@/components/procurement/VendorDialog'
import { UNITS, today, uid } from '@/components/procurement/common'
import { procurementApi, apiErrorMessage, type OrderData } from '@/api/procurement'
import { useInvalidateProcurement, useProcurementItems, useProducts, usePurchaseOrder, useVendors } from '@/hooks/useProcurement'
import { useStudioProjects } from '@/hooks/useStudio'
import { useAuthStore } from '@/store/auth.store'
import { computeInvoiceTotals } from '@/lib/invoiceTotals'
import { INDIAN_STATES, GST_RATES, stateByCode, stateCodeFromGstin } from '@/lib/indianStates'
import { formatCurrency } from '@/lib/utils'
import type { PurchaseOrder, PurchaseOrderLine } from '@/types'

type Line = Omit<PurchaseOrderLine, 'receivedQuantity'>

interface FormState {
  poNumber: string
  poDate: string
  expectedDelivery: string
  vendorId: string
  projectId: string
  deliveryAddress: string
  placeOfSupplyCode: string
  lineItems: Line[]
  notes: string
  terms: { id: string; text: string }[]
}

const DEFAULT_TERMS = [
  'Material must match the approved sample, brand and specification.',
  'Deliver to the site address above; unloading is the supplier\'s responsibility.',
  'Payment as per agreed terms, against the supplier\'s GST invoice quoting this PO number.',
  'Damaged or non-conforming material will be returned at the supplier\'s cost.',
]

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function blankLine(): Line {
  return { id: uid(), itemId: null, productId: null, description: '', hsnSac: '', quantity: 1, unit: 'Nos', rate: 0, discountPercent: 0, taxRate: 18 }
}

function orderToForm(po: PurchaseOrder): FormState {
  return {
    poNumber: po.poNumber,
    poDate: po.poDate,
    expectedDelivery: po.expectedDelivery ?? '',
    vendorId: po.vendorId,
    projectId: po.projectId ?? '',
    deliveryAddress: po.deliveryAddress ?? '',
    placeOfSupplyCode: po.placeOfSupplyCode ?? '',
    lineItems: (po.lineItems ?? []).map(({ receivedQuantity: _r, ...l }) => l),
    notes: po.notes ?? '',
    terms: (po.termsAndConditions ?? []).map((text) => ({ id: uid(), text })),
  }
}

export function CreatePurchaseOrderPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const [params] = useSearchParams()
  const user = useAuthStore((s) => s.user)

  const editId = params.get('editId')
  const presetVendorId = params.get('vendorId') ?? ''
  const presetProjectId = params.get('projectId') ?? ''
  const itemIds = useMemo(() => (params.get('itemIds') ?? '').split(',').filter(Boolean), [params])

  const [saving, setSaving] = useState(false)
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(() => ({
    poNumber: '',
    poDate: today(),
    expectedDelivery: '',
    vendorId: presetVendorId,
    projectId: presetProjectId,
    deliveryAddress: '',
    placeOfSupplyCode: stateCodeFromGstin(user?.companyGstin) ?? '',
    lineItems: itemIds.length ? [] : [blankLine()],
    notes: '',
    terms: DEFAULT_TERMS.map((text) => ({ id: uid(), text })),
  }))
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  const { data: vendors = [] } = useVendors()
  const { data: projects = [] } = useStudioProjects()
  const { data: existing } = usePurchaseOrder(editId)
  const { data: sourceItems } = useProcurementItems({ ids: itemIds }, itemIds.length > 0 && !editId)
  const { data: vendorProducts = [] } = useProducts({ vendorId: form.vendorId }, !!form.vendorId)

  const vendor = vendors.find((v) => v.id === form.vendorId)
  const supplierStateCode = stateCodeFromGstin(vendor?.gstin) ?? ''

  // ── Seed: an order being edited ──
  const seeded = useRef(false)
  useEffect(() => {
    if (!existing || seeded.current) return
    seeded.current = true
    setForm(orderToForm(existing))
  }, [existing])

  // ── Seed: lines from approved quotes (Create PO from requirements) ──
  const seededItems = useRef(false)
  useEffect(() => {
    if (!sourceItems || seededItems.current || editId) return
    seededItems.current = true
    const lines: Line[] = sourceItems
      .filter((i) => i.approvedQuote && i.approvedQuote.vendorId === presetVendorId)
      .map((i) => ({
        id: uid(),
        itemId: i.id,
        productId: i.approvedQuote!.productId ?? null,
        description: i.specification ? `${i.title} — ${i.specification}` : i.title,
        hsnSac: '',
        quantity: i.quantity,
        unit: i.approvedQuote!.unit ?? i.unit,
        rate: i.approvedQuote!.price ?? 0,
        discountPercent: 0,
        taxRate: i.approvedQuote!.gstRate ?? 18,
      }))
    const lead = Math.max(0, ...sourceItems.map((i) => i.approvedQuote?.leadTimeDays ?? 0))
    setForm((f) => ({
      ...f,
      lineItems: lines.length ? lines : [blankLine()],
      expectedDelivery: f.expectedDelivery || (lead ? addDays(f.poDate, lead) : ''),
    }))
  }, [sourceItems, editId, presetVendorId])

  // ── Suggest the next PO number ──
  const numbered = useRef(false)
  useEffect(() => {
    if (editId || numbered.current) return
    numbered.current = true
    procurementApi.getNextOrderNumber()
      .then((n) => setForm((f) => (f.poNumber ? f : { ...f, poNumber: n })))
      .catch(() => { /* optional suggestion */ })
  }, [editId])

  // Default the delivery address to the project's site.
  useEffect(() => {
    if (form.deliveryAddress || !form.projectId) return
    const site = projects.find((p) => p.id === form.projectId)?.siteAddress
    if (site) setForm((f) => (f.deliveryAddress ? f : { ...f, deliveryAddress: site }))
  }, [form.projectId, form.deliveryAddress, projects])

  const updateLine = (id: string, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lineItems: f.lineItems.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const removeLine = (id: string) =>
    setForm((f) => ({ ...f, lineItems: f.lineItems.length > 1 ? f.lineItems.filter((l) => l.id !== id) : f.lineItems }))

  const addProductLine = (productId: string) => {
    const p = vendorProducts.find((x) => x.id === productId)
    if (!p) return
    const line: Line = {
      id: uid(), itemId: null, productId: p.id,
      description: [p.name, p.brand].filter(Boolean).join(' — '),
      hsnSac: p.hsnCode ?? '', quantity: p.minOrderQty ?? 1, unit: p.unit, rate: p.price, discountPercent: 0, taxRate: p.gstRate,
    }
    // Replace the untouched blank row rather than leaving it behind.
    setForm((f) => {
      const blank = f.lineItems.length === 1 && !f.lineItems[0].description.trim() && !f.lineItems[0].rate
      return { ...f, lineItems: blank ? [line] : [...f.lineItems, line] }
    })
  }

  const totals = useMemo(
    () => computeInvoiceTotals(form.lineItems, supplierStateCode, form.placeOfSupplyCode),
    [form.lineItems, supplierStateCode, form.placeOfSupplyCode]
  )

  const previewOrder: PurchaseOrder = useMemo(() => {
    const place = stateByCode(form.placeOfSupplyCode)
    const supplier = stateByCode(supplierStateCode)
    return {
      id: 'preview', poNumber: form.poNumber || 'DRAFT', poDate: form.poDate, expectedDelivery: form.expectedDelivery || null,
      projectId: form.projectId || null, vendorId: form.vendorId, vendorName: vendor?.name ?? 'Vendor',
      vendorPhone: vendor?.phone, vendorEmail: vendor?.email, vendorAddress: vendor?.address, vendorGstin: vendor?.gstin,
      deliveryAddress: form.deliveryAddress, supplierStateCode: supplierStateCode || null, supplierStateName: supplier?.name ?? null,
      placeOfSupplyCode: form.placeOfSupplyCode || null, placeOfSupplyName: place?.name ?? null, isInterState: totals.isInterState,
      lineItems: form.lineItems.map((l) => ({ ...l, receivedQuantity: 0 })),
      subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxableAmount: totals.taxableAmount,
      cgstAmount: totals.cgstAmount, sgstAmount: totals.sgstAmount, igstAmount: totals.igstAmount, totalTax: totals.totalTax,
      roundOff: totals.roundOff, totalAmount: totals.totalAmount, amountInWords: totals.amountInWords,
      notes: form.notes, termsAndConditions: form.terms.map((t) => t.text).filter(Boolean), status: 'DRAFT',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      companyName: user?.companyName ?? null, companyLogoUrl: null, companyPhone: user?.companyPhone ?? null,
      companyAddress: user?.companyAddress ?? null, companyWebsite: user?.companyWebsite ?? null, companyGstin: user?.companyGstin ?? null,
    }
  }, [form, totals, vendor, supplierStateCode, user])

  const handleSave = async (status: 'DRAFT' | 'SENT') => {
    const error =
      !form.poNumber.trim() ? 'PO number is required.'
      : !form.vendorId ? 'Choose a vendor.'
      : form.lineItems.some((l) => !l.description.trim()) ? 'Every line needs a description.'
      : form.lineItems.some((l) => !(Number(l.quantity) > 0)) ? 'Every line needs a quantity above zero.'
      : null
    if (error) return toast({ title: 'Cannot save', description: error, variant: 'destructive' })

    const place = stateByCode(form.placeOfSupplyCode)
    const payload: OrderData = {
      poNumber: form.poNumber.trim(),
      poDate: form.poDate,
      expectedDelivery: form.expectedDelivery || null,
      projectId: form.projectId || null,
      vendorId: form.vendorId,
      deliveryAddress: form.deliveryAddress || null,
      placeOfSupplyCode: form.placeOfSupplyCode || null,
      placeOfSupplyName: place?.name ?? null,
      lineItems: form.lineItems.map((l) => ({
        ...l,
        quantity: Number(l.quantity) || 0,
        rate: Number(l.rate) || 0,
        discountPercent: Number(l.discountPercent) || 0,
        taxRate: Number(l.taxRate) || 0,
      })),
      notes: form.notes || null,
      termsAndConditions: form.terms.map((t) => t.text.trim()).filter(Boolean),
      // Editing keeps the PO's delivery state; only a draft is promoted on "issue".
      ...(editId && existing && existing.status !== 'DRAFT' ? {} : { status }),
    }

    setSaving(true)
    try {
      const saved = editId ? await procurementApi.updateOrder(editId, payload) : await procurementApi.createOrder(payload)
      invalidate()
      toast({ title: editId ? 'Purchase order updated' : 'Purchase order created' })
      navigate(`/procurement/orders/${saved.id}`)
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to save the purchase order.'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const editingIssued = !!(editId && existing && existing.status !== 'DRAFT')

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <button onClick={() => navigate(-1)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <h2 className="text-lg font-semibold">{editId ? 'Edit Purchase Order' : 'New Purchase Order'}</h2>
          <p className="text-sm text-muted-foreground">GST purchase order to send to your vendor</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <PDFDownloadLink document={<PurchaseOrderPDF order={previewOrder} />} fileName={`PO-${(form.poNumber || 'draft').replace(/\//g, '-')}.pdf`}>
            {({ loading }) => (
              <Button variant="outline" size="sm" disabled={loading}>
                <FileText className="h-4 w-4 mr-1" /> {loading ? 'Preparing…' : 'Preview PDF'}
              </Button>
            )}
          </PDFDownloadLink>
          {editingIssued ? (
            <Button size="sm" disabled={saving} onClick={() => handleSave('SENT')}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled={saving} onClick={() => handleSave('DRAFT')}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save Draft
              </Button>
              <Button size="sm" disabled={saving} onClick={() => handleSave('SENT')}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save &amp; Issue
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Order Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>PO Number *</Label>
            <Input value={form.poNumber} onChange={(e) => set('poNumber', e.target.value)} placeholder="PO/25-26/001" />
          </div>
          <div className="space-y-1.5">
            <Label>PO Date *</Label>
            <Input type="date" value={form.poDate} onChange={(e) => set('poDate', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Deliver By</Label>
            <Input type="date" value={form.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Vendor *</Label>
            <div className="flex gap-2">
              <Select value={form.vendorId || 'none'} onValueChange={(v) => set('vendorId', v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none" disabled>Select vendor</SelectItem>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" title="New vendor" onClick={() => setVendorDialogOpen(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {vendor && (
              <p className="text-xs text-muted-foreground">
                {[vendor.phone, vendor.gstin ? `GSTIN ${vendor.gstin}` : 'No GSTIN — tax assumed intra-state'].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={form.projectId || 'none'} onValueChange={(v) => set('projectId', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">No project</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Delivery Address</Label>
            <Textarea rows={2} value={form.deliveryAddress} onChange={(e) => set('deliveryAddress', e.target.value)} placeholder="Site address" />
          </div>
          <div className="space-y-1.5">
            <Label>Place of Supply</Label>
            <Select value={form.placeOfSupplyCode || 'none'} onValueChange={(v) => set('placeOfSupplyCode', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">Not specified</SelectItem>
                {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{totals.isInterState ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
          <CardTitle className="text-base">Items</CardTitle>
          <div className="flex gap-2 flex-wrap">
            {vendorProducts.length > 0 && (
              <Select value="" onValueChange={addProductLine}>
                <SelectTrigger className="w-56 h-9"><SelectValue placeholder="Add from price list…" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {vendorProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price)}/{p.unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={() => set('lineItems', [...form.lineItems, blankLine()])}>
              <Plus className="h-4 w-4 mr-1" /> Add Line
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden lg:grid grid-cols-12 gap-2 px-1 text-xs font-medium text-muted-foreground">
            <div className="col-span-4">Description</div>
            <div className="col-span-1">HSN</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-1">Unit</div>
            <div className="col-span-2 text-right">Rate</div>
            <div className="col-span-1 text-right">GST %</div>
            <div className="col-span-2 text-right">Amount</div>
          </div>
          {form.lineItems.map((l) => {
            const amount = (Number(l.quantity) || 0) * (Number(l.rate) || 0) * (1 - (Number(l.discountPercent) || 0) / 100)
            return (
              <div key={l.id} className="grid grid-cols-2 lg:grid-cols-12 gap-2 items-start rounded-lg border border-border p-3 lg:border-0 lg:p-0">
                <div className="col-span-2 lg:col-span-4 space-y-1">
                  <Label className="lg:hidden text-xs">Description</Label>
                  <Input value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} placeholder="Material, brand, size" />
                  {l.itemId && <p className="text-[11px] text-muted-foreground px-1">From an approved quote</p>}
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">HSN</Label>
                  <Input value={l.hsnSac ?? ''} onChange={(e) => updateLine(l.id, { hsnSac: e.target.value })} />
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">Qty</Label>
                  <Input type="number" min={0} step="any" className="text-right" value={l.quantity}
                    onChange={(e) => updateLine(l.id, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })} />
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">Unit</Label>
                  <Select value={l.unit || 'Nos'} onValueChange={(v) => updateLine(l.id, { unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[...new Set([...UNITS, l.unit || 'Nos'])].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="lg:col-span-2 space-y-1">
                  <Label className="lg:hidden text-xs">Rate</Label>
                  <Input type="number" min={0} step="any" className="text-right" value={l.rate}
                    onChange={(e) => updateLine(l.id, { rate: e.target.value === '' ? 0 : Number(e.target.value) })} />
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">GST %</Label>
                  <Select value={String(l.taxRate ?? 0)} onValueChange={(v) => updateLine(l.id, { taxRate: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 lg:col-span-2 flex items-center justify-between lg:justify-end gap-2 pt-1 lg:pt-2">
                  <span className="text-sm font-medium tabular-nums">{amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0 shrink-0"
                    onClick={() => removeLine(l.id)} disabled={form.lineItems.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}

          <div className="flex justify-end pt-2">
            <div className="w-full sm:w-72 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Taxable Value</span><span className="tabular-nums">{formatCurrency(totals.taxableAmount)}</span></div>
              {totals.isInterState ? (
                <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatCurrency(totals.igstAmount)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatCurrency(totals.cgstAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatCurrency(totals.sgstAmount)}</span></div>
                </>
              )}
              {totals.roundOff !== 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Round Off</span><span className="tabular-nums">{formatCurrency(totals.roundOff)}</span></div>
              )}
              <div className="flex justify-between border-t border-border pt-2 mt-2 text-base font-semibold">
                <span>Total</span><span className="tabular-nums">{formatCurrency(totals.totalAmount)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Notes &amp; Terms</CardTitle>
          <Button variant="outline" size="sm" onClick={() => set('terms', [...form.terms, { id: uid(), text: '' }])}>
            <Plus className="h-4 w-4 mr-1" /> Add Term
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Notes for the vendor</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Delivery timing, site contact, packing…" />
          </div>
          <div className="space-y-2">
            <Label>Terms &amp; Conditions</Label>
            {form.terms.map((t) => (
              <div key={t.id} className="flex gap-2">
                <Input value={t.text} onChange={(e) => set('terms', form.terms.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => set('terms', form.terms.filter((x) => x.id !== t.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <VendorDialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen} onSaved={(v) => set('vendorId', v.id)} />
    </div>
  )
}
