import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Download, Share2, Check, Trash2, FileText, Copy, GitBranch } from 'lucide-react'
import { useState } from 'react'
import { PDFDownloadLink, PDFViewer } from '@react-pdf/renderer'
import { ProposalPDF } from '@/components/proposals/ProposalPDF'
import { useLogoDataUrl } from '@/hooks/useLogoDataUrl'
import { proposalsApi } from '@/api/proposals'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/ui/toast'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'border-transparent bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SENT: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  ACCEPTED: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  REJECTED: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

export function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [deletingOpen, setDeletingOpen] = useState(false)
  const logoDataUrl = useLogoDataUrl()

  const { data: proposal, isLoading } = useQuery({
    queryKey: ['proposal', id],
    queryFn: () => proposalsApi.getProposal(id!),
    enabled: !!id,
  })

  const deleteProposal = useMutation({
    mutationFn: () => proposalsApi.deleteProposal(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] })
      navigate('/proposals')
      toast({ title: 'Proposal deleted' })
    },
    onError: () => toast({ title: 'Error', description: 'Failed to delete proposal.', variant: 'destructive' }),
  })

  const handleShare = async () => {
    if (!proposal) return
    try {
      const token = proposal.shareToken ?? await proposalsApi.generateShareToken(proposal.id)
      const url = `${window.location.origin}/proposals/share/${token}`
      await navigator.clipboard.writeText(url)
      qc.invalidateQueries({ queryKey: ['proposal', id] })
      setCopied(true)
      toast({ title: 'Share link copied!', description: 'Anyone with the link can view and download this proposal.' })
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast({ title: 'Error', description: 'Failed to generate share link.', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="w-full h-[80vh]" />
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Proposal not found.</p>
        <Button variant="outline" onClick={() => navigate('/proposals')}>Back to Proposals</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <button onClick={() => navigate('/proposals')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">{proposal.clientName}</h2>
            <Badge className={STATUS_COLORS[proposal.status]}>{proposal.status}</Badge>
            {proposal.version > 1 && (
              <Badge className="border-transparent bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400">v{proposal.version}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{proposal.proposalNumber} · {proposal.serviceType}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => navigate(`/proposals/new?copyFrom=${proposal.id}`)}>
            <Copy className="h-4 w-4 mr-1" /> Copy
          </Button>

          <Button variant="outline" size="sm" onClick={() => navigate(`/proposals/new?versionOf=${proposal.id}`)}>
            <GitBranch className="h-4 w-4 mr-1" /> New Version
          </Button>

          <Button variant="outline" size="sm" onClick={handleShare}>
            {copied ? <Check className="h-4 w-4 mr-1 text-green-600" /> : <Share2 className="h-4 w-4 mr-1" />}
            {copied ? 'Copied!' : 'Share Link'}
          </Button>

          <PDFDownloadLink
            document={<ProposalPDF proposal={{ ...proposal, companyLogoUrl: logoDataUrl }} />}
            fileName={`Proposal-${proposal.proposalNumber}.pdf`}
          >
            {({ loading }) => (
              <Button size="sm" disabled={loading}>
                <Download className="h-4 w-4 mr-1" />
                {loading ? 'Preparing…' : 'Download PDF'}
              </Button>
            )}
          </PDFDownloadLink>

          <Button
            variant="ghost" size="sm"
            onClick={() => setDeletingOpen(true)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="rounded-lg overflow-hidden shadow border border-border" style={{ height: '80vh' }}>
        <PDFViewer width="100%" height="100%" showToolbar={false}>
          <ProposalPDF proposal={{ ...proposal, companyLogoUrl: logoDataUrl }} />
        </PDFViewer>
      </div>

      <ConfirmDialog
        open={deletingOpen}
        onOpenChange={setDeletingOpen}
        title="Delete Proposal"
        description="This will permanently delete the proposal. This action cannot be undone."
        onConfirm={() => { deleteProposal.mutate() }}
        isLoading={deleteProposal.isPending}
      />
    </div>
  )
}
