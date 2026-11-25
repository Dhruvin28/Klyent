import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Calculator, Download, FileText, Loader2, Settings2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { apiErrorMessage, visualizerApi } from '@/api/visualizer'
import { formatCurrency } from '@/lib/utils'
import { ESTIMATE_UNITS, type EstimateUnit, type MaterialEstimate, type VizMaterial, type VizOption } from '@/lib/visualizer/types'
import { SQFT_PER_SQM, UNIT_LABELS, effectiveEstimate, estimateOption, formatQuantity, type OptionEstimate, type SurfaceArea } from '@/lib/visualizer/estimate'
import { buildProposalPrefill } from '@/lib/visualizer/proposalPrefill'
import { MaterialSwatch, NumberField } from '../common'
import type { VizEditor } from './useVizEditor'

const sqft = (sqm: number) => (sqm * SQFT_PER_SQM).toLocaleString('en-IN', { maximumFractionDigits: 1 })

/** Surface areas for an option's assigned surfaces. */
export function optionAreas(editor: VizEditor, option: VizOption): SurfaceArea[] {
  return editor.state.surfaces
    .filter((s) => option.assignments[s.id])
    .map((s) => ({ surfaceId: s.id, surfaceName: s.name, materialId: option.assignments[s.id].materialId, areaSqm: editor.areas.get(s.id)?.areaSqm ?? 0 }))
}

export function useOptionEstimate(editor: VizEditor, option: VizOption | undefined): OptionEstimate | null {
  return useMemo(() => (option ? estimateOption(optionAreas(editor, option), editor.materials) : null), [editor.areas, editor.materials, editor.state.surfaces, option]) // eslint-disable-line react-hooks/exhaustive-deps
}

function downloadCsv(name: string, est: OptionEstimate) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const rows = [
    ['Material', 'Brand', 'Code', 'Surfaces', 'Area (sq ft)', 'Area (m²)', 'Quantity', 'Unit', 'Basis', 'Rate', 'Amount'],
    ...est.lines.map((l) => [l.material.name, l.material.brand ?? '', l.material.code ?? '', l.surfaces.join('; '), sqft(l.areaSqm), l.areaSqm.toFixed(2), l.quantity, l.unit, l.basis, l.rate ?? '', l.cost ?? '']),
    ['Total', '', '', '', sqft(est.areaSqm), est.areaSqm.toFixed(2), '', '', '', '', est.total],
  ]
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'estimate'}-quantities.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export function EstimateDialog({
  open,
  onOpenChange,
  editor,
  projectName,
  clientId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editor: VizEditor
  projectName: string
  clientId: string | null
}) {
  const navigate = useNavigate()
  const [optionId, setOptionId] = useState(editor.state.approvedOptionId ?? editor.state.activeOptionId)
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => {
    if (open) setOptionId(editor.state.approvedOptionId ?? editor.state.activeOptionId)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const option = editor.state.options.find((o) => o.id === optionId)
  const est = useOptionEstimate(editor, option)
  const all = useMemo(
    () => editor.state.options.map((o) => ({ option: o, est: estimateOption(optionAreas(editor, o), editor.materials) })),
    [editor.state.options, editor.areas, editor.materials] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const noCorners = option ? editor.state.surfaces.filter((s) => option.assignments[s.id] && !s.quad) : []

  const { toast } = useToast()
  const [leaving, setLeaving] = useState(false)
  const sendToProposal = async () => {
    if (!option || !est) return
    const prefill = buildProposalPrefill(projectName, option.name, clientId, est)
    // Leaving the editor inside the autosave delay would drop the latest edits.
    setLeaving(true)
    const saved = await editor.save()
    setLeaving(false)
    if (!saved) {
      toast({ title: 'Save your changes first', description: editor.saveError ?? 'The project could not be saved.', variant: 'destructive' })
      return
    }
    navigate('/proposals/new/cost-breakup', { state: { fromVisualizer: prefill } })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" /> Quantities & cost</DialogTitle>
          <DialogDescription>
            Net visible area of each surface on its real plane (protected details excluded), converted into order quantities. Edit the assumptions per material;
            they are saved to your library.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-xs font-medium">Option</span>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={optionId} onChange={(e) => setOptionId(e.target.value)} aria-label="Option">
              {editor.state.options.map((o) => (
                <option key={o.id} value={o.id}>{o.name}{editor.state.approvedOptionId === o.id ? ' (approved)' : ''}</option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!est?.lines.length} onClick={() => est && option && downloadCsv(`${projectName}-${option.name}`, est)}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button size="sm" className="gap-1.5" disabled={!est?.lines.length || leaving} onClick={() => void sendToProposal()} data-testid="viz-send-proposal">
              {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Send to proposal
            </Button>
          </div>
        </div>

        {noCorners.length > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No perspective corners on {noCorners.map((s) => s.name).join(', ')} — their area assumes the selection’s bounding box is {''}
            the entered width × height. Use Auto-fit corners for an accurate figure.
          </p>
        )}

        {!est || !est.lines.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">This option has no materials assigned yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm" data-testid="viz-estimate-table">
              <thead className="bg-muted/60 text-xs">
                <tr className="text-left">
                  <th className="p-2">Material</th>
                  <th className="p-2">Surfaces</th>
                  <th className="p-2 text-right">Area</th>
                  <th className="p-2">Order</th>
                  <th className="p-2 text-right">Rate</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {est.lines.map((l) => (
                  <MaterialRow key={l.materialId} line={l} editing={editing === l.materialId} onToggle={() => setEditing(editing === l.materialId ? null : l.materialId)} />
                ))}
              </tbody>
              <tfoot className="bg-muted/40 font-medium">
                <tr>
                  <td className="p-2" colSpan={2}>Total</td>
                  <td className="p-2 text-right tabular-nums">{sqft(est.areaSqm)} sq ft</td>
                  <td className="p-2" colSpan={2}>{est.unpriced > 0 && <span className="text-xs font-normal text-amber-600">{est.unpriced} without a rate</span>}</td>
                  <td className="p-2 text-right tabular-nums" data-testid="viz-estimate-total">{formatCurrency(est.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {editor.state.options.length > 1 && (
          <div className="space-y-1.5">
            <h4 className="text-sm font-semibold">All options</h4>
            <div className="grid gap-2 sm:grid-cols-3">
              {all.map(({ option: o, est: e }) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOptionId(o.id)}
                  className={`rounded-md border p-2 text-left text-xs hover:bg-accent ${o.id === optionId ? 'border-primary' : ''}`}
                >
                  <p className="font-medium">{o.name}{editor.state.approvedOptionId === o.id ? ' ✓' : ''}</p>
                  <p className="tabular-nums text-muted-foreground">
                    {sqft(e.areaSqm)} sq ft · {formatCurrency(e.total)}{e.unpriced ? ` + ${e.unpriced} unpriced` : ''}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Estimates from the render: confirm with site measurements before ordering. Sheets, rolls and boxes are rounded up per material across all its surfaces.
        </p>
      </DialogContent>
    </Dialog>
  )
}

function MaterialRow({ line: l, editing, onToggle }: { line: OptionEstimate['lines'][number]; editing: boolean; onToggle: () => void }) {
  const m = l.material
  return (
    <>
      <tr className="border-t align-top">
        <td className="p-2">
          <div className="flex items-center gap-2">
            <MaterialSwatch material={m} className="h-8 w-8 shrink-0" />
            <div className="min-w-0">
              <p className="truncate font-medium">{m.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{[m.brand, m.code].filter(Boolean).join(' · ') || m.category}</p>
            </div>
          </div>
        </td>
        <td className="p-2 text-xs">{l.surfaces.join(', ')}</td>
        <td className="p-2 text-right text-xs tabular-nums">{sqft(l.areaSqm)} sq ft<br /><span className="text-muted-foreground">{l.areaSqm.toFixed(2)} m²</span></td>
        <td className="p-2 text-xs">
          <p className="font-medium" data-testid="viz-estimate-qty">{formatQuantity(l)}</p>
          <p className="text-[11px] text-muted-foreground">{l.basis}</p>
        </td>
        <td className="p-2 text-right text-xs tabular-nums">{l.rate != null ? `${formatCurrency(l.rate)} / ${UNIT_LABELS[l.unit].short}` : '—'}</td>
        <td className="p-2 text-right tabular-nums">{l.cost != null ? formatCurrency(l.cost) : '—'}</td>
        <td className="p-2">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onToggle} aria-label={`Edit assumptions for ${m.name}`} data-testid="viz-estimate-edit">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        </td>
      </tr>
      {editing && (
        <tr className="border-t bg-muted/20">
          <td colSpan={7} className="p-2">
            <EstimateEditor material={m} onDone={onToggle} />
          </td>
        </tr>
      )}
    </>
  )
}

function EstimateEditor({ material, onDone }: { material: VizMaterial; onDone: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [e, setE] = useState<MaterialEstimate>(() => effectiveEstimate(material))
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<MaterialEstimate>) => setE((x) => ({ ...x, ...patch }))

  const save = async () => {
    setSaving(true)
    try {
      await visualizerApi.updateMaterial(material.id, { settings: { ...(material.settings ?? {}), estimate: e } })
      await qc.invalidateQueries({ queryKey: ['visualizer', 'materials'] })
      onDone()
    } catch (err) {
      toast({ title: 'Could not save', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="viz-estimate-editor">
      <label className="space-y-1">
        <span className="text-xs font-medium">Order in</span>
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={e.unit} onChange={(ev) => set({ unit: ev.target.value as EstimateUnit })} aria-label="Unit">
          {ESTIMATE_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u].many}</option>)}
        </select>
      </label>
      {(e.unit === 'sheet' || e.unit === 'roll') && (
        <>
          <div className="w-28"><NumberField label={e.unit === 'sheet' ? 'Sheet width' : 'Roll width'} value={e.sheetWidthMm ?? (e.unit === 'sheet' ? 2440 : 530)} min={1} suffix="mm" onChange={(v) => set({ sheetWidthMm: v })} /></div>
          <div className="w-28"><NumberField label={e.unit === 'sheet' ? 'Sheet height' : 'Roll length'} value={e.sheetHeightMm ?? (e.unit === 'sheet' ? 1220 : 10050)} min={1} suffix="mm" onChange={(v) => set({ sheetHeightMm: v })} /></div>
        </>
      )}
      {e.unit === 'box' && <div className="w-28"><NumberField label="Pieces per box" value={e.piecesPerBox ?? 1} min={1} onChange={(v) => set({ piecesPerBox: Math.max(1, Math.round(v)) })} /></div>}
      {e.unit === 'litre' && (
        <>
          <div className="w-28"><NumberField label="Coverage" value={e.coverageSqmPerLitre ?? 10} min={0.1} step={0.5} suffix="m²/L" onChange={(v) => set({ coverageSqmPerLitre: v })} /></div>
          <div className="w-20"><NumberField label="Coats" value={e.coats ?? 2} min={1} max={10} onChange={(v) => set({ coats: Math.max(1, Math.min(10, Math.round(v))) })} /></div>
        </>
      )}
      <div className="w-24"><NumberField label="Wastage" value={e.wastagePct} min={0} max={100} suffix="%" onChange={(v) => set({ wastagePct: Math.max(0, Math.min(100, v)) })} /></div>
      <div className="w-32">
        <NumberField label={`Rate / ${UNIT_LABELS[e.unit].short}`} value={e.rate ?? 0} min={0} step={10} suffix="₹" onChange={(v) => set({ rate: Math.max(0, v) })} />
      </div>
      <Button size="sm" className="h-8 gap-1" onClick={save} disabled={saving} data-testid="viz-estimate-save">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onDone}>Cancel</Button>
    </div>
  )
}
