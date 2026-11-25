import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { FileSpreadsheet, Loader2, Palette, Pencil, Plus, Trash2, Upload, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/ui/toast'
import { MaterialSwatch, Segmented, VizAssetImage } from '@/components/visualizer/common'
import { MaterialDialog } from '@/components/visualizer/MaterialDialog'
import { ImportPaintsDialog } from '@/components/visualizer/ImportPaintsDialog'
import { useDeleteVizMaterial, useDeleteVizProject, useVizMaterials, useVizProjects } from '@/hooks/useVisualizer'
import { useClients } from '@/hooks/useClients'
import { apiErrorMessage, visualizerApi } from '@/api/visualizer'
import { createReference } from '@/lib/visualizer/imageio'
import type { VizMaterial } from '@/lib/visualizer/types'

export function VisualizerPage() {
  const [tab, setTab] = useState<'projects' | 'materials'>('projects')
  const [newOpen, setNewOpen] = useState(false)
  const [materialOpen, setMaterialOpen] = useState<{ material: VizMaterial | null; kind: 'texture' | 'paint' } | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Material Visualizer</h1>
          <p className="text-sm text-muted-foreground">
            Apply laminates, tiles and paint to surfaces in a room render — everything outside the selection stays pixel-identical.
          </p>
        </div>
        <div className="flex gap-2">
          {tab === 'materials' ? (
            <>
              <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)} data-testid="viz-import-paints">
                <FileSpreadsheet className="h-4 w-4" /> Import colours
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => setMaterialOpen({ material: null, kind: 'paint' })}>
                <Palette className="h-4 w-4" /> Paint colour
              </Button>
              <Button className="gap-2" onClick={() => setMaterialOpen({ material: null, kind: 'texture' })}>
                <Plus className="h-4 w-4" /> Sample
              </Button>
            </>
          ) : (
            <Button className="gap-2" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> New visualization
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-xs">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'projects', label: 'Projects' },
            { value: 'materials', label: 'Material library' },
          ]}
        />
      </div>

      {tab === 'projects' ? (
        <ProjectGrid onNew={() => setNewOpen(true)} />
      ) : (
        <MaterialLibrary onEdit={(m) => setMaterialOpen({ material: m, kind: m.kind })} onNew={() => setMaterialOpen({ material: null, kind: 'texture' })} />
      )}

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
      <ImportPaintsDialog open={importOpen} onOpenChange={setImportOpen} />
      <MaterialDialog
        open={!!materialOpen}
        onOpenChange={(o) => !o && setMaterialOpen(null)}
        material={materialOpen?.material ?? null}
        defaultKind={materialOpen?.kind ?? 'texture'}
      />
    </div>
  )
}

function ProjectGrid({ onNew }: { onNew: () => void }) {
  const { data: projects, isLoading } = useVizProjects()
  const del = useDeleteVizProject()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState<string | null>(null)

  if (isLoading) return <LoadingSpinner />
  if (!projects?.length) {
    return (
      <EmptyState
        icon={Wand2}
        title="No visualizations yet"
        description="Upload a bedroom, kitchen or living-room render, select a surface and try laminates, tiles or paint on it."
        action={{ label: 'New visualization', onClick: onNew }}
      />
    )
  }
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {projects.map((p) => (
          <Card key={p.id} className="group overflow-hidden transition-colors hover:border-primary">
            <Link to={`/visualizer/${p.id}`} className="block">
              <VizAssetImage id={p.thumbnailAssetId} alt={p.name} className="aspect-video w-full object-cover" />
            </Link>
            <CardContent className="flex items-start justify-between gap-2 p-3">
              <Link to={`/visualizer/${p.id}`} className="min-w-0">
                <p className="truncate font-medium">{p.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.clientName ? `${p.clientName} · ` : ''}
                  {p.width}×{p.height} · {format(new Date(p.updatedAt), 'd MMM yyyy')}
                </p>
              </Link>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirm(p.id)} aria-label={`Delete ${p.name}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete visualization?"
        description="The render, all selections, options and exports in this project are permanently deleted. Library materials are kept."
        confirmLabel="Delete"
        isLoading={del.isPending}
        onConfirm={() =>
          del.mutate(confirm!, {
            onSuccess: () => setConfirm(null),
            onError: (err) => toast({ title: 'Delete failed', description: apiErrorMessage(err), variant: 'destructive' }),
          })
        }
      />
    </>
  )
}

function MaterialLibrary({ onEdit, onNew }: { onEdit: (m: VizMaterial) => void; onNew: () => void }) {
  const { data: materials, isLoading } = useVizMaterials()
  const del = useDeleteVizMaterial()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState<VizMaterial | null>(null)

  if (isLoading) return <LoadingSpinner />
  if (!materials?.length) {
    return (
      <EmptyState
        icon={Palette}
        title="Your material library is empty"
        description="Add laminate, veneer and tile samples from photos, or paint colours by code. Materials are reusable across every project."
        action={{ label: 'Add a sample', onClick: onNew }}
      />
    )
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {materials.map((m) => (
          <Card key={m.id} className="overflow-hidden">
            <MaterialSwatch material={m} className="aspect-square w-full rounded-none border-0 border-b" />
            <CardContent className="space-y-1 p-2.5">
              <p className="truncate text-sm font-medium" title={m.name}>{m.name}</p>
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant="secondary" className="text-[10px] capitalize">{m.category}</Badge>
                {m.kind === 'texture' && m.widthMm && m.heightMm && (
                  <span className="text-[10px] text-muted-foreground">{Math.round(m.widthMm)}×{Math.round(m.heightMm)} mm</span>
                )}
                {m.kind === 'paint' && <span className="font-mono text-[10px] text-muted-foreground">{m.colorHex}</span>}
              </div>
              {(m.brand || m.code) && <p className="truncate text-[11px] text-muted-foreground">{[m.brand, m.code].filter(Boolean).join(' · ')}</p>}
              <div className="flex justify-end gap-1 pt-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(m)} aria-label={`Edit ${m.name}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => setConfirm(m)} aria-label={`Delete ${m.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete “${confirm?.name}”?`}
        description="Materials that are applied in a project option cannot be deleted until they are removed from it."
        confirmLabel="Delete"
        isLoading={del.isPending}
        onConfirm={() =>
          del.mutate(confirm!.id, {
            onSuccess: () => setConfirm(null),
            onError: (err) => toast({ title: 'Cannot delete material', description: apiErrorMessage(err), variant: 'destructive' }),
          })
        }
      />
    </>
  )
}

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: clientsPage } = useClients({ limit: 100 })
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const reset = () => {
    setFile(null)
    setName('')
    setClientId('')
  }

  const create = async () => {
    if (!file) return
    try {
      setBusy('Preparing lossless reference…')
      const { reference, thumbnail } = await createReference(file)
      setBusy('Uploading…')
      const project = await visualizerApi.createProject(
        { name: name.trim() || file.name.replace(/\.[^.]+$/, ''), clientId: clientId || null, original: file, reference, thumbnail },
        (f) => setBusy(`Uploading… ${Math.round(f * 100)}%`)
      )
      await qc.invalidateQueries({ queryKey: ['visualizer', 'projects'] })
      onOpenChange(false)
      reset()
      navigate(`/visualizer/${project.id}`)
    } catch (err) {
      toast({ title: 'Could not create project', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset() } }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New visualization</DialogTitle>
          <DialogDescription>Upload the room render. It is kept unchanged as the reference — every option is compared against it pixel by pixel.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:border-primary hover:text-foreground">
            <Upload className="h-6 w-6" />
            <span className="max-w-full truncate px-4">{file ? file.name : 'Choose a JPG, PNG or WebP render'}</span>
            {file && <span className="text-xs">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
              }}
            />
          </label>
          <div className="space-y-1">
            <Label htmlFor="viz-name">Project name</Label>
            <Input id="viz-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma residence — master bedroom" maxLength={255} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="viz-client">Client (optional)</Label>
            <select id="viz-client" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client</option>
              {clientsPage?.data.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">Up to 8192 px per side and 25 megapixels. Use the highest-quality export of the render you have.</p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>Cancel</Button>
          <Button onClick={create} disabled={!file || !!busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ?? 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
