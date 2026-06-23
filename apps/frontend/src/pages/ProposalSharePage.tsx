import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, AlertCircle, Layers } from 'lucide-react'
import { useState, useEffect } from 'react'
import { pdf } from '@react-pdf/renderer'
import { ProposalPDF } from '@/components/proposals/ProposalPDF'
import { fetchLogoAsDataUrl } from '@/lib/logoProxy'
import { proposalsApi } from '@/api/proposals'
import { Button } from '@/components/ui/button'

// ── Renders the PDF as a blob URL inside a native <iframe> ──
// This avoids PDFViewer's iframe-within-iframe quirks.
function PdfFrame({ token }: { token: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [generating, setGenerating] = useState(true)

  const { data: proposal } = useQuery({
    queryKey: ['proposal-share', token],
    queryFn: () => proposalsApi.getProposalByToken(token),
    enabled: !!token,
    retry: false,
  })

  useEffect(() => {
    if (!proposal) return
    let cancelled = false
    let objectUrl: string

    ;(async () => {
      const logoDataUrl = await fetchLogoAsDataUrl(proposal.companyLogoUrl)
      if (cancelled) return
      const blob = await pdf(<ProposalPDF proposal={{ ...proposal, companyLogoUrl: logoDataUrl }} />).toBlob()
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setSrc(objectUrl)
      setGenerating(false)
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [proposal])

  if (generating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <div className="h-10 w-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
        <p className="text-sm">Preparing your proposal…</p>
      </div>
    )
  }

  return (
    <iframe
      src={src ?? ''}
      title="Proposal PDF"
      className="flex-1 w-full border-0"
      style={{ minHeight: 0 }}
    />
  )
}

export function ProposalSharePage() {
  const { token } = useParams<{ token: string }>()

  const { data: proposal, isLoading, isError } = useQuery({
    queryKey: ['proposal-share', token],
    queryFn: () => proposalsApi.getProposalByToken(token!),
    enabled: !!token,
    retry: false,
  })

  const handleDownload = async () => {
    if (!proposal) return
    const logoDataUrl = await fetchLogoAsDataUrl(proposal.companyLogoUrl)
    const blob = await pdf(<ProposalPDF proposal={{ ...proposal, companyLogoUrl: logoDataUrl }} />).toBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Proposal-${proposal.proposalNumber}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-background">
        <AlertCircle className="h-14 w-14 text-destructive" />
        <h1 className="text-2xl font-semibold">Link Not Found</h1>
        <p className="text-muted-foreground max-w-sm">
          This proposal link may have expired or been removed. Please contact the sender for a new link.
        </p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-muted/30">
      {/* ── Top bar ── */}
      <header className="shrink-0 bg-background border-b border-border h-14 flex items-center justify-between px-4 sm:px-6 gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Layers className="h-4 w-4" />
          </div>
          <span className="font-bold text-primary text-base">Klyent</span>
        </div>

        {/* Proposal info + download */}
        <div className="flex items-center gap-3 min-w-0">
          {isLoading ? (
            <div className="h-4 w-40 bg-muted animate-pulse rounded" />
          ) : proposal ? (
            <p className="text-sm text-muted-foreground hidden sm:block truncate">
              {proposal.proposalNumber} · {proposal.clientName}
            </p>
          ) : null}

          <Button
            size="sm"
            disabled={!proposal}
            onClick={handleDownload}
          >
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
        </div>
      </header>

      {/* ── PDF fills the rest of the screen ── */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="h-10 w-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
          <p className="text-sm">Loading proposal…</p>
        </div>
      ) : proposal ? (
        <PdfFrame token={token!} />
      ) : null}
    </div>
  )
}
