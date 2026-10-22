import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { BadgeCheck, CheckCircle2, Globe, Loader2, MessageSquare, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatCurrency } from '@/lib/utils'
import { apiErrorMessage, publicAssetUrl, visualizerPublicApi, type PublicShare } from '@/api/visualizer'
import { SwipeCompare } from '@/components/visualizer/SwipeCompare'

const NAME_KEY = 'viz.review.name'
function storedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* convenience only */
  }
}

/** Public page a client opens from a review link: compare options, comment, approve. */
export function VisualizerReviewPage() {
  const { token = '' } = useParams()
  const qc = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['viz-review', token],
    queryFn: () => visualizerPublicApi.getShare(token),
    enabled: !!token,
    retry: false,
  })
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (data && !selected) setSelected(data.decision?.optionId ?? data.options[0]?.optionId ?? null)
  }, [data, selected])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <p className="text-lg font-semibold">This review link is not available</p>
          <p className="text-sm text-muted-foreground">{apiErrorMessage(error)}. Please ask your designer for a new link.</p>
        </div>
      </div>
    )
  }

  const option = data.options.find((o) => o.optionId === selected) ?? data.options[0]
  const update = (patch: Partial<PublicShare>) => qc.setQueryData<PublicShare>(['viz-review', token], (d) => (d ? { ...d, ...patch } : d))

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          {data.designer.logoUrl ? (
            <img src={data.designer.logoUrl} alt={data.designer.name} className="h-9 max-w-[160px] object-contain" />
          ) : (
            <span className="text-lg font-semibold">{data.designer.name}</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {data.designer.phone && <a href={`tel:${data.designer.phone}`} className="flex items-center gap-1 hover:text-foreground"><Phone className="h-3.5 w-3.5" /> {data.designer.phone}</a>}
            {data.designer.website && (
              <a href={/^https?:\/\//.test(data.designer.website) ? data.designer.website : `https://${data.designer.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
                <Globe className="h-3.5 w-3.5" /> {data.designer.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.options.length} design option{data.options.length > 1 ? 's' : ''} from {data.designer.name} · {format(new Date(data.createdAt), 'd MMM yyyy')}
          </p>
          {data.message && <p className="max-w-3xl whitespace-pre-wrap pt-2 text-sm">{data.message}</p>}
        </div>

        {data.decision && (
          <div className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950/40 dark:text-green-200" data-testid="review-decision">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">{data.decision.clientName}</span> approved <span className="font-medium">{data.decision.optionName}</span> on{' '}
              {format(new Date(data.decision.decidedAt), 'd MMM yyyy, HH:mm')}. You can still change your choice below.
            </span>
          </div>
        )}

        {/* option tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
          {data.options.map((o) => (
            <button
              key={o.optionId}
              type="button"
              role="tab"
              aria-selected={o.optionId === option?.optionId}
              onClick={() => setSelected(o.optionId)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg border bg-background p-1.5 pr-3 text-left text-sm transition-colors',
                o.optionId === option?.optionId ? 'border-primary ring-2 ring-primary' : 'hover:border-primary'
              )}
            >
              <img src={publicAssetUrl(o.image)} alt="" className="h-12 w-20 rounded object-cover" />
              <span className="font-medium">{o.name}</span>
              {data.decision?.optionId === o.optionId && <BadgeCheck className="h-4 w-4 text-green-600" />}
            </button>
          ))}
        </div>

        {option && (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-2">
              <SwipeCompare before={publicAssetUrl(data.original)} after={publicAssetUrl(option.image)} beforeLabel="Current" afterLabel={option.name} />
              <p className="text-xs text-muted-foreground">Drag the divider to compare with the current design.</p>
            </div>
            <aside className="space-y-4">
              <section className="space-y-2 rounded-lg border bg-background p-3">
                <h2 className="font-semibold">{option.name}</h2>
                {option.notes && <p className="whitespace-pre-wrap text-sm">{option.notes}</p>}
                {option.materials.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {option.materials.map((m, i) => (
                      <li key={i}>
                        <span className="font-medium">{m.name}</span>
                        {(m.brand || m.code) && <span className="text-muted-foreground"> · {[m.brand, m.code].filter(Boolean).join(' ')}</span>}
                        <span className="block text-xs text-muted-foreground">{m.surfaces.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.showPrices && option.total != null && (
                  <p className="border-t pt-2 text-sm">
                    Estimated material cost: <span className="font-semibold">{formatCurrency(option.total)}</span>
                  </p>
                )}
              </section>
              <ApproveForm token={token} share={data} optionId={option.optionId} optionName={option.name} onDone={update} />
            </aside>
          </div>
        )}

        <Comments token={token} share={data} optionId={option?.optionId ?? null} onDone={update} />

        <p className="text-center text-[11px] text-muted-foreground">
          Visualization of a rendered image: on-screen colours vary by display. Your designer will confirm finishes with physical samples.
          {data.expiresAt && ` This link is available until ${format(new Date(data.expiresAt), 'd MMM yyyy')}.`}
        </p>
      </main>
    </div>
  )
}

function ApproveForm({ token, share, optionId, optionName, onDone }: { token: string; share: PublicShare; optionId: string; optionName: string; onDone: (p: Partial<PublicShare>) => void }) {
  const [name, setName] = useState(storedName)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const chosen = share.decision?.optionId === optionId
  const submit = async () => {
    if (!name.trim()) return setErr('Please enter your name.')
    setBusy(true)
    setErr(null)
    try {
      rememberName(name.trim())
      const r = await visualizerPublicApi.decide(token, { optionId, name: name.trim(), comment: comment.trim() })
      onDone({ decision: r.decision, comments: r.comments })
      setComment('')
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-2 rounded-lg border bg-background p-3" data-testid="review-approve">
      <h3 className="text-sm font-semibold">{chosen ? 'You approved this option' : `Approve ${optionName}?`}</h3>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={120} aria-label="Your name" />
      <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything to add? (optional)" maxLength={2000} aria-label="Comment" />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <Button className="w-full gap-2" onClick={submit} disabled={busy} variant={chosen ? 'outline' : 'default'}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
        {chosen ? 'Approve again' : `Approve ${optionName}`}
      </Button>
    </section>
  )
}

function Comments({ token, share, optionId, onDone }: { token: string; share: PublicShare; optionId: string | null; onDone: (p: Partial<PublicShare>) => void }) {
  const [name, setName] = useState(storedName)
  const [message, setMessage] = useState('')
  const [aboutOption, setAboutOption] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    if (!name.trim() || !message.trim()) return setErr('Please enter your name and a message.')
    setBusy(true)
    setErr(null)
    try {
      rememberName(name.trim())
      const r = await visualizerPublicApi.comment(token, { optionId: aboutOption ? optionId : null, name: name.trim(), message: message.trim() })
      onDone({ comments: r.comments })
      setMessage('')
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const optionName = (id: string | null) => share.options.find((o) => o.optionId === id)?.name
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4" data-testid="review-comments">
      <h2 className="flex items-center gap-2 font-semibold"><MessageSquare className="h-4 w-4" /> Comments</h2>
      {share.comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Questions or changes? Leave a note for your designer.</p>
      ) : (
        <ul className="space-y-2">
          {share.comments.map((c) => (
            <li key={c.id} className="rounded-md bg-muted/50 p-2 text-sm">
              <span className="font-medium">{c.name}</span>
              {c.optionId && <span className="text-muted-foreground"> on {optionName(c.optionId) ?? 'an option'}</span>}
              <span className="text-xs text-muted-foreground"> · {format(new Date(c.createdAt), 'd MMM, HH:mm')}</span>
              <p className="whitespace-pre-wrap">{c.message}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-start">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={120} aria-label="Your name" />
        <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your comment" maxLength={2000} aria-label="Comment" />
        <Button onClick={submit} disabled={busy} className="gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send</Button>
      </div>
      {optionId && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={aboutOption} onChange={(e) => setAboutOption(e.target.checked)} /> About {optionName(optionId)}
        </label>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </section>
  )
}
