import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { WorkLogForm } from './WorkLogForm'
import { useDeleteWorkLog } from '@/hooks/useFreelance'
import { useToast } from '@/components/ui/toast'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { FreelanceProject, FreelanceWorkLog } from '@/types'

interface WorkLogListProps {
  project: FreelanceProject
  logs: FreelanceWorkLog[]
}

export function WorkLogList({ project, logs }: WorkLogListProps) {
  const [editingLog, setEditingLog] = useState<FreelanceWorkLog | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleteLog = useDeleteWorkLog(project.id)
  const { toast } = useToast()

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      await deleteLog.mutateAsync(deletingId)
      toast({ title: 'Work log deleted' })
    } catch {
      toast({ title: 'Error', description: 'Failed to delete work log.', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No work logged yet. Click "Log Work" to record completed work.
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>{project.chargeType}</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-muted-foreground">{formatDate(log.date)}</TableCell>
                <TableCell className="font-medium">{log.quantity}</TableCell>
                <TableCell className="font-semibold text-primary">{formatCurrency(log.amount)}</TableCell>
                <TableCell className="text-muted-foreground max-w-xs truncate">{log.description ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingLog(log)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeletingId(log.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingLog && (
        <WorkLogForm
          project={project}
          log={editingLog}
          open={!!editingLog}
          onOpenChange={(open) => { if (!open) setEditingLog(null) }}
        />
      )}

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null) }}
        title="Delete Work Log"
        description="Are you sure you want to delete this work log? The billed amount will be recalculated."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        isLoading={deleteLog.isPending}
      />
    </>
  )
}
