import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Pencil, Upload, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FreelanceForm } from '@/components/freelance/FreelanceForm'
import { WorkLogForm } from '@/components/freelance/WorkLogForm'
import { WorkLogList } from '@/components/freelance/WorkLogList'
import { PaymentForm } from '@/components/payments/PaymentForm'
import { FileList } from '@/components/files/FileList'
import { FileUpload } from '@/components/files/FileUpload'
import { useFreelanceProject, useUpdateFreelanceProject } from '@/hooks/useFreelance'
import { usePayments } from '@/hooks/usePayments'
import { useFiles } from '@/hooks/useFiles'
import { useToast } from '@/components/ui/toast'
import { formatCurrency, formatDate } from '@/lib/utils'

const statusColors: Record<string, string> = {
  ACTIVE: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  COMPLETED: 'border-transparent bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
}

const methodColors: Record<string, string> = {
  CASH: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  ONLINE: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  CHEQUE: 'border-transparent bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
}

type Tab = 'work-logs' | 'payments' | 'files'

export function FreelanceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [editOpen, setEditOpen] = useState(false)
  const [logWorkOpen, setLogWorkOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('work-logs')

  const { data: project, isLoading } = useFreelanceProject(id!)
  const { data: paymentsData } = usePayments({ freelanceProjectId: id, limit: 100 })
  const { data: filesData = [], isLoading: filesLoading } = useFiles({ freelanceProjectId: id })
  const updateProject = useUpdateFreelanceProject()

  const payments = paymentsData?.data ?? []

  const handleStatusChange = async (newStatus: 'ACTIVE' | 'COMPLETED') => {
    if (!project) return
    try {
      await updateProject.mutateAsync({ id: project.id, data: { status: newStatus } })
      toast({ title: 'Status updated' })
    } catch {
      toast({ title: 'Error', description: 'Failed to update status.', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!project) {
    return <div className="text-center py-12 text-muted-foreground">Project not found.</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 mt-0.5" onClick={() => navigate('/freelance')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">{project.clientName}</h2>
            <Badge className={statusColors[project.status]}>{project.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {project.workType} · {project.chargeType} @ {formatCurrency(project.rate)} each
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={project.status} onValueChange={(v) => handleStatusChange(v as 'ACTIVE' | 'COMPLETED')}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Billed</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(project.totalBilled)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Paid</p>
            <p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">{formatCurrency(project.totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Pending Balance</p>
            <p className="text-2xl font-bold mt-1 text-orange-600 dark:text-orange-400">{formatCurrency(project.remainingBalance)}</p>
          </CardContent>
        </Card>
      </div>

      {project.notes && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">{project.notes}</CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex rounded-lg border p-1 gap-1">
            {(['work-logs', 'payments', 'files'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors capitalize ${
                  activeTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.replace('-', ' ')}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {activeTab === 'work-logs' && (
              <Button size="sm" onClick={() => setLogWorkOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Log Work
              </Button>
            )}
            {activeTab === 'payments' && (
              <Button size="sm" onClick={() => setPaymentOpen(true)}>
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                Add Payment
              </Button>
            )}
            {activeTab === 'files' && (
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload File
              </Button>
            )}
          </div>
        </div>

        {activeTab === 'work-logs' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Work Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkLogList project={project} logs={project.workLogs ?? []} />
            </CardContent>
          </Card>
        )}

        {activeTab === 'payments' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-sm">No payments recorded yet.</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-semibold">{formatCurrency(p.amount)}</TableCell>
                          <TableCell>
                            <Badge className={methodColors[p.method]}>
                              {p.method.charAt(0) + p.method.slice(1).toLowerCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(p.date)}</TableCell>
                          <TableCell className="text-muted-foreground">{p.notes ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'files' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Files</CardTitle>
            </CardHeader>
            <CardContent>
              {uploadOpen && (
                <div className="mb-6">
                  <FileUpload freelanceProjectId={id} />
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setUploadOpen(false)}>
                    Cancel
                  </Button>
                </div>
              )}
              <FileList files={filesData} isLoading={filesLoading} freelanceProjectId={id} />
            </CardContent>
          </Card>
        )}
      </div>

      <FreelanceForm project={project} open={editOpen} onOpenChange={setEditOpen} />
      <WorkLogForm project={project} open={logWorkOpen} onOpenChange={setLogWorkOpen} />
      <PaymentForm
        freelanceProjectId={id}
        freelanceProjectName={`${project.clientName} — ${project.workType}`}
        open={paymentOpen}
        onOpenChange={(open) => {
          setPaymentOpen(open)
          if (!open) {
            // refresh happens via react-query invalidation
          }
        }}
      />
    </div>
  )
}
