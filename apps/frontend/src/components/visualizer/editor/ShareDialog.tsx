import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { BadgeCheck, Copy, ExternalLink, Link2, Loader2, MessageSquare, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { apiErrorMessage, visualizerApi, type VizShare } from '@/api/visualizer'
import { useLogoDataUrl } from '@/hooks/useLogoDataUrl'
import { useAuthStore } from '@/store/auth.store'
import { SQFT_PER_SQM, estimateOption } from '@/lib/visualizer/estimate'
import { toJpeg } from '@/lib/visualizer/outputs'
import { optionAreas } from './EstimateDialog'
import type { VizEditor } from './useVizEditor'

export const reviewUrl = (token: string) => `${window.location.origin}/visualizer/review/${token}`

/** Review links for the client: pick options, publish rendered copies, follow comments and approvals. */
export function ShareDialog({ open, onOpenChange, editor, projectId, projectName }: { open: boolean; onOpenChange: (o: boolean) => void; editor: VizEditor; projectId: string; projectName: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const logo = useLogoDataUrl()
  const user = useAuthStore((s) => s.user)
  // Poll while open so client approvals and comments show up without reopening.
  const { data: shares, isLoading, refetch } = useQuery({
    queryKey: ['visualizer', 'shares', projectId],
    queryFn: () => visualizerApi.listShares(projectId),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  })
  const [title, setTitle] = useState(projectName)
  const [message, setMessage] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [showPrices, setShowPrices] = useState(false)
  const [expires, setExpires] = useState<number | null>(30)
  const [watermark, setWatermark] = useState(true)
  const [step, setStep] = useState<string | null>(null)
  const [revoke, setRevoke] = useState<VizShare | null>(null)
  const [openShare, setOpenShare] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void refetch()
    setTitle(projectName)
    setPicked(editor.state.options.filter((o) => Object.keys(o.assignments).length).map((o) => o.id))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const img = editor.original.current
    if (!img || !picked.length) return
    try {
      const wm = watermark && (logo || user?.companyName) ? { logo, text: user?.companyName ?? null } : null
      setStep('Preparing the original…')
      const original = await toJpeg({ pixels: new Uint8ClampedArray(img.data), width: editor.W, height: editor.H }, { maxSide: 2560, quality: 0.86, watermark: wm })
      const images: Blob[] = []
      const options = []
      for (const id of picked) {
        const o = editor.state.options.find((x) => x.id === id)
        if (!o) continue
        setStep(`Rendering ${o.name}…`)
        const f = await editor.renderOption(o.id)
        images.push(await toJpeg({ pixels: f.pixels, width: f.width, height: f.height }, { maxSide: 2560, quality: 0.86, watermark: wm }))
        const est = estimateOption(optionAreas(editor, o), editor.materials)
        options.push({
          optionId: o.id,
          name: o.name,
          notes: o.notes,
          total: est.lines.length && est.unpriced < est.lines.length ? est.total : null,
          areaSqft: est.areaSqm ? Math.round(est.areaSqm * SQFT_PER_SQM * 10) / 10 : null,
          materials: est.lines.map((l) => ({ name: l.material.name, brand: l.material.brand, code: l.material.code, surfaces: l.surfaces })),
        })
      }
      setStep('Publishing…')
      const share = await visualizerApi.createShare(projectId, { title: title.trim() || projectName, message: message.trim(), showPrices, expiresInDays: expires, options }, original, images)
      await qc.invalidateQueries({ queryKey: ['visualizer', 'shares', projectId] })
      await navigator.clipboard?.writeText(reviewUrl(share.token)).catch(() => undefined)
      setOpenShare(share.id)
      toast({ title: 'Review link created', description: 'The link is copied — send it to your client.' })
    } catch (err) {
      toast({ title: 'Could not create the link', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setStep(null)
    }
  }

  const copy = async (s: VizShare) => {
    try {
      await navigator.clipboard.writeText(reviewUrl(s.token))
      toast({ title: 'Link copied' })
    } catch {
      toast({ title: reviewUrl(s.token) })
    }
  }

  const whatsapp = (s: VizShare) =>
    `https://wa.me/?text=${encodeURIComponent(`${s.title}: please review the design options and tell us which you prefer — ${reviewUrl(s.token)}`)}`

  return (
    <Dialog open={open} onOpenChange={(o) => !step && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Share with client</DialogTitle>
          <DialogDescription>
            A private link where the client compares the options (with a before/after swipe), comments and approves one — no login needed. The link shows
            rendered copies; later edits in the editor do not change it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium">Title</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Link expires</span>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={expires ?? ''} onChange={(e) => setExpires(e.target.value ? Number(e.target.value) : null)} aria-label="Expiry">
                <option value={7}>In 7 days</option>
                <option value={30}>In 30 days</option>
                <option value={90}>In 90 days</option>
                <option value="">Never</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Message to the client (optional)</span>
            <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="e.g. Here are three laminate options for the master-bedroom wardrobe." />
          </label>
          <div className="space-y-1">
            <span className="text-xs font-medium">Options to include</span>
            <div className="flex flex-wrap gap-1.5">
              {editor.state.options.map((o) => {
                const empty = !Object.keys(o.assignments).length
                const on = picked.includes(o.id)
                return (
                  <label key={o.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${empty ? 'opacity-50' : ''}`} title={empty ? 'No materials assigned' : undefined}>
                    <input type="checkbox" disabled={empty} checked={on} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))} />
                    {o.name}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} /> Show estimated material cost</label>
            <label className="flex items-center gap-1.5" title={logo || user?.companyName ? undefined : 'Add a logo or company name in your profile'}>
              <input type="checkbox" checked={watermark} disabled={!logo && !user?.companyName} onChange={(e) => setWatermark(e.target.checked)} /> Watermark images
            </label>
            <Button className="ml-auto gap-2" onClick={create} disabled={!!step || !picked.length} data-testid="viz-share-create">
              {step ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} {step ?? 'Create link'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Review links</h4>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : !shares?.length ? (
            <p className="text-xs text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="viz-share-list">
              {shares.map((s) => {
                const expired = !!s.expiresAt && new Date(s.expiresAt) < new Date()
                const comments = s.comments ?? []
                return (
                  <li key={s.id} className="rounded-md border p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {format(new Date(s.createdAt), 'd MMM yyyy')} · {s.options.length} option{s.options.length > 1 ? 's' : ''}
                          {s.expiresAt ? ` · ${expired ? 'expired' : `expires ${format(new Date(s.expiresAt), 'd MMM')}`}` : ''}
                        </p>
                      </div>
                      {s.decision && (
                        <span className="flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-950 dark:text-green-300" data-testid="viz-share-decision">
                          <BadgeCheck className="h-3 w-3" /> {s.decision.clientName} chose {s.decision.optionName}
                        </span>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpenShare(openShare === s.id ? null : s.id)}>
                        <MessageSquare className="h-3 w-3" /> {comments.length}
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => copy(s)} disabled={expired}><Copy className="h-3 w-3" /> Copy</Button>
                      <a href={whatsapp(s)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent">WhatsApp</a>
                      <a href={reviewUrl(s.token)} target="_blank" rel="noreferrer" className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent" aria-label="Open review page">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => setRevoke(s)} aria-label="Revoke link"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    {openShare === s.id && (
                      <div className="mt-2 space-y-1.5 border-t pt-2">
                        {s.decision && editor.state.options.some((o) => o.id === s.decision!.optionId) && editor.state.approvedOptionId !== s.decision.optionId && (
                          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => editor.setState((st) => ({ ...st, approvedOptionId: s.decision!.optionId }))}>
                            <BadgeCheck className="h-3 w-3" /> Mark {s.decision.optionName} as approved in this project
                          </Button>
                        )}
                        {!comments.length ? (
                          <p className="text-xs text-muted-foreground">No comments yet.</p>
                        ) : (
                          comments.map((c) => (
                            <div key={c.id} className="rounded bg-muted/50 p-1.5 text-xs">
                              <span className="font-medium">{c.name}</span>
                              {c.optionId && <span className="text-muted-foreground"> on {s.options.find((o) => o.optionId === c.optionId)?.name ?? 'an option'}</span>}
                              <span className="text-muted-foreground"> · {format(new Date(c.createdAt), 'd MMM, HH:mm')}</span>
                              <p className="whitespace-pre-wrap">{c.message}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <ConfirmDialog
          open={!!revoke}
          onOpenChange={(o) => !o && setRevoke(null)}
          title="Revoke this review link?"
          description="The client will no longer be able to open it, and its comments and approval are deleted."
          confirmLabel="Revoke"
          onConfirm={async () => {
            if (!revoke) return
            try {
              await visualizerApi.deleteShare(revoke.id)
              await qc.invalidateQueries({ queryKey: ['visualizer', 'shares', projectId] })
            } catch (err) {
              toast({ title: 'Could not revoke', description: apiErrorMessage(err), variant: 'destructive' })
            }
            setRevoke(null)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
