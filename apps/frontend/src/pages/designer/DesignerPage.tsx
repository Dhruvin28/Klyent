import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { Box, ImageOff, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { designerApi } from '@/api/designer'
import { apiErrorMessage } from '@/api/visualizer'
import { useClients } from '@/hooks/useClients'
import { useDeleteDesignProject, useDesignAssetUrl, useDesignProjects } from '@/hooks/useDesigner'
import { TEMPLATES, templatePlan, type TemplateKey } from '@/lib/designer/templates'

export function DesignerPage() {
  const [newOpen, setNewOpen] = useState(false)
  const { data: projects, isLoading } = useDesignProjects()
  const del = useDeleteDesignProject()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">3D Designer</h1>
          <p className="text-sm text-muted-foreground">
            Draw or trace a floor plan, furnish it in 3D, apply your library finishes, and render photoreal images, 360° tours and walkthroughs.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" /> New design
        </Button>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !projects?.length ? (
        <EmptyState
          icon={Box}
          title="No designs yet"
          description="Start from a blank plan, a room template, or trace your client’s floor plan image."
          action={{ label: 'New design', onClick: () => setNewOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((p) => (
            <Card key={p.id} className="group overflow-hidden transition-colors hover:border-primary">
              <Link to={`/designer/${p.id}`} className="block">
                <Thumb id={p.thumbnailAssetId} />
              </Link>
              <CardContent className="flex items-start justify-between gap-2 p-3">
                <Link to={`/designer/${p.id}`} className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.clientName ? `${p.clientName} · ` : ''}
                    {format(new Date(p.updatedAt), 'd MMM yyyy')}
                  </p>
                </Link>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirm(p.id)} aria-label={`Delete ${p.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewDesignDialog open={newOpen} onOpenChange={setNewOpen} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete design?"
        description="The plan, its renders and tour links are permanently deleted. Your model catalog and material library are kept."
        confirmLabel="Delete"
        isLoading={del.isPending}
        onConfirm={() =>
          del.mutate(confirm!, {
            onSuccess: () => setConfirm(null),
            onError: (err) => toast({ title: 'Delete failed', description: apiErrorMessage(err), variant: 'destructive' }),
          })
        }
      />
    </div>
  )
}

function Thumb({ id }: { id: string | null }) {
  const { url } = useDesignAssetUrl(id)
  if (!id) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground">
        <ImageOff className="h-5 w-5" />
      </div>
    )
  }
  return url ? <img src={url} alt="" className="aspect-video w-full object-cover" draggable={false} /> : <div className="aspect-video w-full animate-pulse bg-muted" />
}

function NewDesignDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: clientsPage } = useClients({ limit: 100 })
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [template, setTemplate] = useState<TemplateKey>('blank')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const p = await designerApi.createProject({ name: name.trim() || TEMPLATES[template].label, clientId: clientId || null, plan: templatePlan(template) })
      onOpenChange(false)
      navigate(`/designer/${p.id}`)
    } catch (err) {
      toast({ title: 'Could not create design', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New design</DialogTitle>
          <DialogDescription>You can upload and trace a floor plan image from inside the editor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="dz-name">Name</Label>
            <Input id="dz-name" value={name} maxLength={255} placeholder="e.g. Sharma residence — 2BHK" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dz-client">Client (optional)</Label>
            <select id="dz-client" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client</option>
              {clientsPage?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Start from</Label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TEMPLATES) as TemplateKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTemplate(k)}
                  className={cn('rounded-lg border p-3 text-left', template === k ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'hover:bg-muted')}
                >
                  <p className="text-sm font-medium">{TEMPLATES[k].label}</p>
                  <p className="text-xs text-muted-foreground">{TEMPLATES[k].description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
