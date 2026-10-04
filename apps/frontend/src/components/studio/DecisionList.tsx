import { Gavel } from 'lucide-react'
import { useStudioDecisions } from '@/hooks/useStudio'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'

export function DecisionList({ projectId }: { projectId: string }) {
  const { data: decisions, isLoading } = useStudioDecisions(projectId)

  if (isLoading) return <LoadingSpinner className="py-12" />
  if (!decisions || decisions.length === 0) {
    return <EmptyState icon={Gavel} title="No decisions recorded yet" description="Approvals and finalizations mentioned in conversations/documents are extracted here automatically." />
  }

  return (
    <div className="space-y-2">
      {decisions.map((d) => (
        <div key={d.id} className="rounded-lg border p-3 text-sm">
          <p className="font-medium">{d.topic}</p>
          <p className="text-muted-foreground mt-1">{d.decision}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
            {d.decisionBy && <span>By {d.decisionBy}</span>}
            <span>{new Date(d.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
