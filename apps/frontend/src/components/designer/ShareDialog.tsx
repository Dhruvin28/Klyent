import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { designerApi } from '@/api/designer'
import { apiErrorMessage } from '@/api/visualizer'
import { useDesignRenders, useDesignShares } from '@/hooks/useDesigner'
import { RenderThumb } from './RendersDialog'

export const tourUrl = (token: string) => `${window.location.origin}/designer/tour/${token}`

/** Publishes chosen renders, panoramas and videos as a no-login client tour link. */
export function ShareDialog({ open, onOpenChange, projectId, projectName }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; projectName: string }) {
  const { data: renders } = useDesignRenders(projectId)
  const { data: shares } = useDesignShares(projectId)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [expiry, setExpiry] = useState('30')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const qc = useQueryClient()
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      setTitle(projectName)
      setPicked(new Set((renders ?? []).map((r) => r.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const copy = async (token: string) => {
    await navigator.clipboard.writeText(tourUrl(token))
    setCopied(token)
    setTimeout(() => setCopied(null), 1500)
  }

  const create = async () => {
    setBusy(true)
    try {
      const ordered = (renders ?? []).filter((r) => picked.has(r.id)).map((r) => r.id)
      const s = await designerApi.createShare(projectId, { title: title.trim() || projectName, message: message.trim() || undefined, renderIds: ordered, expiresInDays: expiry === 'never' ? null : Number(expiry) })
      await qc.invalidateQueries({ queryKey: ['designer', 'shares', projectId] })
      await copy(s.token)
      toast({ title: 'Tour link created and copied' })
    } catch (err) {
      toast({ title: 'Could not create link', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    try {
      await designerApi.revokeShare(id)
      await qc.invalidateQueries({ queryKey: ['designer', 'shares', projectId] })
    } catch (err) {
      toast({ title: 'Could not revoke link', description: apiErrorMessage(err), variant: 'destructive' })
    }
  }

  const live = (shares ?? []).filter((s) => !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt) > new Date()))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Share a virtual tour</DialogTitle>
          <DialogDescription>Clients open the link without an account and can look around 360° panoramas, view renders and play walkthroughs.</DialogDescription>
        </DialogHeader>

        {renders?.length ? (
          <div className="space-y-3">
            <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
              {renders.map((r) => (
                <button key={r.id} type="button" onClick={() => toggle(r.id)} className={cn('relative overflow-hidden rounded-md border text-left', picked.has(r.id) ? 'border-primary ring-2 ring-primary/30' : 'opacity-60')}>
                  <RenderThumb render={r} />
                  <p className="truncate p-1 text-[11px]">{r.name}</p>
                  {picked.has(r.id) && <Check className="absolute left-1 top-1 h-4 w-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Link expiry">
                <option value="7">Expires in 7 days</option>
                <option value="30">Expires in 30 days</option>
                <option value="90">Expires in 90 days</option>
                <option value="never">Never expires</option>
              </select>
            </div>
            <Textarea value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} placeholder="Message to the client (optional)" rows={2} />
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Render at least one image, panorama or video first.</p>
        )}

        {live.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active links</h4>
            <ul className="divide-y rounded-md border">
              {live.map((s) => (
                <li key={s.id} className="flex items-center gap-2 p-2 text-sm">
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {s.title} <span className="text-muted-foreground">· {s.renderIds.length} items · {s.expiresAt ? `until ${format(new Date(s.expiresAt), 'd MMM yyyy')}` : 'no expiry'}</span>
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(s.token)} aria-label="Copy link">
                    {copied === s.token ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => revoke(s.id)} aria-label="Revoke link">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={busy || !picked.size} onClick={create}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
