import { useStudioMessages } from '@/hooks/useStudio'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { MessageSquare } from 'lucide-react'

export function MessageFeed({ projectId }: { projectId: string }) {
  const { data: messages, isLoading } = useStudioMessages(projectId)

  if (isLoading) return <LoadingSpinner className="py-12" />
  if (!messages || messages.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No messages yet"
        description="Import a WhatsApp chat export (see the Import tab) or wait for live ingestion to populate conversation history."
      />
    )
  }

  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <div key={m.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="font-medium text-foreground">{m.sender || 'Unknown'}</span>
            <span>{new Date(m.timestamp).toLocaleString()}</span>
          </div>
          <p className="whitespace-pre-wrap">{m.content || <em className="text-muted-foreground">[{m.messageType}]</em>}</p>
        </div>
      ))}
    </div>
  )
}
