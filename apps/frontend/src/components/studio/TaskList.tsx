import { CheckSquare } from 'lucide-react'
import { useStudioTasks, useUpdateStudioTask } from '@/hooks/useStudio'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { StudioTask } from '@/types'

const PRIORITY_VARIANT: Record<StudioTask['priority'], 'default' | 'secondary' | 'destructive'> = {
  low: 'secondary',
  medium: 'default',
  high: 'destructive',
}

export function TaskList({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading } = useStudioTasks(projectId)
  const updateTask = useUpdateStudioTask()

  if (isLoading) return <LoadingSpinner className="py-12" />
  if (!tasks || tasks.length === 0) {
    return <EmptyState icon={CheckSquare} title="No tasks yet" description="Tasks mentioned in conversations or documents are extracted here automatically." />
  }

  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{t.title}</span>
              <Badge variant={PRIORITY_VARIANT[t.priority]}>{t.priority}</Badge>
            </div>
            {t.description && <p className="text-muted-foreground mt-1">{t.description}</p>}
            {t.dueDate && <p className="text-xs text-muted-foreground mt-1">Due {new Date(t.dueDate).toLocaleDateString()}</p>}
          </div>
          <Select
            value={t.status}
            onValueChange={(status) => updateTask.mutate({ id: t.id, data: { status: status as StudioTask['status'] } })}
          >
            <SelectTrigger className="w-32 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  )
}
