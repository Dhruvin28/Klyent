import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, ChevronLeft, Save, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { InvoicePDF } from '@/components/invoices/InvoicePDF'
import { invoicesApi, type CreateInvoiceData } from '@/api/invoices'
import { clientsApi } from '@/api/clients'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/toast'
import { computeInvoiceTotals } from '@/lib/invoiceTotals'
import { INDIAN_STATES, GST_RATES, stateByCode, stateCodeFromGstin } from '@/lib/indianStates'
import { formatCurrency } from '@/lib/utils'
import type { Invoice, InvoiceLineItem } from '@/types'

interface ItemRow extends InvoiceLineItem {}

interface FormData {
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  clientId: string
  clientName: string
  clientPhone: string
  clientEmail: string
  clientAddress: string
  clientGstin: string
  placeOfSupplyCode: string
  lineItems: ItemRow[]
  notes: string
  terms: { id: string; text: string }[]
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
  bankIfsc: string
  upiId: string
}

const DEFAULT_TERMS = [
  'Payment is due by the due date mentioned above.',
  'Interest may be charged on payments delayed beyond the due date.',
  'Goods/services once delivered will not be taken back.',
  'All disputes are subject to the jurisdiction of the supplier\'s city.',
]

const UNITS = ['Nos', 'Hrs', 'Days', 'Sqft', 'Kg', 'Pcs', 'Set', 'Lot', 'Month']

function uid() { return Math.random().toString(36).slice(2) }
function today(): string { return new Date().toISOString().slice(0, 10) }
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function blankItem(): ItemRow {
  return { id: uid(), description: '', hsnSac: '', quantity: 1, unit: 'Nos', rate: 0, discountPercent: 0, taxRate: 18 }
}

// Map a saved invoice back into the editable form shape.
function invoiceToForm(inv: Invoice): FormData {
  return {
    invoiceNumber: inv.invoiceNumber ?? '',
    invoiceDate: inv.invoiceDate ?? today(),
    dueDate: inv.dueDate ?? addDays(today(), 15),
    clientId: inv.clientId ?? '',
    clientName: inv.clientName ?? '',
    clientPhone: inv.clientPhone ?? '',
    clientEmail: inv.clientEmail ?? '',
    clientAddress: inv.clientAddress ?? '',
    clientGstin: inv.clientGstin ?? '',
    placeOfSupplyCode: inv.placeOfSupplyCode ?? '',
    lineItems: (inv.lineItems && inv.lineItems.length > 0)
      ? inv.lineItems.map((i) => ({ ...i, id: i.id || uid() }))
      : [blankItem()],
    notes: inv.notes ?? '',
    terms: (inv.termsAndConditions && inv.termsAndConditions.length > 0)
      ? inv.termsAndConditions.map((text) => ({ id: uid(), text }))
      : DEFAULT_TERMS.map((t) => ({ id: uid(), text: t })),
    bankName: inv.bankName ?? '',
    bankAccountName: inv.bankAccountName ?? '',
    bankAccountNumber: inv.bankAccountNumber ?? '',
    bankIfsc: inv.bankIfsc ?? '',
    upiId: inv.upiId ?? '',
  }
}

export function CreateInvoicePage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)

  const editId = searchParams.get('editId')
  const copyFrom = searchParams.get('copyFrom')
  const presetClientId = searchParams.get('clientId')

  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormData>(() => ({
    invoiceNumber: '',
    invoiceDate: today(),
    dueDate: addDays(today(), 15),
    clientId: presetClientId ?? '',
    clientName: '',
    clientPhone: '',
    clientEmail: '',
    clientAddress: '',
    clientGstin: '',
    placeOfSupplyCode: '',
    lineItems: [blankItem()],
    notes: '',
    terms: DEFAULT_TERMS.map((t) => ({ id: uid(), text: t })),
    bankName: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankIfsc: '',
    upiId: '',
  }))

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // The supplier's state comes from the GSTIN on the company profile — the
  // first two digits of a GSTIN are its state code.
  const supplierStateCode = stateCodeFromGstin(user?.companyGstin) ?? ''
  const supplierState = stateByCode(supplierStateCode)

  // ── Load: saved clients for the picker ───────────────────────
  const { data: clientsData } = useQuery({
    queryKey: ['clients', { limit: 100 }],
    queryFn: () => clientsApi.getClients({ limit: 100 }),
  })
  const clientOptions = clientsData?.data ?? []

  // ── Load: a source invoice when editing or duplicating ───────
  const sourceId = editId ?? copyFrom
  const { data: source } = useQuery({
    queryKey: ['invoice', sourceId],
    queryFn: () => invoicesApi.getInvoice(sourceId!),
    enabled: !!sourceId,
  })

  const seeded = useRef(false)
  useEffect(() => {
    if (!source || seeded.current) return
    seeded.current = true
    const next = invoiceToForm(source)
    // A duplicate is a new document: it gets its own number and dates.
    if (copyFrom) {
      next.invoiceNumber = ''
      next.invoiceDate = today()
      next.dueDate = addDays(today(), 15)
    }
    setForm(next)
  }, [source, copyFrom])

  // ── Suggest the next number in the series for new invoices ───
  const numbered = useRef(false)
  useEffect(() => {
    if (editId || numbered.current) return
    numbered.current = true
    invoicesApi.getNextNumber()
      .then((n) => setForm((f) => (f.invoiceNumber ? f : { ...f, invoiceNumber: n })))
      .catch(() => { /* a suggestion is optional — the field stays editable */ })
  }, [editId])

  // Default the place of supply to the supplier's own state (intra-state).
  useEffect(() => {
    if (!form.placeOfSupplyCode && supplierStateCode) {
      setForm((f) => (f.placeOfSupplyCode ? f : { ...f, placeOfSupplyCode: supplierStateCode }))
    }
  }, [supplierStateCode, form.placeOfSupplyCode])

  // ── Line item helpers ────────────────────────────────────────
  const updateItem = (id: string, patch: Partial<ItemRow>) =>
    setForm((f) => ({ ...f, lineItems: f.lineItems.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))

  const addItem = () => setForm((f) => ({ ...f, lineItems: [...f.lineItems, blankItem()] }))

  const removeItem = (id: string) =>
    setForm((f) => ({
      ...f,
      lineItems: f.lineItems.length > 1 ? f.lineItems.filter((i) => i.id !== id) : f.lineItems,
    }))

  // Picking a saved client snapshots its details onto the invoice.
  const handleSelectClient = (clientId: string) => {
    if (clientId === 'none') {
      set('clientId', '')
      return
    }
    const c = clientOptions.find((x) => x.id === clientId)
    if (!c) return
    setForm((f) => ({
      ...f,
      clientId: c.id,
      clientName: c.name,
      clientPhone: c.phone ?? '',
      clientEmail: c.email ?? '',
      clientAddress: c.address ?? '',
    }))
  }

  // ── Live totals (server recomputes these on save) ────────────
  const totals = useMemo(
    () => computeInvoiceTotals(form.lineItems, supplierStateCode, form.placeOfSupplyCode),
    [form.lineItems, supplierStateCode, form.placeOfSupplyCode]
  )

  // A preview invoice shaped like the real thing, for the PDF button.
  const previewInvoice: Invoice = useMemo(() => {
    const place = stateByCode(form.placeOfSupplyCode)
    return {
      id: 'preview',
      invoiceNumber: form.invoiceNumber || 'DRAFT',
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate,
      clientId: form.clientId || null,
      clientName: form.clientName || 'Client',
      clientPhone: form.clientPhone,
      clientEmail: form.clientEmail,
      clientAddress: form.clientAddress,
      clientGstin: form.clientGstin,
      supplierStateCode: supplierStateCode || null,
      supplierStateName: supplierState?.name ?? null,
      placeOfSupplyCode: form.placeOfSupplyCode || null,
      placeOfSupplyName: place?.name ?? null,
      isInterState: totals.isInterState,
      lineItems: form.lineItems,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxableAmount: totals.taxableAmount,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      totalTax: totals.totalTax,
      roundOff: totals.roundOff,
      totalAmount: totals.totalAmount,
      amountInWords: totals.amountInWords,
      amountPaid: 0,
      balanceDue: totals.totalAmount,
      notes: form.notes,
      termsAndConditions: form.terms.map((t) => t.text).filter(Boolean),
      bankName: form.bankName,
      bankAccountName: form.bankAccountName,
      bankAccountNumber: form.bankAccountNumber,
      bankIfsc: form.bankIfsc,
      upiId: form.upiId,
      status: 'DRAFT',
      userId: user?.id ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      companyName: user?.companyName ?? null,
      companyLogoUrl: null,
      companyPhone: user?.companyPhone ?? null,
      companyAddress: user?.companyAddress ?? null,
      companyWebsite: user?.companyWebsite ?? null,
      companyGstin: user?.companyGstin ?? null,
    }
  }, [form, totals, supplierStateCode, supplierState, user])

  // ── Save ─────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!form.invoiceNumber.trim()) return 'Invoice number is required.'
    if (!form.clientName.trim()) return 'Client name is required.'
    if (form.lineItems.length === 0) return 'Add at least one line item.'
    if (form.lineItems.some((i) => !i.description.trim())) return 'Every line item needs a description.'
    return null
  }

  const handleSave = async (status: 'DRAFT' | 'SENT') => {
    const error = validate()
    if (error) {
      toast({ title: 'Cannot save', description: error, variant: 'destructive' })
      return
    }

    const place = stateByCode(form.placeOfSupplyCode)
    const payload: CreateInvoiceData = {
      invoiceNumber: form.invoiceNumber.trim(),
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate,
      clientId: form.clientId || null,
      clientName: form.clientName.trim(),
      clientPhone: form.clientPhone || null,
      clientEmail: form.clientEmail || null,
      clientAddress: form.clientAddress || null,
      clientGstin: form.clientGstin || null,
      supplierStateCode: supplierStateCode || null,
      supplierStateName: supplierState?.name ?? null,
      placeOfSupplyCode: form.placeOfSupplyCode || null,
      placeOfSupplyName: place?.name ?? null,
      lineItems: form.lineItems.map((i) => ({
        ...i,
        quantity: Number(i.quantity) || 0,
        rate: Number(i.rate) || 0,
        discountPercent: Number(i.discountPercent) || 0,
        taxRate: Number(i.taxRate) || 0,
      })),
      notes: form.notes || null,
      termsAndConditions: form.terms.map((t) => t.text.trim()).filter(Boolean),
      bankName: form.bankName || null,
      bankAccountName: form.bankAccountName || null,
      bankAccountNumber: form.bankAccountNumber || null,
      bankIfsc: form.bankIfsc || null,
      upiId: form.upiId || null,
      status,
    }

    setSaving(true)
    try {
      const saved = editId
        ? await invoicesApi.updateInvoice(editId, payload)
        : await invoicesApi.createInvoice(payload)
      toast({ title: editId ? 'Invoice updated' : 'Invoice created' })
      navigate(`/invoices/${saved.id}`)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast({ title: 'Error', description: message ?? 'Failed to save the invoice.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const gstinMissing = !user?.companyGstin

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-10">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <button onClick={() => navigate('/invoices')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <h2 className="text-lg font-semibold">{editId ? 'Edit Invoice' : 'New Invoice'}</h2>
          <p className="text-sm text-muted-foreground">GST tax invoice with line items, HSN/SAC codes and PDF export</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <PDFDownloadLink document={<InvoicePDF invoice={previewInvoice} />} fileName={`Invoice-${form.invoiceNumber || 'draft'}.pdf`}>
            {({ loading }) => (
              <Button variant="outline" size="sm" disabled={loading}>
                <FileText className="h-4 w-4 mr-1" />
                {loading ? 'Preparing…' : 'Preview PDF'}
              </Button>
            )}
          </PDFDownloadLink>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => handleSave('DRAFT')}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save Draft
          </Button>
          <Button size="sm" disabled={saving} onClick={() => handleSave('SENT')}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Save &amp; Issue
          </Button>
        </div>
      </div>

      {gstinMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200">
          No GSTIN set on your company profile, so the supplier state cannot be determined and tax will be
          calculated as intra-state (CGST + SGST).{' '}
          <button className="underline font-medium" onClick={() => navigate('/profile')}>Add your GSTIN</button>
        </div>
      )}

      {/* ── Invoice meta ── */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Invoice Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Invoice Number *</Label>
            <Input value={form.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} placeholder="INV/25-26/001" />
          </div>
          <div className="space-y-1.5">
            <Label>Invoice Date *</Label>
            <Input type="date" value={form.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due Date *</Label>
            <Input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* ── Bill to ── */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Bill To</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Use a saved client</Label>
            <Select value={form.clientId || 'none'} onValueChange={handleSelectClient}>
              <SelectTrigger><SelectValue placeholder="Select a client (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">One-off buyer (not saved)</SelectItem>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Client Name *</Label>
            <Input value={form.clientName} onChange={(e) => set('clientName', e.target.value)} placeholder="Client or company name" />
          </div>
          <div className="space-y-1.5">
            <Label>Client GSTIN</Label>
            <Input
              value={form.clientGstin}
              onChange={(e) => {
                const gstin = e.target.value.toUpperCase()
                // A GSTIN carries its state code, so it can fill the place of supply.
                const code = stateCodeFromGstin(gstin)
                setForm((f) => ({ ...f, clientGstin: gstin, ...(code ? { placeOfSupplyCode: code } : {}) }))
              }}
              placeholder="24ABCDE1234F1Z5"
              maxLength={15}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Billing Address</Label>
            <Textarea rows={2} value={form.clientAddress} onChange={(e) => set('clientAddress', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Place of Supply *</Label>
            <Select value={form.placeOfSupplyCode || 'none'} onValueChange={(v) => set('placeOfSupplyCode', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">Not specified</SelectItem>
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tax Applied</Label>
            <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm">
              {totals.isInterState ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)'}
              {supplierState && <span className="text-muted-foreground ml-2 text-xs">from {supplierState.name}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Line items ── */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Line Items</CardTitle>
          <Button variant="outline" size="sm" onClick={addItem}>
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Column headings — desktop only; each row is self-labelled on mobile */}
          <div className="hidden lg:grid grid-cols-12 gap-2 px-1 text-xs font-medium text-muted-foreground">
            <div className="col-span-4">Description</div>
            <div className="col-span-1">HSN/SAC</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-1">Unit</div>
            <div className="col-span-2 text-right">Rate</div>
            <div className="col-span-1 text-right">Disc %</div>
            <div className="col-span-1 text-right">GST %</div>
            <div className="col-span-1 text-right">Amount</div>
          </div>

          {form.lineItems.map((item) => {
            const gross = (Number(item.quantity) || 0) * (Number(item.rate) || 0)
            const amount = gross - (gross * (Number(item.discountPercent) || 0)) / 100
            return (
              <div key={item.id} className="grid grid-cols-2 lg:grid-cols-12 gap-2 items-start rounded-lg border border-border p-3 lg:border-0 lg:p-0">
                <div className="col-span-2 lg:col-span-4 space-y-1">
                  <Label className="lg:hidden text-xs">Description</Label>
                  <Input
                    value={item.description}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    placeholder="Service or item description"
                  />
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">HSN/SAC</Label>
                  <Input value={item.hsnSac ?? ''} onChange={(e) => updateItem(item.id, { hsnSac: e.target.value })} placeholder="9983" />
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">Qty</Label>
                  <Input
                    type="number" min={0} step="any" className="text-right"
                    value={item.quantity}
                    onChange={(e) => updateItem(item.id, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">Unit</Label>
                  <Select value={item.unit || 'Nos'} onValueChange={(v) => updateItem(item.id, { unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="lg:col-span-2 space-y-1">
                  <Label className="lg:hidden text-xs">Rate</Label>
                  <Input
                    type="number" min={0} step="any" className="text-right"
                    value={item.rate}
                    onChange={(e) => updateItem(item.id, { rate: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">Disc %</Label>
                  <Input
                    type="number" min={0} max={100} step="any" className="text-right"
                    value={item.discountPercent}
                    onChange={(e) => updateItem(item.id, { discountPercent: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
                <div className="lg:col-span-1 space-y-1">
                  <Label className="lg:hidden text-xs">GST %</Label>
                  <Select value={String(item.taxRate ?? 0)} onValueChange={(v) => updateItem(item.id, { taxRate: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="lg:col-span-1 flex items-center justify-between lg:justify-end gap-2 pt-1 lg:pt-2">
                  <span className="text-sm font-medium tabular-nums">{amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  <Button
                    variant="ghost" size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0 shrink-0"
                    onClick={() => removeItem(item.id)}
                    disabled={form.lineItems.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* ── Totals ── */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex-1 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">AMOUNT IN WORDS</p>
              <p className="text-sm font-medium">{totals.amountInWords}</p>
            </div>
            <div className="w-full sm:w-72 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(totals.subtotal)}</span></div>
              {totals.discountTotal > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">- {formatCurrency(totals.discountTotal)}</span></div>
              )}
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
                <div className="flex justify-between"><span className="text-muted-foreground">Round Off</span><span className="tabular-nums">{totals.roundOff > 0 ? '+' : ''}{formatCurrency(totals.roundOff)}</span></div>
              )}
              <div className="flex justify-between border-t border-border pt-2 mt-2 text-base font-semibold">
                <span>Total</span><span className="tabular-nums">{formatCurrency(totals.totalAmount)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Payment details, notes, terms ── */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Payment Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Account Name</Label>
            <Input value={form.bankAccountName} onChange={(e) => set('bankAccountName', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bank Name</Label>
            <Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Account Number</Label>
            <Input value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>IFSC</Label>
            <Input value={form.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>UPI ID</Label>
            <Input value={form.upiId} onChange={(e) => set('upiId', e.target.value)} placeholder="name@bank" />
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
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything the client should see on the invoice" />
          </div>
          <div className="space-y-2">
            <Label>Terms &amp; Conditions</Label>
            {form.terms.map((t) => (
              <div key={t.id} className="flex gap-2">
                <Input
                  value={t.text}
                  onChange={(e) => set('terms', form.terms.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))}
                />
                <Button
                  variant="ghost" size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => set('terms', form.terms.filter((x) => x.id !== t.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
