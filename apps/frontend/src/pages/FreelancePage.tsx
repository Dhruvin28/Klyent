import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Briefcase, Eye, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { FreelanceForm } from '@/components/freelance/FreelanceForm'
import { useFreelanceProjects, useDeleteFreelanceProject } from '@/hooks/useFreelance'
import { useToast } from '@/components/ui/toast'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { FreelanceProject } from '@/types'

const statusColors: Record<string, string> = {
  ACTIVE: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  COMPLETED: 'border-transparent bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
}

export function FreelancePage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<string>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<FreelanceProject | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { toast } = useToast()

  const { data, isLoading } = useFreelanceProjects({ status: status || undefined })
  const deleteProject = useDeleteFreelanceProject()

  const projects = data?.data ?? []

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      await deleteProject.mutateAsync(deletingId)
      toast({ title: 'Project deleted' })
    } catch {
      toast({ title: 'Error', description: 'Failed to delete project.', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Freelance Work</h2>
          <p className="text-sm text-muted-foreground">Track hourly, page-wise, or sheet-wise projects</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
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
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5 space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No freelance projects"
          description="Create your first freelance project to start tracking work and billing."
          action={{ label: 'New Project', onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{project.clientName}</p>
                    <p className="text-sm text-muted-foreground truncate">{project.workType}</p>
                  </div>
                  <Badge className={statusColors[project.status]}>{project.status}</Badge>
                </div>

                <div className="text-xs text-muted-foreground">
                  {project.chargeType} @ {formatCurrency(project.rate)} each
                </div>

                <div className="grid grid-cols-3 gap-2 text-center py-2 border rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground">Billed</p>
                    <p className="text-sm font-semibold">{formatCurrency(project.totalBilled)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Paid</p>
                    <p className="text-sm font-semibold text-green-600 dark:text-green-400">{formatCurrency(project.totalPaid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pending</p>
                    <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">{formatCurrency(project.remainingBalance)}</p>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">Created {formatDate(project.createdAt)}</div>

                <div className="flex items-center justify-end gap-1 pt-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/freelance/${project.id}`)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingProject(project)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeletingId(project.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FreelanceForm open={createOpen} onOpenChange={setCreateOpen} />
      {editingProject && (
        <FreelanceForm project={editingProject} open={!!editingProject} onOpenChange={(open) => { if (!open) setEditingProject(null) }} />
      )}
      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null) }}
        title="Delete Project"
        description="This will permanently delete the project, all work logs, payments, and files. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        isLoading={deleteProject.isPending}
      />
    </div>
  )
}
