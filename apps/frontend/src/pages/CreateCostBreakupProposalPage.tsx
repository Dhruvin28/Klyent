import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, ChevronLeft, ChevronRight, Check, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { CostBreakupProposalPDF } from '@/components/proposals/CostBreakupProposalPDF'
import { proposalsApi } from '@/api/proposals'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/toast'
import { numberToWords } from '@/lib/numberToWords'
import { useLogoDataUrl } from '@/hooks/useLogoDataUrl'
import { cn } from '@/lib/utils'
import type { Proposal, MaterialSection, CostBreakupItem } from '@/types'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface MaterialItemForm { id: string; srNo: number; description: string; rate: string }
interface MaterialSectionForm { id: string; title: string; rateLabel: string; items: MaterialItemForm[] }
interface CostBreakupItemForm { id: string; item: string; description: string; amount: number }
interface TermItem { id: string; text: string }

interface FormData {
  clientName: string
  clientPhone: string
  clientEmail: string
  clientAddress: string
  siteName: string
  projectLocation: string
  projectType: string
  projectScope: string
  serviceType: string
  proposalNumber: string
  date: string
  validTill: string
  aboutCompany: string
  materialSections: MaterialSectionForm[]
  costBreakupItems: CostBreakupItemForm[]
  feesNote: string
  termsAndConditions: TermItem[]
}

const PROJECT_TYPES = ['Residential', 'Commercial', 'Office', 'Retail', 'Industrial', 'Hospitality', 'Other']

function uid() { return Math.random().toString(36).slice(2) }

function today(): string { return new Date().toISOString().slice(0, 10) }
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function generateProposalNumber(companyName: string | null | undefined): string {
  const prefix = (companyName ?? 'EST').slice(0, 3).toUpperCase().replace(/\s/g, '')
  const now = new Date()
  const ym = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const seq = String(Math.floor(Math.random() * 90) + 10)
  return `${prefix}/${ym}/${seq}`
}

// ── Default values, pre-filled from the Riviera Prestige sample proposal ──
const DEFAULT_MATERIAL_SECTIONS: Omit<MaterialSectionForm, 'id'>[] = [
  {
    title: 'Material Details', rateLabel: 'Rate',
    items: [
      { id: uid(), srNo: 1, description: 'POP ceiling - Gypsum board ceiling using with Khushbu Section with appropriate channel in all the places as per final design', rate: '' },
      { id: uid(), srNo: 2, description: 'Electrical items - Ceiling lights (Roto LED COB Lights) 18W', rate: '550 per piece' },
      { id: uid(), srNo: 3, description: 'Electrical items - Ceiling Fans (Atomberg Fan)', rate: '4000 - 4500' },
      { id: uid(), srNo: 4, description: 'Furniture items - 18MM ply (Heer Silver ply) full core plywood 100% gurjan face [ISI Marked]', rate: '75 - 80 per sqft' },
      { id: uid(), srNo: 5, description: 'Furniture items - 19MM block board for wardrobe shutter (Heer Silver ply) [ISI Marked]', rate: '90 per sqft' },
      { id: uid(), srNo: 6, description: 'Furniture items - Inner laminate 0.8MM thick (Durian or Advance)', rate: '550 - 600 per sheet' },
      { id: uid(), srNo: 7, description: 'Furniture items - Veneer [ISI Marked]', rate: '90 - 100 per sqft' },
      { id: uid(), srNo: 8, description: 'Furniture items - Outer Laminate 1MM thick', rate: '1500 - 2000 per sheet' },
      { id: uid(), srNo: 9, description: 'Furniture items - HDHMR sheet 4MM (Heer Silver ply) [ISI Marked]', rate: '1200 per sqft' },
      { id: uid(), srNo: 10, description: 'Hardware items - All door handle with locks', rate: '2000-2500 per piece' },
      { id: uid(), srNo: 11, description: 'Hardware items - Kitchen tandem (Blandox)', rate: '2500-3000 per piece' },
      { id: uid(), srNo: 12, description: 'Hardware items - Kitchen Profile Handle - aluminium with powder coating', rate: '15 per inch' },
      { id: uid(), srNo: 13, description: 'Hardware items - Small shutter hinges upto 30 inch height shutter', rate: '250 - 300 per piece' },
      { id: uid(), srNo: 14, description: 'Hardware items - Wardrobe drawer lock (Europa)', rate: '300 - 400 per piece' },
      { id: uid(), srNo: 15, description: 'Hardware items - Wardrobe lock (Godrej)', rate: '700 - 800 per piece' },
      { id: uid(), srNo: 16, description: 'Hardware items - Bed fitting hydraulic (Ebco)', rate: '150 per kg' },
      { id: uid(), srNo: 17, description: 'Hardware items - Wardrobe hinges', rate: '250 - 350 per pair' },
      { id: uid(), srNo: 18, description: 'Kitchen Acrylic', rate: '4500 - 6000 per sheet' },
    ],
  },
  {
    title: 'Kitchen Items', rateLabel: 'Rate / Sq.Ft',
    items: [
      { id: uid(), srNo: 1, description: 'Framing with profile handles', rate: '' },
      { id: uid(), srNo: 2, description: 'Over head unit, crockery unit with profile handle with depth 13"', rate: '' },
      { id: uid(), srNo: 3, description: 'Service table (depth 13")', rate: '' },
      { id: uid(), srNo: 4, description: 'Service table overhead (depth 12")', rate: '' },
      { id: uid(), srNo: 5, description: 'Profile glass shutter above platform (depth 12")', rate: '' },
    ],
  },
  {
    title: 'Master Bedroom', rateLabel: 'Rate / Sq.Ft',
    items: [
      { id: uid(), srNo: 1, description: "Double Bed (6\" x 6.5') & bedback wall paneling in Veneer or PU polish", rate: '' },
      { id: uid(), srNo: 2, description: 'Side Table (2 Nos.)', rate: '' },
      { id: uid(), srNo: 3, description: 'Openable shutter wardrobe with lofts in Laminate', rate: '' },
      { id: uid(), srNo: 4, description: 'Study table OR TV unit', rate: '' },
      { id: uid(), srNo: 5, description: 'Dressing Table with Mirror', rate: '' },
      { id: uid(), srNo: 6, description: 'A.C. Panelling (MDF with wall paint)', rate: '' },
    ],
  },
  {
    title: 'Parents Bedroom', rateLabel: 'Rate / Sq.Ft',
    items: [
      { id: uid(), srNo: 1, description: "Double Bed (6\" x 6.5') & bedback wall paneling till 4'6\"", rate: '' },
      { id: uid(), srNo: 2, description: 'Side Table (2 Nos.)', rate: '' },
      { id: uid(), srNo: 3, description: 'Openable shutter wardrobe with lofts in laminate', rate: '' },
      { id: uid(), srNo: 4, description: 'Study table OR TV unit', rate: '' },
      { id: uid(), srNo: 5, description: 'Dressing Table with Mirror', rate: '' },
      { id: uid(), srNo: 6, description: 'A.C. Panelling (MDF with wall paint)', rate: '' },
    ],
  },
  {
    title: 'Children Bedroom', rateLabel: 'Rate / Sq.Ft',
    items: [
      { id: uid(), srNo: 1, description: 'Double Bed (6" x 6.5\') & bedback wall paneling in PU polish', rate: '' },
      { id: uid(), srNo: 2, description: 'Side Table (2 Nos.)', rate: '' },
      { id: uid(), srNo: 3, description: 'Openable shutter wardrobe with lofts in laminate', rate: '' },
      { id: uid(), srNo: 4, description: 'Study table in laminate', rate: '' },
      { id: uid(), srNo: 5, description: 'Dressing Table with Mirror', rate: '' },
      { id: uid(), srNo: 6, description: 'A.C. Panelling (MDF with wall paint)', rate: '' },
    ],
  },
  {
    title: 'Guest Bedroom', rateLabel: 'Rate / Sq.Ft',
    items: [
      { id: uid(), srNo: 1, description: 'Double Bed (6" x 6.5\') & bedback in POP punning', rate: '' },
      { id: uid(), srNo: 2, description: 'Side Table (2 Nos.)', rate: '' },
      { id: uid(), srNo: 3, description: 'Openable shutter wardrobe with lofts in laminate', rate: '' },
      { id: uid(), srNo: 4, description: 'Dressing Table with Mirror', rate: '' },
      { id: uid(), srNo: 5, description: 'A.C. Panelling (MDF with wall paint)', rate: '' },
    ],
  },
  {
    title: 'Living Room', rateLabel: 'Rate / Sq.Ft',
    items: [
      { id: uid(), srNo: 1, description: 'TV unit design in veneer', rate: '' },
      { id: uid(), srNo: 2, description: 'Main door design in veneer', rate: '' },
      { id: uid(), srNo: 3, description: 'Safety door design in veneer', rate: '' },
      { id: uid(), srNo: 4, description: 'Door paneling in veneer (with name plate design)', rate: '' },
      { id: uid(), srNo: 5, description: 'Dining table base in wood', rate: '' },
      { id: uid(), srNo: 6, description: 'Shoe rack in laminate', rate: '' },
    ],
  },
  {
    title: 'Ready Product', rateLabel: 'Rate',
    items: [
      { id: uid(), srNo: 1, description: 'Sofa (Estimated Rs.30,000 to Rs.1,50,000)', rate: 'Rs.75,000' },
      { id: uid(), srNo: 2, description: 'Center Table (Estimated Rs.3,500 to Rs.40,000)', rate: 'Rs.20,000' },
      { id: uid(), srNo: 3, description: '4 Dining Chair', rate: 'Rs.25,000' },
      { id: uid(), srNo: 4, description: '2 Corner tables', rate: 'Rs.15,000' },
      { id: uid(), srNo: 5, description: 'Washroom Exhaust Fan', rate: 'Included' },
      { id: uid(), srNo: 6, description: 'Dining Table Top', rate: 'Included' },
    ],
  },
]

const DEFAULT_COST_BREAKUP: Omit<CostBreakupItemForm, 'id'>[] = [
  { item: 'POP', description: 'P.O.P Ceiling - Gypsum ceiling using Khushbu section with appropriate channels & all area wall punning as per 2D groove.', amount: 150000 },
  { item: 'Furniture Materials', description: 'All types of raw materials like plywood, MDF, HDMR, laminate, veneer, ready-made MDF panels including branded hardware items. All kitchen drawers are in Tandem, all channels are soft-close and branded. Inner laminate will be 0.8MM Durian fabric finish.', amount: 1700000 },
  { item: 'Colour Work', description: 'Using Royal Asian Paint colours including polish work as per 2D details.', amount: 300000 },
  { item: 'Fabric & Leather', description: 'Bed headboard & bed covering fabric/leather as per design.', amount: 60000 },
  { item: 'Mirror & Glass', description: 'Normal mirror, 5mm PU glass & profile shutter as per 2D plan.', amount: 60000 },
  { item: 'Furniture Accessories', description: 'Sofa, center table, corner table & dining chairs (4 Nos.).', amount: 165000 },
  { item: 'Electrical', description: 'Electrical work including RR wires and Legrand switches. Lights and fans are excluded.', amount: 250000 },
  { item: 'Interior Fee', description: 'Interior design and professional consultancy fee.', amount: 150000 },
]

function defaultMaterialSections(): MaterialSectionForm[] {
  return DEFAULT_MATERIAL_SECTIONS.map((s) => ({ ...s, id: uid(), items: s.items.map((i) => ({ ...i, id: uid() })) }))
}
function defaultCostBreakup(): CostBreakupItemForm[] {
  return DEFAULT_COST_BREAKUP.map((c) => ({ ...c, id: uid() }))
}

function proposalToForm(p: Proposal): FormData {
  const sections: MaterialSectionForm[] = (p.materialSections && p.materialSections.length > 0)
    ? p.materialSections.map((s: MaterialSection) => ({
      id: uid(), title: s.title, rateLabel: s.rateLabel || 'Rate',
      items: s.items.map((it) => ({ id: uid(), srNo: it.srNo, description: it.description, rate: it.rate ?? '' })),
    }))
    : defaultMaterialSections()
  const items: CostBreakupItemForm[] = (p.costBreakupItems && p.costBreakupItems.length > 0)
    ? p.costBreakupItems.map((c: CostBreakupItem) => ({ id: uid(), item: c.item, description: c.description, amount: c.amount }))
    : defaultCostBreakup()

  return {
    clientName: p.clientName ?? '',
    clientPhone: p.clientPhone ?? '',
    clientEmail: p.clientEmail ?? '',
    clientAddress: p.clientAddress ?? '',
    siteName: p.siteName ?? '',
    projectLocation: p.projectLocation ?? '',
    projectType: p.projectType ?? '',
    projectScope: p.projectScope ?? '',
    serviceType: p.serviceType ?? 'Interior Design & Turnkey Solutions',
    proposalNumber: p.proposalNumber ?? '',
    date: p.date ?? today(),
    validTill: p.validTill ?? addDays(today(), 30),
    aboutCompany: p.aboutCompany ?? '',
    materialSections: sections,
    costBreakupItems: items,
    feesNote: p.feesNote ?? 'All prices are estimates subject to final measurement & design confirmation.',
    termsAndConditions: (p.termsAndConditions ?? []).map((text) => ({ id: uid(), text })),
  }
}

// ──────────────────────────────────────────────
// Step indicator
// ──────────────────────────────────────────────
const STEPS = ['Client & Project', 'Estimate Setup', 'Material Details', 'Cost Breakup', 'Review']

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((label, i) => {
        const step = i + 1
        const done = step < current
        const active = step === current
        return (
          <div key={step} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center">
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                done ? 'bg-primary text-primary-foreground'
                  : active ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                    : 'bg-muted text-muted-foreground'
              )}>
                {done ? <Check className="h-4 w-4" /> : step}
              </div>
              <span className={cn(
                'text-xs mt-1 whitespace-nowrap hidden sm:block',
                active ? 'text-primary font-medium' : 'text-muted-foreground'
              )}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('flex-1 h-0.5 mx-2', done ? 'bg-primary' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────
// Material sections editor
// ──────────────────────────────────────────────
function MaterialSectionsEditor({ sections, onChange }: {
  sections: MaterialSectionForm[]
  onChange: (v: MaterialSectionForm[]) => void
}) {
  const addSection = () => {
    onChange([...sections, { id: uid(), title: 'New Section', rateLabel: 'Rate', items: [{ id: uid(), srNo: 1, description: '', rate: '' }] }])
  }
  const removeSection = (id: string) => onChange(sections.filter((s) => s.id !== id))
  const updateSection = (id: string, patch: Partial<MaterialSectionForm>) =>
    onChange(sections.map((s) => s.id === id ? { ...s, ...patch } : s))

  const addItem = (sectionId: string) => {
    onChange(sections.map((s) => s.id === sectionId
      ? { ...s, items: [...s.items, { id: uid(), srNo: s.items.length + 1, description: '', rate: '' }] }
      : s))
  }
  const removeItem = (sectionId: string, itemId: string) => {
    onChange(sections.map((s) => s.id === sectionId
      ? { ...s, items: s.items.filter((i) => i.id !== itemId).map((i, idx) => ({ ...i, srNo: idx + 1 })) }
      : s))
  }
  const updateItem = (sectionId: string, itemId: string, field: 'description' | 'rate', value: string) => {
    onChange(sections.map((s) => s.id === sectionId
      ? { ...s, items: s.items.map((i) => i.id === itemId ? { ...i, [field]: value } : i) }
      : s))
  }

  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <Card key={section.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                value={section.title}
                onChange={(e) => updateSection(section.id, { title: e.target.value })}
                placeholder="Section title (e.g. Living Room)"
                className="font-medium"
              />
              <Input
                value={section.rateLabel}
                onChange={(e) => updateSection(section.id, { rateLabel: e.target.value })}
                placeholder="Rate column label (e.g. Rate / Sq.Ft)"
              />
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeSection(section.id)} className="shrink-0 text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {section.items.map((item) => (
              <div key={item.id} className="flex gap-2 items-start">
                <span className="mt-2.5 text-xs text-muted-foreground w-5 shrink-0">{item.srNo}.</span>
                <Input
                  value={item.description}
                  onChange={(e) => updateItem(section.id, item.id, 'description', e.target.value)}
                  placeholder="Product description"
                  className="flex-1"
                />
                <Input
                  value={item.rate}
                  onChange={(e) => updateItem(section.id, item.id, 'rate', e.target.value)}
                  placeholder="Rate"
                  className="w-40"
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(section.id, item.id)} className="shrink-0 text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => addItem(section.id)}>
              <Plus className="h-3 w-3 mr-1" /> Add Item
            </Button>
          </CardContent>
        </Card>
      ))}
      <Button type="button" variant="outline" onClick={addSection} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> Add Section
      </Button>
    </div>
  )
}

// ──────────────────────────────────────────────
// Cost breakup editor
// ──────────────────────────────────────────────
function CostBreakupEditor({ items, onChange }: {
  items: CostBreakupItemForm[]
  onChange: (v: CostBreakupItemForm[]) => void
}) {
  const add = () => onChange([...items, { id: uid(), item: '', description: '', amount: 0 }])
  const remove = (id: string) => onChange(items.filter((i) => i.id !== id))
  const update = (id: string, field: keyof CostBreakupItemForm, value: string | number) =>
    onChange(items.map((i) => i.id === id ? { ...i, [field]: value } : i))

  const total = items.reduce((a, i) => a + (Number(i.amount) || 0), 0)

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.id} className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_140px_auto] gap-2 items-start border border-border rounded-lg p-3">
          <div className="space-y-1">
            <Label className="text-xs">Item</Label>
            <Input value={it.item} onChange={(e) => update(it.id, 'item', e.target.value)} placeholder="e.g. POP" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={it.description}
              onChange={(e) => update(it.id, 'description', e.target.value)}
              placeholder="What this covers..."
              className="min-h-[38px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Amount (Rs.)</Label>
            <Input
              type="number" min="0"
              value={it.amount || ''}
              onChange={(e) => update(it.id, 'amount', Number(e.target.value))}
              placeholder="0"
            />
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(it.id)} className="mt-6 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-3 w-3 mr-1" /> Add Line Item
      </Button>
      <div className="flex justify-end pt-2 border-t border-border">
        <p className="text-sm font-semibold">Total: Rs. {total.toLocaleString('en-IN')}</p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────
export function CreateCostBreakupProposalPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [savedProposal, setSavedProposal] = useState<Proposal | null>(null)
  const logoDataUrl = useLogoDataUrl()

  const copyFrom = searchParams.get('copyFrom')
  const versionOf = searchParams.get('versionOf')
  const sourceId = versionOf ?? copyFrom
  const mode: 'create' | 'copy' | 'version' = versionOf ? 'version' : copyFrom ? 'copy' : 'create'

  const { data: sourceProposal, isLoading: loadingSource } = useQuery({
    queryKey: ['proposal', sourceId],
    queryFn: () => proposalsApi.getProposal(sourceId!),
    enabled: !!sourceId,
  })

  const [form, setForm] = useState<FormData>(() => {
    const d = today()
    return {
      clientName: '',
      clientPhone: '',
      clientEmail: '',
      clientAddress: '',
      siteName: '',
      projectLocation: '',
      projectType: 'Residential',
      projectScope: 'Full Interior Design & Turnkey Solutions',
      serviceType: 'Interior Design & Turnkey Solutions',
      proposalNumber: generateProposalNumber(user?.companyName),
      date: d,
      validTill: addDays(d, 30),
      aboutCompany: '',
      materialSections: defaultMaterialSections(),
      costBreakupItems: defaultCostBreakup(),
      feesNote: 'All prices are estimates subject to final measurement & design confirmation.',
      termsAndConditions: [],
    }
  })

  const set = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const prefilledRef = useRef(false)
  useEffect(() => {
    if (!sourceProposal || prefilledRef.current) return
    prefilledRef.current = true
    const base = proposalToForm(sourceProposal)
    if (mode === 'copy') {
      const d = today()
      setForm({ ...base, proposalNumber: generateProposalNumber(user?.companyName), date: d, validTill: addDays(d, 30) })
    } else {
      setForm(base)
    }
  }, [sourceProposal, mode, user?.companyName])

  const total = form.costBreakupItems.reduce((a, i) => a + (Number(i.amount) || 0), 0)

  const validateStep = (): string | null => {
    if (step === 1 && !form.clientName.trim()) return 'Client name is required.'
    if (step === 2) {
      if (!form.proposalNumber.trim()) return 'Estimate number is required.'
      if (!form.date) return 'Date is required.'
      if (!form.validTill) return 'Valid till date is required.'
    }
    if (step === 4 && total <= 0) return 'Add at least one cost breakup line item with an amount.'
    return null
  }

  const next = () => {
    const err = validateStep()
    if (err) { toast({ title: 'Validation', description: err, variant: 'destructive' }); return }
    setStep((s) => Math.min(s + 1, 5))
  }
  const back = () => setStep((s) => Math.max(s - 1, 1))

  const buildPayload = () => ({
    proposalType: 'COST_BREAKUP' as const,
    proposalNumber: form.proposalNumber,
    serviceType: form.serviceType,
    date: form.date,
    validTill: form.validTill,
    clientName: form.clientName,
    clientPhone: form.clientPhone || null,
    clientEmail: form.clientEmail || null,
    clientAddress: form.clientAddress || null,
    siteName: form.siteName || null,
    projectLocation: form.projectLocation || null,
    projectType: form.projectType || null,
    projectScope: form.projectScope || null,
    aboutCompany: form.aboutCompany || null,
    materialSections: form.materialSections.map(({ id: _id, title, rateLabel, items }) => ({
      id: _id, title, rateLabel,
      items: items.filter((i) => i.description.trim()).map(({ srNo, description, rate }) => ({ srNo, description, rate })),
    })).filter((s) => s.items.length > 0),
    costBreakupItems: form.costBreakupItems
      .filter((i) => i.item.trim())
      .map(({ item, description, amount }) => ({ item, description, amount })),
    feesDescription: 'Total Project Cost',
    feesAmount: total,
    feesAmountInWords: total > 0 ? numberToWords(total) : null,
    feesNote: form.feesNote || null,
    termsAndConditions: form.termsAndConditions.map((t) => t.text).filter(Boolean),
    status: 'DRAFT' as const,
  })

  const handleSave = async (asDraft = true) => {
    const err = asDraft ? null : validateStep()
    if (err) { toast({ title: 'Validation', description: err, variant: 'destructive' }); return }
    setSaving(true)
    try {
      const payload = { ...buildPayload(), status: asDraft ? 'DRAFT' as const : 'SENT' as const }
      const created = mode === 'version'
        ? await proposalsApi.createVersion(versionOf!, payload)
        : await proposalsApi.createProposal(payload)
      setSavedProposal(created)
      toast({
        title: mode === 'version' ? 'New version saved!' : 'Estimate saved!',
        description: mode === 'version'
          ? `Version ${created.version} of ${created.proposalNumber} created.`
          : `Estimate ${created.proposalNumber} created.`,
      })
    } catch {
      toast({ title: 'Error', description: 'Failed to save estimate.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const previewProposal: Proposal = {
    id: savedProposal?.id ?? 'preview',
    ...buildPayload(),
    status: 'DRAFT',
    version: savedProposal?.version ?? (mode === 'version' && sourceProposal ? sourceProposal.version + 1 : 1),
    userId: user?.id ?? '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    companyName: user?.companyName ?? '',
    companyLogoUrl: logoDataUrl,
    companyPhone: user?.companyPhone ?? null,
    companyAddress: user?.companyAddress ?? null,
    companyWebsite: user?.companyWebsite ?? null,
  }

  const pageTitle = mode === 'copy' ? 'Copy Cost Breakup Estimate' : mode === 'version' ? 'New Estimate Version' : 'Create Cost Breakup Estimate'
  const pageSubtitle = mode === 'copy'
    ? 'Pre-filled from an existing estimate. Change anything you like, then generate a new one.'
    : mode === 'version'
      ? `Editing creates a new version for the same client${sourceProposal ? ` (current v${sourceProposal.version})` : ''}. The original is kept.`
      : 'A detailed, itemized material & cost breakup estimate — pre-filled with sample values you can edit.'

  if (sourceId && loadingSource) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center text-sm text-muted-foreground">
        Loading estimate…
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <button onClick={() => navigate('/proposals')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
          <ChevronLeft className="h-4 w-4" /> Back to Proposals
        </button>
        <h2 className="text-xl font-semibold">{pageTitle}</h2>
        <p className="text-sm text-muted-foreground">{pageSubtitle}</p>
      </div>

      <StepIndicator current={step} />

      {/* ── Step 1: Client & Project ── */}
      {step === 1 && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Client Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Client Name <span className="text-destructive">*</span></Label>
                <Input value={form.clientName} onChange={(e) => set('clientName', e.target.value)} placeholder="Mr. John Doe" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} placeholder="+91 98765 43210" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} placeholder="client@email.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input value={form.clientAddress} onChange={(e) => set('clientAddress', e.target.value)} placeholder="City, State" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Project Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Project Title</Label>
                <Input value={form.siteName} onChange={(e) => set('siteName', e.target.value)} placeholder="e.g. Riviera Prestige" />
                <p className="text-xs text-muted-foreground">Shown as the large project banner on the estimate.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={form.projectLocation} onChange={(e) => set('projectLocation', e.target.value)} placeholder="Ahmedabad" />
              </div>
              <div className="space-y-1.5">
                <Label>Project Type</Label>
                <Select value={form.projectType} onValueChange={(v) => set('projectType', v)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Scope / Nature</Label>
                <Input value={form.projectScope} onChange={(e) => set('projectScope', e.target.value)} placeholder="Full Interior Design Services" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 2: Estimate Setup ── */}
      {step === 2 && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Estimate Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Tagline / Service Type</Label>
                <Input value={form.serviceType} onChange={(e) => set('serviceType', e.target.value)} placeholder="Interior Design & Turnkey Solutions" />
              </div>
              <div className="space-y-1.5">
                <Label>Estimate Number <span className="text-destructive">*</span></Label>
                <Input value={form.proposalNumber} onChange={(e) => set('proposalNumber', e.target.value)} />
              </div>
              <div className="space-y-1.5" />
              <div className="space-y-1.5">
                <Label>Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Valid Till <span className="text-destructive">*</span></Label>
                <Input type="date" value={form.validTill} onChange={(e) => set('validTill', e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">About Your Company (optional)</CardTitle></CardHeader>
            <CardContent>
              <Textarea
                value={form.aboutCompany}
                onChange={(e) => set('aboutCompany', e.target.value)}
                placeholder="Write a brief description of your company and services..."
                className="min-h-[100px]"
                maxLength={2000}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 3: Material Details ── */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pre-filled with the standard material & product tables. Edit descriptions and rates, or add/remove sections and items to match this project.
          </p>
          <MaterialSectionsEditor sections={form.materialSections} onChange={(v) => set('materialSections', v)} />
        </div>
      )}

      {/* ── Step 4: Cost Breakup ── */}
      {step === 4 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost Breakup</CardTitle>
              <p className="text-sm text-muted-foreground">The final itemized cost summary shown at the end of the estimate.</p>
            </CardHeader>
            <CardContent>
              <CostBreakupEditor items={form.costBreakupItems} onChange={(v) => set('costBreakupItems', v)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Footer Note</CardTitle></CardHeader>
            <CardContent>
              <Input value={form.feesNote} onChange={(e) => set('feesNote', e.target.value)} placeholder="All prices are estimates subject to final measurement & design confirmation." />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 5: Review & Download ── */}
      {step === 5 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Estimate Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Estimate No.</span><p className="font-medium">{form.proposalNumber}</p></div>
                <div><span className="text-muted-foreground">Client</span><p className="font-medium">{form.clientName}</p></div>
                <div><span className="text-muted-foreground">Project</span><p className="font-medium">{form.siteName || '—'}</p></div>
                <div><span className="text-muted-foreground">Date</span><p className="font-medium">{form.date}</p></div>
                <div><span className="text-muted-foreground">Valid Till</span><p className="font-medium">{form.validTill}</p></div>
                <div><span className="text-muted-foreground">Total Cost</span><p className="font-medium">Rs. {total.toLocaleString('en-IN')}/-</p></div>
                <div><span className="text-muted-foreground">Material Sections</span><p className="font-medium">{form.materialSections.length}</p></div>
                <div><span className="text-muted-foreground">Cost Breakup Items</span><p className="font-medium">{form.costBreakupItems.length}</p></div>
              </div>

              {!user?.companyName && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-300">
                  Your company profile is incomplete. Go to <strong>Profile → Company</strong> to add your company name, logo, and contact details — they will appear on the estimate.
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                {savedProposal ? (
                  <>
                    <PDFDownloadLink
                      document={<CostBreakupProposalPDF proposal={{ ...previewProposal, id: savedProposal.id }} />}
                      fileName={`Estimate-${form.proposalNumber}.pdf`}
                      className="flex-1"
                    >
                      {({ loading }) => (
                        <Button className="w-full" disabled={loading}>
                          {loading ? 'Preparing PDF…' : 'Download PDF'}
                        </Button>
                      )}
                    </PDFDownloadLink>
                    <Button variant="outline" className="flex-1" onClick={() => navigate('/proposals')}>
                      View All Proposals
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => handleSave(false)} disabled={saving} className="flex-1">
                    {saving ? 'Saving…' : mode === 'version' ? 'Save New Version & Download' : 'Save & Download Estimate'}
                  </Button>
                )}
              </div>
              {!savedProposal && (
                <Button variant="ghost" size="sm" onClick={() => handleSave(true)} disabled={saving} className="w-full text-muted-foreground">
                  {saving ? 'Saving draft…' : 'Save as Draft only'}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={back} disabled={step === 1}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        {step < 5 && (
          <Button onClick={next}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  )
}
