import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CheckCircle2, Download, FileJson, FileText, Image as ImageIcon, Loader2, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { apiErrorMessage, visualizerApi, type ExportDetails, type VizExport, type VizProject } from '@/api/visualizer'
import { useVizExports } from '@/hooks/useVisualizer'
import type { VerificationReport, VizMaterial, VizState } from '@/lib/visualizer/types'
import type { VizEditor } from './useVizEditor'

export function buildExportDetails(projectName: string, state: VizState, optionId: string, materials: Map<string, VizMaterial>, size: { width: number; height: number }): ExportDetails {
  const option = state.options.find((o) => o.id === optionId)!
  const surfaces: ExportDetails['surfaces'] = []
  for (const s of state.surfaces) {
    const a = option.assignments[s.id]
    if (!a) continue
    const m = materials.get(a.materialId)
    if (!m) continue
    const application: Record<string, string | number | boolean> = {
      finish: a.finish,
      lightingStrength: a.shading,
      originalDetail: a.detail,
      brightness: a.exposure,
    }
    if (m.kind === 'texture') {
      Object.assign(application, {
        pattern: a.pattern,
        rotationDeg: a.rotationDeg,
        scale: a.scale,
        offsetXMm: a.offsetXMm,
        offsetYMm: a.offsetYMm,
      })
      if (a.pattern === 'tiles') Object.assign(application, { layout: a.tile.layout, groutMm: a.tile.groutMm, groutColor: a.tile.groutColor })
    }
    surfaces.push({
      name: s.name,
      type: s.type,
      widthMm: Math.round(s.widthMm),
      heightMm: Math.round(s.heightMm),
      material: {
        name: m.name,
        kind: m.kind,
        category: m.category,
        brand: m.brand,
        code: m.code,
        colorHex: m.kind === 'paint' ? m.colorHex : null,
        sizeMm: m.kind === 'texture' && m.widthMm && m.heightMm ? [Math.round(m.widthMm), Math.round(m.heightMm)] : null,
      },
      application,
    })
  }
  return {
    project: projectName,
    option: option.name,
    approved: state.approvedOptionId === option.id,
    notes: option.notes,
    generatedAt: new Date().toISOString(),
    image: size,
    surfaces,
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'export'
}

async function jpegDataUrl(blob: Blob, maxSide = 2000): Promise<string> {
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * s)
  c.height = Math.round(bmp.height * s)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/jpeg', 0.9)
}

function VerificationLine({ report }: { report: VerificationReport }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {report.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
      <div>
        <span className="font-medium">{report.verifiedBy === 'server' ? 'Server check' : 'Browser check'}: </span>
        {report.ok
          ? `${report.protectedPixels.toLocaleString()} untouched pixels are byte-identical to the original (0 changed).`
          : `${report.changedOutsideMask.toLocaleString()} pixels outside the selection changed.`}
        <span className="text-muted-foreground"> {report.changedInsideMask.toLocaleString()} of {report.editablePixels.toLocaleString()} selected pixels re-rendered.</span>
      </div>
    </div>
  )
}

export function ExportDialog({ open, onOpenChange, editor, project }: { open: boolean; onOpenChange: (o: boolean) => void; editor: VizEditor; project: VizProject & { name: string } }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: exports, isLoading } = useVizExports(open ? project.id : '')
  const [optionId, setOptionId] = useState(editor.state.approvedOptionId ?? editor.state.activeOptionId)
  const [step, setStep] = useState<string | null>(null)
  const [last, setLast] = useState<{ client: VerificationReport; server: VerificationReport; exp: VizExport } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setOptionId(editor.state.approvedOptionId ?? editor.state.activeOptionId)
      setLast(null)
      setWarning(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const option = editor.state.options.find((o) => o.id === optionId)
  const assignedCount = option ? editor.state.surfaces.filter((s) => option.assignments[s.id]).length : 0

  const run = async () => {
    if (!option) return
    setLast(null)
    setWarning(null)
    try {
      setStep('Saving project…')
      // The server verifies the export against the saved option, so it must be persisted first.
      if (!(await editor.save())) throw new Error(editor.saveError ?? 'The project could not be saved. Reload the page and try again.')
      setStep('Rendering at full resolution…')
      const out = await editor.exportOption(option.id)
      if (out.skipped.length) {
        const names = out.skipped.map((s) => editor.state.surfaces.find((x) => x.id === s.id)?.name ?? s.id)
        setWarning(`Not applied: ${names.join(', ')} (${out.skipped[0].reason.toLowerCase()}).`)
      }
      setStep('Verifying on server…')
      const details = buildExportDetails(project.name, editor.state, option.id, editor.materials, { width: editor.W, height: editor.H })
      const exp = await visualizerApi.createExport(project.id, { optionId: option.id, details }, out.image, out.mask)
      setLast({ client: out.report, server: exp.verification, exp })
      await qc.invalidateQueries({ queryKey: ['visualizer', 'exports', project.id] })
      downloadBlob(out.image, `${slug(project.name)}-${slug(option.name)}.png`)
      toast({ title: 'Export verified and saved', description: 'The lossless PNG has been downloaded.' })
    } catch (err) {
      toast({ title: 'Export failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setStep(null)
    }
  }

  const download = async (e: VizExport, what: 'image' | 'mask' | 'json' | 'pdf') => {
    const base = `${slug(e.details.project)}-${slug(e.optionName)}`
    try {
      setPdfBusy(`${e.id}:${what}`)
      if (what === 'json') {
        downloadBlob(new Blob([JSON.stringify({ ...e.details, verification: e.verification }, null, 2)], { type: 'application/json' }), `${base}-materials.json`)
      } else if (what === 'image' || what === 'mask') {
        const blob = await visualizerApi.getAssetBlob(what === 'image' ? e.imageAssetId : e.maskAssetId)
        downloadBlob(blob, what === 'image' ? `${base}.png` : `${base}-edit-mask.png`)
      } else {
        const [{ pdf }, { MaterialSchedulePDF }] = await Promise.all([import('@react-pdf/renderer'), import('../MaterialSchedulePDF')])
        const blob = await visualizerApi.getAssetBlob(e.imageAssetId)
        const imageDataUrl = await jpegDataUrl(blob)
        const file = await pdf(<MaterialSchedulePDF details={e.details} imageDataUrl={imageDataUrl} verification={e.verification} />).toBlob()
        downloadBlob(file, `${base}-material-schedule.pdf`)
      }
    } catch (err) {
      toast({ title: 'Download failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setPdfBusy(null)
    }
  }

  const remove = async (id: string) => {
    try {
      await visualizerApi.deleteExport(id)
      await qc.invalidateQueries({ queryKey: ['visualizer', 'exports', project.id] })
    } catch (err) {
      toast({ title: 'Delete failed', description: apiErrorMessage(err), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !step && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Export option</DialogTitle>
          <DialogDescription>
            Renders at full resolution ({editor.W}×{editor.H}), saves a lossless PNG and checks — in your browser and again on the server — that no
            pixel outside the selected surfaces changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="space-y-1">
              <span className="text-xs font-medium">Option</span>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={optionId} onChange={(e) => setOptionId(e.target.value)} aria-label="Option to export">
                {editor.state.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {editor.state.approvedOptionId === o.id ? ' (approved)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={run} disabled={!!step || !option || assignedCount === 0} className="gap-2" data-testid="viz-export-run">
              {step ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {step ?? 'Export & verify'}
            </Button>
          </div>
          {option && assignedCount === 0 && <p className="text-xs text-amber-600">This option has no materials assigned yet.</p>}
          {option && (
            <label className="block space-y-1">
              <span className="text-xs font-medium">Notes for the material schedule</span>
              <Textarea
                rows={2}
                value={option.notes}
                maxLength={2000}
                onChange={(e) =>
                  editor.setState((s) => ({ ...s, options: s.options.map((o) => (o.id === option.id ? { ...o, notes: e.target.value } : o)) }))
                }
                placeholder="e.g. Shutters in walnut, carcass in white; handles retained"
              />
            </label>
          )}
          {warning && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">{warning}</p>}
          {last && (
            <div className="space-y-1.5 rounded-lg border border-green-300 bg-green-50 p-3 dark:bg-green-950/40" data-testid="viz-export-result">
              <VerificationLine report={last.client} />
              <VerificationLine report={last.server} />
            </div>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <h4 className="text-sm font-semibold">Saved exports</h4>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : !exports?.length ? (
            <p className="text-xs text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {exports.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {e.optionName}
                      {e.details.approved && <span className="ml-1.5 text-[10px] font-semibold text-green-700">APPROVED</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(e.createdAt), 'd MMM yyyy, HH:mm')} · {e.verification.ok ? 'verified ✓' : 'unverified'}
                    </p>
                  </div>
                  {(
                    [
                      ['image', ImageIcon, 'PNG'],
                      ['pdf', FileText, 'Schedule PDF'],
                      ['json', FileJson, 'JSON'],
                      ['mask', Download, 'Mask'],
                    ] as const
                  ).map(([what, Icon, label]) => (
                    <Button key={what} variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => download(e, what)} disabled={!!pdfBusy}>
                      {pdfBusy === `${e.id}:${what}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                      {label}
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:text-destructive" onClick={() => remove(e.id)} aria-label="Delete export">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
