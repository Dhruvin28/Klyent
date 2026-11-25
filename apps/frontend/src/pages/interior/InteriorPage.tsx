import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileStack, Loader2, Plus, Ruler, ScanLine, ShieldCheck, Trash2 } from 'lucide-react'
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
import { interiorApi } from '@/api/interior'
import { apiErrorMessage } from '@/api/visualizer'
import { useClients } from '@/hooks/useClients'
import { interiorKeys, useInteriorStatus, useInteriorWorkspaces, usePageImageUrl } from '@/hooks/useInterior'

export function InteriorPage() {
  const [newOpen, setNewOpen] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const { data: list, isLoading } = useInteriorWorkspaces()
  const { data: status } = useInteriorStatus()
  const qc = useQueryClient()
  const { toast } = useToast()

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Interior 3D</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Reconstruct a dimensionally accurate 3D interior from your drawing set (plans, ceiling plans, elevations, sections), verify it against every dimension, approve it, then render
            consistent perspectives, elevations, top and ceiling views from that exact model.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" /> New reconstruction
        </Button>
      </div>

      {status && !status.aiConfigured && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          OPENAI_API_KEY is not set on the server: drawings can be uploaded and calibrated, but automatic interpretation is unavailable.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: FileStack, title: 'Drawings are evidence', text: 'PDF (vector or scanned), DXF and plan images. Every page keeps its own scale.' },
          { icon: ScanLine, title: `AI reads, geometry decides`, text: `${status?.model ?? 'The model'} interprets each sheet; walls and dimensions are snapped to the real line work.` },
          { icon: Ruler, title: 'Nothing is guessed silently', text: 'Missing heights or conflicts become questions. Answers are recorded as designer decisions.' },
          { icon: ShieldCheck, title: 'Approve, then render', text: 'Renders are tied to an exact, validated scene hash. Edits create a new revision.' },
        ].map((f) => (
          <div key={f.title} className="rounded-lg border bg-card p-3">
            <f.icon className="mb-1.5 h-4 w-4 text-primary" />
            <p className="text-sm font-medium">{f.title}</p>
            <p className="text-xs text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !list?.length ? (
        <EmptyState icon={FileStack} title="No reconstructions yet" description="Create one and upload the drawing set for a room or apartment." action={{ label: 'New reconstruction', onClick: () => setNewOpen(true) }} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((w) => (
            <Card key={w.id} className="group overflow-hidden transition-colors hover:border-primary">
              <Link to={`/interior/${w.id}`} className="block">
                <Thumb pageId={w.thumbPageId} />
              </Link>
              <CardContent className="flex items-start justify-between gap-2 p-3">
                <Link to={`/interior/${w.id}`} className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    {w.name}
                    {w.approvedRevisionId && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Approved" />}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {w.clientName ? `${w.clientName} · ` : ''}
                    {w.documents} drawing{w.documents === 1 ? '' : 's'} · {w.mode} · {format(new Date(w.updatedAt), 'd MMM yyyy')}
                  </p>
                </Link>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirm(w.id)} aria-label={`Delete ${w.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewDialog open={newOpen} onOpenChange={setNewOpen} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete reconstruction?"
        description="Drawings, revisions, validation history and approvals are permanently deleted. A design already opened in the 3D Designer is kept."
        confirmLabel="Delete"
        isLoading={deleting}
        onConfirm={async () => {
          setDeleting(true)
          try {
            await interiorApi.deleteWorkspace(confirm!)
            await qc.invalidateQueries({ queryKey: interiorKeys.workspaces })
            setConfirm(null)
          } catch (err) {
            toast({ title: 'Delete failed', description: apiErrorMessage(err), variant: 'destructive' })
          } finally {
            setDeleting(false)
          }
        }}
      />
    </div>
  )
}

function Thumb({ pageId }: { pageId: string | null }) {
  const url = usePageImageUrl(pageId)
  if (!pageId) return <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground"><FileStack className="h-5 w-5" /></div>
  return url ? <img src={url} alt="" className="aspect-video w-full bg-white object-contain" draggable={false} /> : <div className="aspect-video w-full animate-pulse bg-muted" />
}

function NewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: clientsPage } = useClients({ limit: 100 })
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [mode, setMode] = useState<'strict' | 'draft'>('strict')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const s = await interiorApi.createWorkspace({ name: name.trim() || 'Untitled reconstruction', clientId: clientId || null, mode })
      onOpenChange(false)
      navigate(`/interior/${s.workspace.id}`)
    } catch (err) {
      toast({ title: 'Could not create', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New reconstruction</DialogTitle>
          <DialogDescription>One reconstruction per drawing set (a room, apartment or floor).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="iw-name">Name</Label>
            <Input id="iw-name" value={name} maxLength={255} placeholder="e.g. Mehta residence — living & master bedroom" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="iw-client">Client (optional)</Label>
            <select id="iw-client" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client</option>
              {clientsPage?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Accuracy mode</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['strict', 'Strict', 'Missing heights, unverified scale and dimension conflicts block final approval.'],
                  ['draft', 'Draft', 'Provisional assumptions allowed; every output is labelled DRAFT.'],
                ] as const
              ).map(([k, label, text]) => (
                <button key={k} type="button" onClick={() => setMode(k)} className={cn('rounded-lg border p-3 text-left', mode === k ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'hover:bg-muted')}>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{text}</p>
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
