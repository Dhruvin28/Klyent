import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'
import { useStudioProject } from '@/hooks/useStudio'
import { MessageFeed } from '@/components/studio/MessageFeed'
import { DocumentUpload } from '@/components/studio/DocumentUpload'
import { TaskList } from '@/components/studio/TaskList'
import { DecisionList } from '@/components/studio/DecisionList'
import { QuoteTable } from '@/components/studio/QuoteTable'
import { ImportPanel } from '@/components/studio/ImportPanel'

const TABS = ['Overview', 'Messages', 'Documents', 'Tasks', 'Decisions', 'Quotes', 'Import'] as const
type Tab = (typeof TABS)[number]

export function StudioProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: project, isLoading } = useStudioProject(id!)
  const [tab, setTab] = useState<Tab>('Overview')

  if (isLoading) return <LoadingSpinner className="py-16" />
  if (!project) return <p className="text-muted-foreground">Project not found.</p>

  return (
    <div className="space-y-6">
      <div>
        <Link to="/studio" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-4 w-4" /> Back to AI Studio
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'}>{project.status}</Badge>
        </div>
        {project.clientName && <p className="text-sm text-muted-foreground">Client: {project.clientName}</p>}
      </div>

      <div className="flex gap-1 border-b overflow-x-auto scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <InfoRow label="Project type" value={project.projectType} />
          <InfoRow label="Budget" value={project.budget ? `₹${project.budget}` : undefined} />
          <InfoRow label="Site address" value={project.siteAddress} />
          <InfoRow label="Timeline notes" value={project.timelineNotes} />
        </div>
      )}
      {tab === 'Messages' && <MessageFeed projectId={project.id} />}
      {tab === 'Documents' && <DocumentUpload projectId={project.id} />}
      {tab === 'Tasks' && <TaskList projectId={project.id} />}
      {tab === 'Decisions' && <DecisionList projectId={project.id} />}
      {tab === 'Quotes' && <QuoteTable projectId={project.id} />}
      {tab === 'Import' && <ImportPanel projectId={project.id} />}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">{value || '—'}</p>
    </div>
  )
}
