import { useState } from 'react'
import { format } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Clapperboard, Download, Orbit, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/components/ui/toast'
import { designerApi } from '@/api/designer'
import { apiErrorMessage } from '@/api/visualizer'
import { useDesignAssetUrl, useDesignRenders } from '@/hooks/useDesigner'
import type { DesignRender } from '@/lib/designer/types'
import { PanoramaViewer } from './PanoramaViewer'

const KIND_LABEL = { render: 'Image', panorama: '360°', video: 'Video' } as const

export function RendersDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string }) {
  const { data: renders, isLoading } = useDesignRenders(projectId)
  const [viewing, setViewing] = useState<DesignRender | null>(null)
  const [confirm, setConfirm] = useState<DesignRender | null>(null)
  const [deleting, setDeleting] = useState(false)
  const qc = useQueryClient()
  const { toast } = useToast()

  const remove = async () => {
    if (!confirm) return
    setDeleting(true)
    try {
      await designerApi.deleteRender(confirm.id)
      await qc.invalidateQueries({ queryKey: ['designer', 'renders', projectId] })
      if (viewing?.id === confirm.id) setViewing(null)
      setConfirm(null)
    } catch (err) {
      toast({ title: 'Delete failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && setViewing(null))}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {viewing && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewing(null)} aria-label="Back to gallery">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {viewing ? viewing.name : 'Renders'}
          </DialogTitle>
          <DialogDescription>{viewing ? `${KIND_LABEL[viewing.kind]} · ${viewing.width}×${viewing.height}` : 'Still images, 360° panoramas and walkthrough videos for this design.'}</DialogDescription>
        </DialogHeader>
        {viewing ? (
          <RenderViewer render={viewing} onDelete={() => setConfirm(viewing)} />
        ) : isLoading ? (
          <LoadingSpinner />
        ) : renders?.length ? (
          <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
            {renders.map((r) => (
              <button key={r.id} type="button" className="group overflow-hidden rounded-lg border text-left hover:border-primary" onClick={() => setViewing(r)}>
                <RenderThumb render={r} />
                <div className="space-y-0.5 p-2">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">{KIND_LABEL[r.kind]}</Badge>
                    <span className="text-[11px] text-muted-foreground">{format(new Date(r.createdAt), 'd MMM, HH:mm')}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">No renders yet. Use Render to create a photoreal image, a 360° panorama or a walkthrough video.</p>
        )}
        <ConfirmDialog
          open={!!confirm}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={`Delete “${confirm?.name}”?`}
          description="It is removed from this project and from any tour links that include it."
          confirmLabel="Delete"
          isLoading={deleting}
          onConfirm={remove}
        />
      </DialogContent>
    </Dialog>
  )
}

export function RenderThumb({ render, className = 'aspect-video w-full' }: { render: DesignRender; className?: string }) {
  const { url } = useDesignAssetUrl(render.kind === 'video' ? null : render.id)
  if (render.kind === 'video') {
    return (
      <div className={`flex items-center justify-center bg-zinc-900 text-zinc-300 ${className}`}>
        <Clapperboard className="h-8 w-8" />
      </div>
    )
  }
  return (
    <div className={`relative bg-muted ${className}`}>
      {url && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
      {render.kind === 'panorama' && <Orbit className="absolute right-2 top-2 h-5 w-5 rounded-full bg-black/60 p-0.5 text-white" />}
    </div>
  )
}

function RenderViewer({ render, onDelete }: { render: DesignRender; onDelete: () => void }) {
  const { url, isLoading } = useDesignAssetUrl(render.id)
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg bg-black">
        {!url || isLoading ? (
          <div className="flex aspect-video items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : render.kind === 'panorama' ? (
          <PanoramaViewer src={url} className="aspect-video w-full" />
        ) : render.kind === 'video' ? (
          <video src={url} controls autoPlay className="max-h-[65vh] w-full" />
        ) : (
          <img src={url} alt={render.name} className="max-h-[65vh] w-full object-contain" />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="gap-1 hover:text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        {url && (
          <Button size="sm" className="gap-1" asChild>
            <a href={url} download={`${render.name}.${render.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin'}`}>
              <Download className="h-4 w-4" /> Download
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}
