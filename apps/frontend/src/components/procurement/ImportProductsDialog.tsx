import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement, useVendors } from '@/hooks/useProcurement'
import { parsePriceList, PRICE_LIST_TEMPLATE } from '@/lib/procurement/priceListCsv'
import { formatCurrency } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultVendorId?: string
}

// Imports a vendor's price list from CSV. Existing products are matched and
// re-priced (with history), new ones are added.
export function ImportProductsDialog({ open, onOpenChange, defaultVendorId }: Props) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const { data: vendors = [] } = useVendors()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) return
    setText(null)
    setFileName('')
    setVendorId(defaultVendorId ?? '')
  }, [open, defaultVendorId])

  const vendorName = vendors.find((v) => v.id === vendorId)?.name ?? null
  const parsed = useMemo(() => (text === null ? null : parsePriceList(text, vendorName)), [text, vendorName])
  const missingVendor = !!parsed?.needsVendor && !vendorName

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setText(await file.text())
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([PRICE_LIST_TEMPLATE], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'vendor-price-list-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    if (!parsed || parsed.rows.length === 0 || missingVendor) return
    setImporting(true)
    try {
      const r = await procurementApi.importProducts(parsed.rows)
      invalidate()
      toast({
        title: 'Price list imported',
        description: [
          `${r.created} added`,
          `${r.updated} re-priced`,
          r.unchanged ? `${r.unchanged} unchanged` : null,
          r.vendorsCreated ? `${r.vendorsCreated} new vendor${r.vendorsCreated > 1 ? 's' : ''}` : null,
        ].filter(Boolean).join(' · '),
      })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Import failed', description: apiErrorMessage(err, 'Could not import the price list.'), variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> Import Price List</DialogTitle>
          <DialogDescription>
            Upload a CSV of a vendor&apos;s products and rates (save an Excel sheet as CSV). Products already in
            your catalog are matched by code, or by name and brand, and their price is updated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> {fileName ? 'Choose another file' : 'Choose CSV file'}
            </Button>
            <Button variant="ghost" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" /> Template
            </Button>
          </div>
          {fileName && <p className="text-sm text-muted-foreground">{fileName}</p>}

          {parsed?.needsVendor && (
            <div className="space-y-1.5">
              <Label>This file has no vendor column — whose price list is it? *</Label>
              <Select value={vendorId || 'none'} onValueChange={(v) => setVendorId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none" disabled>Select vendor</SelectItem>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {parsed && parsed.rows.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 text-sm font-medium">
                {parsed.rows.length} product{parsed.rows.length === 1 ? '' : 's'} ready
              </div>
              <div className="divide-y divide-border text-sm">
                {parsed.rows.slice(0, 6).map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate">{r.name}{r.brand ? ` · ${r.brand}` : ''}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.vendorName || 'Vendor not chosen'}</p>
                    </div>
                    <span className="tabular-nums shrink-0">{formatCurrency(r.price)}{r.unit ? ` / ${r.unit}` : ''}</span>
                  </div>
                ))}
                {parsed.rows.length > 6 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">…and {parsed.rows.length - 6} more</p>
                )}
              </div>
            </div>
          )}

          {parsed && parsed.errors.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-1">
              <p className="font-medium">{parsed.errors.length} row{parsed.errors.length === 1 ? '' : 's'} will be skipped</p>
              {parsed.errors.slice(0, 5).map((e, i) => <p key={i} className="text-xs">Line {e.line}: {e.message}</p>)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={importing || !parsed || parsed.rows.length === 0 || missingVendor}>
            {importing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Import {parsed?.rows.length ? parsed.rows.length : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
