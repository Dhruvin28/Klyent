import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, Download, Share2, Trash2, Eye, Copy, Check, GitBranch, ChevronDown, LayoutList } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { ProposalPDF } from '@/components/proposals/ProposalPDF'
import { CostBreakupProposalPDF } from '@/components/proposals/CostBreakupProposalPDF'
import { proposalsApi } from '@/api/proposals'
import { useToast } from '@/components/ui/toast'
import { useLogoDataUrl } from '@/hooks/useLogoDataUrl'
import { formatDate } from '@/lib/utils'
import type { Proposal } from '@/types'

// Route to create a new proposal of the same kind as an existing one.
function newProposalPath(proposalType: Proposal['proposalType']): string {
  return proposalType === 'COST_BREAKUP' ? '/proposals/new/cost-breakup' : '/proposals/new'
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'border-transparent bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SENT: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  ACCEPTED: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  REJECTED: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

function CopyShareButton({ proposalId }: { proposalId: string }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const qc = useQueryClient()

  const handleShare = async () => {
    setSharing(true)
    try {
      const token = await proposalsApi.generateShareToken(proposalId)
      const url = `${window.location.origin}/proposals/share/${token}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      qc.invalidateQueries({ queryKey: ['proposals'] })
      toast({ title: 'Share link copied!', description: 'Anyone with the link can view and download this proposal.' })
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast({ title: 'Error', description: 'Failed to generate share link.', variant: 'destructive' })
    } finally {
      setSharing(false)
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleShare} disabled={sharing} title="Copy share link">
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Share2 className="h-4 w-4" />}
    </Button>
  )
}

function ProposalCard({ proposal, onDelete, logoDataUrl }: { proposal: Proposal; onDelete: (id: string) => void; logoDataUrl: string | null }) {
  const navigate = useNavigate()
  const milestones = proposal.paymentMilestones ?? []

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm truncate">{proposal.clientName}</span>
                <Badge className={STATUS_COLORS[proposal.status]}>{proposal.status}</Badge>
                {proposal.version > 1 && (
                  <Badge className="border-transparent bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400">v{proposal.version}</Badge>
                )}
                {proposal.proposalType === 'COST_BREAKUP' && (
                  <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Cost Breakup</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{proposal.proposalNumber} · {proposal.serviceType}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(proposal.date)} · Valid till {formatDate(proposal.validTill)}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold">Rs. {Number(proposal.feesAmount).toLocaleString('en-IN')}</p>
            {milestones.length > 0 && (
              <p className="text-xs text-muted-foreground">{milestones.length} milestone{milestones.length !== 1 ? 's' : ''}</p>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1 border-t border-border pt-3">
          <Button
            variant="ghost" size="sm"
            onClick={() => navigate(`/proposals/${proposal.id}`)}
            title="View proposal"
          >
            <Eye className="h-4 w-4" />
          </Button>

          <PDFDownloadLink
            document={proposal.proposalType === 'COST_BREAKUP'
              ? <CostBreakupProposalPDF proposal={{ ...proposal, companyLogoUrl: logoDataUrl }} />
              : <ProposalPDF proposal={{ ...proposal, companyLogoUrl: logoDataUrl }} />}
            fileName={`Proposal-${proposal.proposalNumber}.pdf`}
          >
            {({ loading }) => (
              <Button variant="ghost" size="sm" disabled={loading} title="Download PDF">
                <Download className="h-4 w-4" />
              </Button>
            )}
          </PDFDownloadLink>

          <CopyShareButton proposalId={proposal.id} />

          <Button
            variant="ghost" size="sm"
            onClick={() => navigate(`${newProposalPath(proposal.proposalType)}?copyFrom=${proposal.id}`)}
            title="Duplicate as a new proposal"
          >
            <Copy className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost" size="sm"
            onClick={() => navigate(`${newProposalPath(proposal.proposalType)}?versionOf=${proposal.id}`)}
            title="Create a new version"
          >
            <GitBranch className="h-4 w-4" />
          </Button>

          <div className="flex-1" />

          <Button
            variant="ghost" size="sm"
            onClick={() => onDelete(proposal.id)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete proposal"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProposalsPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const logoDataUrl = useLogoDataUrl()

  const { data, isLoading } = useQuery({
    queryKey: ['proposals', { status }],
    queryFn: () => proposalsApi.getProposals({ status: status || undefined }),
  })

  const deleteProposal = useMutation({
    mutationFn: (id: string) => proposalsApi.deleteProposal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] })
      toast({ title: 'Proposal deleted' })
    },
    onError: () => toast({ title: 'Error', description: 'Failed to delete proposal.', variant: 'destructive' }),
  })

  const proposals = data?.data ?? []

  const handleDelete = async () => {
    if (!deletingId) return
    await deleteProposal.mutateAsync(deletingId)
    setDeletingId(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Proposals</h2>
          <p className="text-sm text-muted-foreground">Create and manage client proposals with PDF export and sharing</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              New Proposal
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => navigate('/proposals/new')} className="gap-2 py-2.5">
              <FileText className="h-4 w-4" />
              <div>
                <p className="font-medium">Standard Proposal</p>
                <p className="text-xs text-muted-foreground">Scope, fees & payment milestones</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/proposals/new/cost-breakup')} className="gap-2 py-2.5">
              <LayoutList className="h-4 w-4" />
              <div>
                <p className="font-medium">Cost Breakup Estimate</p>
                <p className="text-xs text-muted-foreground">Itemized material rates & final cost breakup</p>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filter */}
      <div className="flex gap-3 items-end">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Status</p>
          <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="ACCEPTED">Accepted</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No proposals yet"
          description="Create your first proposal and share it directly with your client."
          action={{ label: 'Create Proposal', onClick: () => navigate('/proposals/new') }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onDelete={setDeletingId} logoDataUrl={logoDataUrl} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(o) => !o && setDeletingId(null)}
        title="Delete Proposal"
        description="This will permanently delete the proposal. This action cannot be undone."
        onConfirm={handleDelete}
        isLoading={deleteProposal.isPending}
      />
    </div>
  )
}
