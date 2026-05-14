import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Mail, Phone, MapPin, FileText, Plus, Pencil,
  CreditCard, FolderOpen, Activity, User
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { ClientStatusBadge } from '@/components/clients/ClientStatusBadge'
import { ClientForm } from '@/components/clients/ClientForm'
import { PaymentSummary } from '@/components/payments/PaymentSummary'
import { PaymentTimeline } from '@/components/payments/PaymentTimeline'
import { PaymentForm } from '@/components/payments/PaymentForm'
import { FileUpload } from '@/components/files/FileUpload'
import { FileList } from '@/components/files/FileList'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { useClient } from '@/hooks/useClients'
import { usePayments } from '@/hooks/usePayments'
import { useFiles } from '@/hooks/useFiles'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'payments' | 'files' | 'activity'

const TABS: { value: Tab; label: string; icon: typeof User }[] = [
  { value: 'overview', label: 'Overview', icon: User },
  { value: 'payments', label: 'Payments', icon: CreditCard },
  { value: 'files', label: 'Files', icon: FolderOpen },
  { value: 'activity', label: 'Activity', icon: Activity },
]

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false)

  const { data: client, isLoading: clientLoading } = useClient(id ?? '')
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments({
    clientId: id,
    limit: 100,
    sort: 'date',
    order: 'desc',
  })
  const { data: files = [], isLoading: filesLoading } = useFiles(id ?? '')

  const payments = paymentsData?.data ?? []

  if (clientLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Client not found.</p>
        <Button asChild variant="link" className="mt-2">
          <Link to="/clients">Back to Clients</Link>
        </Button>
      </div>
    )
  }

  const totalPaid = client.totalPaid ?? 0
  const remaining = client.remainingBalance ?? client.totalDealAmount - totalPaid

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground">
          <Link to="/clients">
            <ArrowLeft className="h-4 w-4" />
            Back to Clients
          </Link>
        </Button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-bold text-foreground">{client.name}</h2>
              <ClientStatusBadge status={client.status} />
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              {client.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {client.email}
                </span>
              )}
              {client.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> {client.phone}
                </span>
              )}
              {client.address && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {client.address}
                </span>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)} className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit Client
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto scrollbar-none">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0',
                activeTab === tab.value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: client details */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Client Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Created</p>
                    <p className="font-medium">{formatDate(client.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last Updated</p>
                    <p className="font-medium">{formatDate(client.updatedAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Payments</p>
                    <p className="font-medium">{client._count?.payments ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Files</p>
                    <p className="font-medium">{client._count?.files ?? 0}</p>
                  </div>
                </div>
                {client.projectDescription && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Project Description</p>
                      <p className="text-sm text-foreground">{client.projectDescription}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: payment summary */}
          <div>
            <PaymentSummary
              totalDealAmount={client.totalDealAmount}
              totalPaid={totalPaid}
              remainingBalance={remaining}
            />
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Payment History</h3>
            <Button onClick={() => setIsPaymentFormOpen(true)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Record Payment
            </Button>
          </div>
          <PaymentTimeline payments={payments} isLoading={paymentsLoading} clientId={id!} />
          <PaymentForm
            clientId={id}
            open={isPaymentFormOpen}
            onOpenChange={setIsPaymentFormOpen}
          />
        </div>
      )}

      {activeTab === 'files' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-semibold mb-3">Upload Files</h3>
            <FileUpload clientId={id!} />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-3">
              Files ({files.length})
            </h3>
            <FileList files={files} isLoading={filesLoading} clientId={id!} />
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div>
          <RecentActivity activities={[]} />
          <p className="text-sm text-muted-foreground text-center mt-4">
            Activity log for this client will appear here.
          </p>
        </div>
      )}

      {/* Edit modal */}
      <ClientForm
        client={client}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />
    </div>
  )
}
