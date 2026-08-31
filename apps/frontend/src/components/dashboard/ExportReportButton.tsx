import { useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import { FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { BusinessReportPDF } from '@/components/dashboard/BusinessReportPDF'
import { dashboardApi } from '@/api/dashboard'
import { fetchLogoAsDataUrl } from '@/lib/logoProxy'

// Builds the full business report on demand. The dataset is only fetched when
// the button is pressed, so opening the dashboard stays cheap.
export function ExportReportButton() {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const handleExport = async () => {
    setBusy(true)
    try {
      const report = await dashboardApi.getBusinessReport()

      // The R2 logo URL cannot be embedded directly — react-pdf needs the bytes,
      // so it goes through the same proxy the invoice and proposal PDFs use.
      const logoDataUrl = await fetchLogoAsDataUrl(report.company?.companyLogoUrl)
      const withLogo = {
        ...report,
        company: report.company ? { ...report.company, companyLogoUrl: logoDataUrl } : null,
      }

      const blob = await pdf(<BusinessReportPDF report={withLogo} />).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      const name = (report.company?.companyName ?? 'Business').replace(/[^a-zA-Z0-9]+/g, '-')
      a.href = url
      a.download = `${name}-Report-${stamp}.pdf`
      a.click()
      URL.revokeObjectURL(url)

      toast({
        title: 'Report downloaded',
        description: `${report.summary.totalClients} clients and ${report.summary.paymentCount} payments exported.`,
      })
    } catch {
      toast({
        title: 'Export failed',
        description: 'Could not generate the report. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={handleExport} disabled={busy} className="w-full sm:w-auto">
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
      {busy ? 'Preparing…' : 'Export Report'}
    </Button>
  )
}
