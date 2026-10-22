import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Loader2, Palette } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { apiErrorMessage, visualizerApi, type PaintImportItem } from '@/api/visualizer'
import { PAINT_CSV_TEMPLATE, STARTER_NEUTRALS, parsePaintCsv, type PaintRow } from '@/lib/visualizer/paintCsv'
import { downloadBlob } from '@/lib/visualizer/outputs'

/** Bulk-adds paint shades to the library from a CSV (e.g. a brand's shade list) or a starter palette. */
export function ImportPaintsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [rows, setRows] = useState<PaintRow[]>([])
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setRows([])
    setErrors([])
  }, [open])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 2 * 1024 * 1024) {
      setErrors([{ line: 0, message: 'The file is larger than 2MB' }])
      return
    }
    const parsed = parsePaintCsv(await f.text())
    setRows(parsed.rows)
    setErrors(parsed.errors)
  }

  const save = async () => {
    if (!rows.length) return
    setBusy(true)
    try {
      const items: PaintImportItem[] = rows.map((r) => ({
        name: r.name,
        colorHex: r.colorHex,
        brand: r.brand,
        code: r.code,
        ...(r.rate != null || r.coverageSqmPerLitre != null || r.coats != null
          ? { estimate: { unit: 'litre' as const, coverageSqmPerLitre: r.coverageSqmPerLitre ?? 10, coats: r.coats ?? 2, wastagePct: 5, rate: r.rate } }
          : {}),
      }))
      const created = await visualizerApi.importPaints(items)
      await qc.invalidateQueries({ queryKey: ['visualizer', 'materials'] })
      toast({ title: `${created} paint colour${created === 1 ? '' : 's'} added to your library` })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Import failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Import paint colours</DialogTitle>
          <DialogDescription>
            Upload a CSV with at least <code>name</code> and <code>hex</code> columns — e.g. your paint supplier’s shade list. Optional: <code>brand</code>,{' '}
            <code>code</code>, <code>rate_per_litre</code>, <code>coverage_sqm_per_litre</code>, <code>coats</code>. Up to 500 shades at a time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            <FileSpreadsheet className="h-4 w-4" /> Choose CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="viz-paint-csv" />
          </label>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadBlob(new Blob([PAINT_CSV_TEMPLATE], { type: 'text/csv' }), 'paint-colours-template.csv')}>
            <Download className="h-4 w-4" /> Template
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { setRows(STARTER_NEUTRALS); setErrors([]) }}>
            <Palette className="h-4 w-4" /> Starter neutrals
          </Button>
        </div>
        {errors.length > 0 && (
          <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {errors.map((e, i) => <li key={i}>{e.line ? `Line ${e.line}: ` : ''}{e.message}</li>)}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="max-h-[45vh] overflow-y-auto rounded-md border">
            <table className="w-full text-xs" data-testid="viz-paint-preview">
              <thead className="sticky top-0 bg-muted text-left">
                <tr><th className="p-1.5" /><th className="p-1.5">Name</th><th className="p-1.5">Brand</th><th className="p-1.5">Code</th><th className="p-1.5">Hex</th><th className="p-1.5 text-right">Rate / L</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-1.5"><span className="block h-5 w-5 rounded border" style={{ backgroundColor: r.colorHex }} /></td>
                    <td className="p-1.5">{r.name}</td>
                    <td className="p-1.5">{r.brand ?? '—'}</td>
                    <td className="p-1.5">{r.code ?? '—'}</td>
                    <td className="p-1.5 font-mono">{r.colorHex}</td>
                    <td className="p-1.5 text-right">{r.rate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !rows.length} className="gap-2" data-testid="viz-paint-import">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add {rows.length || ''} colour{rows.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
