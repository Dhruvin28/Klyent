import { useEffect, useState } from 'react'
import { ImageUp, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { apiErrorMessage, visualizerApi } from '@/api/visualizer'
import { createReference } from '@/lib/visualizer/imageio'
import { resizeMask } from '@/lib/visualizer/resample'
import type { VizState } from '@/lib/visualizer/types'
import type { VizEditor } from './useVizEditor'

/**
 * Swaps in a re-rendered image of the same view (e.g. after a lighting tweak or a
 * furniture change) while keeping every surface, selection, perspective and option.
 */
export function ReplaceRenderDialog({ open, onOpenChange, editor, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; editor: VizEditor; projectId: string }) {
  const { toast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<string | null>(null)
  useEffect(() => {
    if (open) setFile(null)
  }, [open])

  const run = async () => {
    const engine = editor.engine.current
    if (!file || !engine) return
    try {
      setStep('Saving current work…')
      if (!(await editor.save())) throw new Error(editor.saveError ?? 'The project could not be saved. Reload and try again.')
      setStep('Reading the new render…')
      const { pixels, reference, thumbnail } = await createReference(file)
      const W = pixels.width
      const H = pixels.height
      if (Math.abs(W / H - editor.W / editor.H) > 0.01) {
        throw new Error(`The new render is ${W}×${H}; it must be the same view with the same aspect ratio as ${editor.W}×${editor.H}.`)
      }
      setStep('Carrying over selections…')
      const sx = W / editor.W
      const sy = H / editor.H
      const masks: Record<string, Blob> = {}
      for (const [key, data] of editor.nonEmptyMasks()) {
        masks[key] = await engine.encodeMask(W, H, resizeMask(data, editor.W, editor.H, W, H))
      }
      const s = editor.state
      const state: VizState = {
        ...s,
        surfaces: s.surfaces.map((x) => ({
          ...x,
          // Edge softness is in pixels: keep it the same on screen at the new resolution.
          feather: Math.min(20, Math.round(x.feather * sx * 4) / 4),
          quad: x.quad ? (x.quad.map(([qx, qy]) => [qx * sx, qy * sy]) as typeof x.quad) : null,
        })),
        calibration: s.calibration ? { ...s.calibration, point: [Math.round(s.calibration.point[0] * sx), Math.round(s.calibration.point[1] * sy)] } : s.calibration,
      }
      setStep('Uploading…')
      await visualizerApi.replaceRender(projectId, { revision: editor.revision(), state, original: file, reference, thumbnail, masks })
      toast({ title: 'Render replaced', description: 'Selections and options were kept. Re-check outlines where the scene changed.' })
      // Reload so every cache (engine, AI embeddings, textures) starts from the new render.
      window.location.reload()
    } catch (err) {
      toast({ title: 'Could not replace the render', description: apiErrorMessage(err), variant: 'destructive' })
      setStep(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !step && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ImageUp className="h-5 w-5" /> Replace render</DialogTitle>
          <DialogDescription>
            Upload a new render of the same camera view (same aspect ratio, any resolution). Surfaces, selections, perspective corners and options are kept and
            rescaled. Verified exports and review links keep their own images.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
          <ImageUp className="h-6 w-6" />
          <span>{file ? file.name : 'Choose the new render (JPG, PNG, WebP)'}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="viz-replace-file" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!step}>Cancel</Button>
          <Button onClick={run} disabled={!file || !!step} className="gap-2" data-testid="viz-replace-run">
            {step && <Loader2 className="h-4 w-4 animate-spin" />} {step ?? 'Replace render'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
