import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, FolderKanban, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { StudioProjectForm } from '@/components/studio/StudioProjectForm'
import { useStudioProjects } from '@/hooks/useStudio'

export function StudioProjectsPage() {
  const { data: projects, isLoading } = useStudioProjects()
  const [isFormOpen, setIsFormOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">AI Studio</h1>
          <p className="text-sm text-muted-foreground">
            WhatsApp project knowledge engine — ingest conversations & documents, ask questions, get sourced answers.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/studio/ask">
            <Button variant="outline" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Ask
            </Button>
          </Link>
          <Button onClick={() => setIsFormOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !projects || projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No studio projects yet"
          description="Create a project, then import a WhatsApp chat export or upload documents to start building its knowledge base."
          action={{ label: 'New Project', onClick: () => setIsFormOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id} to={`/studio/${p.id}`}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <Badge variant={p.status === 'ACTIVE' ? 'default' : 'secondary'}>{p.status}</Badge>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                  {p.clientName && <p>Client: {p.clientName}</p>}
                  {p.siteAddress && <p className="truncate">{p.siteAddress}</p>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <StudioProjectForm open={isFormOpen} onOpenChange={setIsFormOpen} />
    </div>
  )
}
