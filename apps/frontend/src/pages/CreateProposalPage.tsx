import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, ChevronLeft, ChevronRight, Check, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { ProposalPDF } from '@/components/proposals/ProposalPDF'
import { proposalsApi } from '@/api/proposals'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/toast'
import { numberToWords } from '@/lib/numberToWords'
import { cn } from '@/lib/utils'
import type { Proposal } from '@/types'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface ScopeItem { id: string; text: string }
interface TermItem { id: string; text: string }
interface MilestoneItem { id: string; milestone: number; description: string; percentage: number; amount: number }

interface FormData {
  // Step 1 – Client & Project
  clientName: string
  clientPhone: string
  clientEmail: string
  clientAddress: string
  siteName: string
  projectLocation: string
  projectType: string
  projectScope: string
  // Step 2 – Proposal meta & About
  serviceType: string
  proposalNumber: string
  date: string
  validTill: string
  aboutCompany: string
  scopeOfWork: ScopeItem[]
  // Step 3 – Fees & Payment
  feesDescription: string
  feesAmount: string
  feesAmountInWords: string
  feesNote: string
  paymentMilestones: MilestoneItem[]
  // Step 4 – Terms
  termsAndConditions: TermItem[]
}

const DEFAULT_TERMS = [
  'The scope of work is limited to the services mentioned above.',
  'The above fee is valid for the proposed scope of work as discussed.',
  'Any additional work or changes beyond the scope will be chargeable separately.',
  'Payments are to be made as per the milestones mentioned above.',
  'This proposal is valid till the date mentioned above.',
]

const PROJECT_TYPES = ['Residential', 'Commercial', 'Office', 'Retail', 'Industrial', 'Hospitality', 'Other']

function uid() { return Math.random().toString(36).slice(2) }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function generateProposalNumber(companyName: string | null | undefined): string {
  const prefix = (companyName ?? 'PRO').slice(0, 3).toUpperCase().replace(/\s/g, '')
  const now = new Date()
  const ym = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const seq = String(Math.floor(Math.random() * 90) + 10)
  return `${prefix}/${ym}/${seq}`
}

// ──────────────────────────────────────────────
// Step indicator
// ──────────────────────────────────────────────
const STEPS = ['Client & Project', 'Proposal Setup', 'Fees & Payment', 'Terms', 'Review']

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
// Dynamic list editor helpers
// ──────────────────────────────────────────────
function ScopeEditor({ items, onChange }: { items: ScopeItem[]; onChange: (v: ScopeItem[]) => void }) {
  const add = () => onChange([...items, { id: uid(), text: '' }])
  const remove = (id: string) => onChange(items.filter((i) => i.id !== id))
  const update = (id: string, text: string) => onChange(items.map((i) => i.id === id ? { ...i, text } : i))

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={item.id} className="flex gap-2">
          <Input
            value={item.text}
            onChange={(e) => update(item.id, e.target.value)}
            placeholder={`Scope item ${idx + 1}`}
            className="flex-1"
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(item.id)} className="shrink-0 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-3 w-3 mr-1" /> Add Item
      </Button>
    </div>
  )
}

function TermsEditor({ items, onChange }: { items: TermItem[]; onChange: (v: TermItem[]) => void }) {
  const add = () => onChange([...items, { id: uid(), text: '' }])
  const remove = (id: string) => onChange(items.filter((i) => i.id !== id))
  const update = (id: string, text: string) => onChange(items.map((i) => i.id === id ? { ...i, text } : i))

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={item.id} className="flex gap-2 items-start">
          <span className="mt-2.5 text-sm text-muted-foreground font-medium w-5 shrink-0">{idx + 1}.</span>
          <Input
            value={item.text}
            onChange={(e) => update(item.id, e.target.value)}
            placeholder="Term or condition"
            className="flex-1"
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(item.id)} className="shrink-0 text-destructive hover:text-destructive mt-0.5">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-3 w-3 mr-1" /> Add Term
      </Button>
    </div>
  )
}

function MilestonesEditor({ items, totalFees, onChange }: {
  items: MilestoneItem[]
  totalFees: number
  onChange: (v: MilestoneItem[]) => void
}) {
  const add = () => {
    const next = items.length + 1
    onChange([...items, { id: uid(), milestone: next, description: '', percentage: 0, amount: 0 }])
  }
  const remove = (id: string) => {
    const updated = items.filter((i) => i.id !== id).map((m, idx) => ({ ...m, milestone: idx + 1 }))
    onChange(updated)
  }
  const update = (id: string, field: keyof MilestoneItem, value: string | number) => {
    onChange(items.map((m) => {
      if (m.id !== id) return m
      const updated = { ...m, [field]: value }
      if (field === 'percentage') {
        updated.amount = Math.round((totalFees * Number(value)) / 100)
      }
      if (field === 'amount') {
        updated.percentage = totalFees > 0 ? Math.round((Number(value) / totalFees) * 100) : 0
      }
      return updated
    }))
  }

  const totalPct = items.reduce((a, m) => a + m.percentage, 0)

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-muted">
              <th className="p-2 text-left w-10">#</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right w-24">Percent %</th>
              <th className="p-2 text-right w-36">Amount (Rs.)</th>
              <th className="p-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="p-2 text-muted-foreground">{m.milestone}</td>
                <td className="p-2">
                  <Input
                    value={m.description}
                    onChange={(e) => update(m.id, 'description', e.target.value)}
                    placeholder="e.g. Advance"
                    className="h-8"
                  />
                </td>
                <td className="p-2">
                  <Input
                    type="number" min="0" max="100"
                    value={m.percentage || ''}
                    onChange={(e) => update(m.id, 'percentage', Number(e.target.value))}
                    className="h-8 text-right"
                    placeholder="20"
                  />
                </td>
                <td className="p-2">
                  <Input
                    type="number" min="0"
                    value={m.amount || ''}
                    onChange={(e) => update(m.id, 'amount', Number(e.target.value))}
                    className="h-8 text-right"
                    placeholder="0"
                  />
                </td>
                <td className="p-2">
                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(m.id)} className="h-8 w-8 text-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {items.length > 0 && (
              <tr className="border-t border-border bg-muted font-medium">
                <td className="p-2" colSpan={2} />
                <td className="p-2 text-right">
                  <span className={cn(totalPct !== 100 && totalPct > 0 ? 'text-destructive' : '')}>
                    {totalPct}%
                  </span>
                </td>
                <td className="p-2 text-right">
                  Rs. {items.reduce((a, m) => a + m.amount, 0).toLocaleString('en-IN')}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPct > 0 && totalPct !== 100 && (
        <p className="text-xs text-destructive">Percentages should add up to 100% (currently {totalPct}%)</p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-3 w-3 mr-1" /> Add Milestone
      </Button>
    </div>
  )
}

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────
export function CreateProposalPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [savedProposal, setSavedProposal] = useState<Proposal | null>(null)

  const [form, setForm] = useState<FormData>(() => {
    const d = today()
    return {
      clientName: '',
      clientPhone: '',
      clientEmail: '',
      clientAddress: '',
      siteName: '',
      projectLocation: '',
      projectType: '',
      projectScope: '',
      serviceType: 'Professional Services',
      proposalNumber: generateProposalNumber(user?.companyName),
      date: d,
      validTill: addDays(d, 7),
      aboutCompany: '',
      scopeOfWork: [{ id: uid(), text: '' }],
      feesDescription: 'Service Fees (Lumpsum)',
      feesAmount: '',
      feesAmountInWords: '',
      feesNote: 'GST as applicable will be charged extra.',
      paymentMilestones: [],
      termsAndConditions: DEFAULT_TERMS.map((t) => ({ id: uid(), text: t })),
    }
  })

  const set = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Auto-calculate amount in words
  const handleFeesAmountChange = (val: string) => {
    set('feesAmount', val)
    const n = parseFloat(val)
    if (!isNaN(n) && n > 0) {
      set('feesAmountInWords', numberToWords(n))
    }
  }

  const validateStep = (): string | null => {
    if (step === 1 && !form.clientName.trim()) return 'Client name is required.'
    if (step === 2) {
      if (!form.serviceType.trim()) return 'Service type is required.'
      if (!form.proposalNumber.trim()) return 'Proposal number is required.'
      if (!form.date) return 'Date is required.'
      if (!form.validTill) return 'Valid till date is required.'
    }
    if (step === 3) {
      if (!form.feesDescription.trim()) return 'Fees description is required.'
      if (!form.feesAmount || parseFloat(form.feesAmount) <= 0) return 'A valid fee amount is required.'
    }
    return null
  }

  const next = () => {
    const err = validateStep()
    if (err) { toast({ title: 'Validation', description: err, variant: 'destructive' }); return }
    setStep((s) => Math.min(s + 1, 5))
  }
  const back = () => setStep((s) => Math.max(s - 1, 1))

  const buildPayload = () => ({
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
    scopeOfWork: form.scopeOfWork.map((s) => s.text).filter(Boolean),
    feesDescription: form.feesDescription,
    feesAmount: parseFloat(form.feesAmount) || 0,
    feesAmountInWords: form.feesAmountInWords || null,
    feesNote: form.feesNote || null,
    paymentMilestones: form.paymentMilestones.map(({ id: _id, ...m }) => m),
    termsAndConditions: form.termsAndConditions.map((t) => t.text).filter(Boolean),
    status: 'DRAFT' as const,
  })

  const handleSave = async (asDraft = true) => {
    const err = asDraft ? null : validateStep()
    if (err) { toast({ title: 'Validation', description: err, variant: 'destructive' }); return }
    setSaving(true)
    try {
      const payload = { ...buildPayload(), status: asDraft ? 'DRAFT' as const : 'SENT' as const }
      const created = await proposalsApi.createProposal(payload)
      setSavedProposal(created)
      toast({ title: 'Proposal saved!', description: `Proposal ${created.proposalNumber} created.` })
    } catch {
      toast({ title: 'Error', description: 'Failed to save proposal.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // Build a preview proposal for the PDF renderer
  const previewProposal: Proposal = {
    id: savedProposal?.id ?? 'preview',
    ...buildPayload(),
    status: 'DRAFT',
    userId: user?.id ?? '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    companyName: user?.companyName ?? '',
    companyLogoUrl: user?.companyLogoUrl ?? null,
    companyPhone: user?.companyPhone ?? null,
    companyAddress: user?.companyAddress ?? null,
    companyWebsite: user?.companyWebsite ?? null,
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <button onClick={() => navigate('/proposals')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
          <ChevronLeft className="h-4 w-4" /> Back to Proposals
        </button>
        <h2 className="text-xl font-semibold">Create Proposal</h2>
        <p className="text-sm text-muted-foreground">Fill in the details below to generate a professional proposal PDF.</p>
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
              <div className="space-y-1.5">
                <Label>Site / Project Name</Label>
                <Input value={form.siteName} onChange={(e) => set('siteName', e.target.value)} placeholder="The Grove" />
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
              <div className="space-y-1.5">
                <Label>Scope / Nature</Label>
                <Input value={form.projectScope} onChange={(e) => set('projectScope', e.target.value)} placeholder="Full Interior Design Services" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 2: Proposal Setup ── */}
      {step === 2 && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Proposal Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Service Type <span className="text-destructive">*</span></Label>
                <Input value={form.serviceType} onChange={(e) => set('serviceType', e.target.value)} placeholder="Interior Design Services" />
                <p className="text-xs text-muted-foreground">Appears as subtitle on the proposal (e.g. "Interior Design Services")</p>
              </div>
              <div className="space-y-1.5">
                <Label>Proposal Number <span className="text-destructive">*</span></Label>
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
            <CardHeader><CardTitle className="text-base">About Your Company</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={form.aboutCompany}
                onChange={(e) => set('aboutCompany', e.target.value)}
                placeholder="Write a brief description of your company and services..."
                className="min-h-[100px]"
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground">This appears in the "About" section of the proposal.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Scope of Work</CardTitle></CardHeader>
            <CardContent>
              <ScopeEditor items={form.scopeOfWork} onChange={(v) => set('scopeOfWork', v)} />
              <p className="text-xs text-muted-foreground mt-2">Add each service or deliverable as a separate item.</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 3: Fees & Payment ── */}
      {step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Fees</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Description <span className="text-destructive">*</span></Label>
                <Input value={form.feesDescription} onChange={(e) => set('feesDescription', e.target.value)} placeholder="Interior Design Fees (Lumpsum)" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Total Amount (Rs.) <span className="text-destructive">*</span></Label>
                  <Input
                    type="number" min="0"
                    value={form.feesAmount}
                    onChange={(e) => handleFeesAmountChange(e.target.value)}
                    placeholder="100000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Amount in Words</Label>
                  <Input
                    value={form.feesAmountInWords}
                    onChange={(e) => set('feesAmountInWords', e.target.value)}
                    placeholder="Auto-generated"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>GST / Note</Label>
                <Input value={form.feesNote} onChange={(e) => set('feesNote', e.target.value)} placeholder="GST as applicable will be charged extra." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment Structure</CardTitle>
              <p className="text-sm text-muted-foreground">Break the total fee into milestone payments.</p>
            </CardHeader>
            <CardContent>
              <MilestonesEditor
                items={form.paymentMilestones}
                totalFees={parseFloat(form.feesAmount) || 0}
                onChange={(v) => set('paymentMilestones', v)}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 4: Terms & Conditions ── */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Terms &amp; Conditions</CardTitle>
            <p className="text-sm text-muted-foreground">Edit the default terms or add your own.</p>
          </CardHeader>
          <CardContent>
            <TermsEditor items={form.termsAndConditions} onChange={(v) => set('termsAndConditions', v)} />
          </CardContent>
        </Card>
      )}

      {/* ── Step 5: Review & Download ── */}
      {step === 5 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Proposal Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Proposal No.</span><p className="font-medium">{form.proposalNumber}</p></div>
                <div><span className="text-muted-foreground">Client</span><p className="font-medium">{form.clientName}</p></div>
                <div><span className="text-muted-foreground">Service Type</span><p className="font-medium">{form.serviceType}</p></div>
                <div><span className="text-muted-foreground">Date</span><p className="font-medium">{form.date}</p></div>
                <div><span className="text-muted-foreground">Valid Till</span><p className="font-medium">{form.validTill}</p></div>
                <div><span className="text-muted-foreground">Total Fees</span><p className="font-medium">Rs. {parseFloat(form.feesAmount || '0').toLocaleString('en-IN')}/-</p></div>
                <div><span className="text-muted-foreground">Scope Items</span><p className="font-medium">{form.scopeOfWork.filter((s) => s.text).length}</p></div>
                <div><span className="text-muted-foreground">Milestones</span><p className="font-medium">{form.paymentMilestones.length}</p></div>
              </div>

              {!user?.companyName && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-300">
                  Your company profile is incomplete. Go to <strong>Profile → Company</strong> to add your company name, logo, and contact details — they will appear on the proposal.
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                {savedProposal ? (
                  <>
                    <PDFDownloadLink
                      document={<ProposalPDF proposal={{ ...previewProposal, id: savedProposal.id }} />}
                      fileName={`Proposal-${form.proposalNumber}.pdf`}
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
                    {saving ? 'Saving…' : 'Save & Download Proposal'}
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
