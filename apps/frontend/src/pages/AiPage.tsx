import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Loader2, MessageSquarePlus, Paperclip, Send, Sparkles, Trash2, X, PanelLeft } from 'lucide-react'
import { aiApi, type AiAttachment, type AiMessage } from '@/api/ai'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { AuthImage, useAttachmentUrl } from '@/components/ai/AuthImage'
import { Markdown } from '@/components/ai/Markdown'
import { cn } from '@/lib/utils'

const MAX_FILES = 6
const MAX_FILE_MB = 10
const ACCEPT = 'image/*,.pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json'

const CHAT_MODELS = [{ value: 'gpt-6-astra', label: 'gpt-6-astra' }]
const IMAGE_MODELS = [
  { value: 'gpt-image-2.5-sunburst', label: 'gpt-image-2.5-sunburst' },
  { value: 'gpt-image-1', label: 'gpt-image-1' },
]
const EFFORTS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

function ModelSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-[11rem] rounded-md border border-input bg-background px-2 text-xs text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const SUGGESTIONS = [
  'Create a realistic 3D render of this floor plan',
  'Turn this sketch into a photorealistic interior view',
  'Summarise the attached PDF',
]

interface PendingTurn {
  content: string
  files: File[]
  previews: string[]
}

function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string }
  return e.response?.data?.message ?? e.response?.data?.error ?? e.message ?? 'Something went wrong'
}

function DownloadButton({ attachment }: { attachment: AiAttachment }) {
  const { url } = useAttachmentUrl(attachment.id)
  if (!url) return null
  return (
    <a
      href={url}
      download={attachment.name}
      className="inline-flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 text-xs shadow-sm hover:bg-accent"
    >
      <Download className="h-3 w-3" /> Download
    </a>
  )
}

function Attachments({ items, onOpen }: { items: AiAttachment[]; onOpen: (a: AiAttachment) => void }) {
  const images = items.filter((a) => a.mimeType.startsWith('image/'))
  const files = items.filter((a) => !a.mimeType.startsWith('image/'))
  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <div key={a.id} className="relative">
              <AuthImage
                id={a.id}
                alt={a.name}
                onClick={() => onOpen(a)}
                className={cn(
                  'cursor-zoom-in rounded-lg border object-cover',
                  a.kind === 'generated' ? 'max-h-[28rem] max-w-full' : 'h-32 w-32'
                )}
              />
              {a.kind === 'generated' && (
                <div className="absolute bottom-2 right-2">
                  <DownloadButton attachment={a} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {files.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-md border bg-background/60 px-3 py-2 text-xs">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{a.name}</span>
        </div>
      ))}
    </div>
  )
}

function Bubble({ message, onOpen }: { message: AiMessage; onOpen: (a: AiAttachment) => void }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex gap-3', isUser && 'justify-end')}>
      {!isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </div>
      )}
      <div className={cn('min-w-0 space-y-2', isUser ? 'max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground' : 'max-w-[92%]')}>
        {message.attachments.length > 0 && <Attachments items={message.attachments} onOpen={onOpen} />}
        {message.content &&
          (isUser ? <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p> : <Markdown text={message.content} />)}
      </div>
    </div>
  )
}

function Lightbox({ attachment, onClose }: { attachment: AiAttachment; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <DownloadButton attachment={attachment} />
        <Button size="icon" variant="secondary" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <AuthImage id={attachment.id} alt={attachment.name} className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain" />
      </div>
    </div>
  )
}

export function AiPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [pending, setPending] = useState<PendingTurn | null>(null)
  const [lightbox, setLightbox] = useState<AiAttachment | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // Runtime-only selections (not persisted anywhere).
  const [model, setModel] = useState(CHAT_MODELS[0].value)
  const [effort, setEffort] = useState('')
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].value)
  const fileRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const { data: status } = useQuery({ queryKey: ['ai', 'status'], queryFn: aiApi.getStatus })
  const { data: sessions = [] } = useQuery({ queryKey: ['ai', 'sessions'], queryFn: aiApi.getSessions })
  const { data: messages = [] } = useQuery({
    queryKey: ['ai', 'messages', sessionId],
    queryFn: () => aiApi.getMessages(sessionId!),
    enabled: !!sessionId,
  })

  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')), [files])
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, pending])

  useEffect(() => {
    if (!pending) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [pending])

  const send = useMutation({
    mutationFn: async ({ content, files }: { content: string; files: File[] }) => {
      let id = sessionId
      if (!id) {
        const s = await aiApi.createSession()
        id = s.id
        setSessionId(id)
      }
      await aiApi.sendMessage(id, content, files, { model, reasoningEffort: effort, imageModel })
      return id
    },
    onSettled: async (id) => {
      setPending((p) => {
        p?.previews.forEach((u) => u && URL.revokeObjectURL(u))
        return null
      })
      await qc.invalidateQueries({ queryKey: ['ai', 'sessions'] })
      if (id) await qc.invalidateQueries({ queryKey: ['ai', 'messages', id] })
    },
    onError: (err) => toast({ title: 'AI request failed', description: errorMessage(err), variant: 'destructive' }),
  })

  const del = useMutation({
    mutationFn: aiApi.deleteSession,
    onSuccess: (_, id) => {
      if (id === sessionId) setSessionId(null)
      qc.invalidateQueries({ queryKey: ['ai', 'sessions'] })
    },
  })

  const addFiles = (incoming: File[]) => {
    const ok: File[] = []
    for (const f of incoming) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) toast({ title: 'File too large', description: `${f.name} exceeds ${MAX_FILE_MB}MB`, variant: 'destructive' })
      else ok.push(f)
    }
    setFiles((cur) => {
      const next = [...cur, ...ok]
      if (next.length > MAX_FILES) toast({ title: `Max ${MAX_FILES} files per message`, variant: 'destructive' })
      return next.slice(0, MAX_FILES)
    })
  }

  const submit = () => {
    const content = input.trim()
    if ((!content && !files.length) || send.isPending) return
    // Pending bubble gets its own previews so the composer's object URLs can be released.
    const pendingPreviews = files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : ''))
    setPending({ content, files, previews: pendingPreviews })
    setInput('')
    setFiles([])
    send.mutate({ content, files })
  }

  const newChat = () => {
    setSessionId(null)
    setInput('')
    setFiles([])
    setListOpen(false)
  }

  const showEmpty = !sessionId && !pending && messages.length === 0
  const notConfigured = status && !status.configured

  return (
    <div
      className="relative flex h-[calc(100vh-8.5rem)] min-h-[420px] overflow-hidden rounded-xl border bg-card"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)) }}
    >
      {/* Sessions list */}
      <aside
        className={cn(
          'absolute inset-y-0 left-0 z-20 flex w-64 flex-col border-r bg-card transition-transform md:static md:translate-x-0',
          listOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-3">
          <Button className="w-full justify-start gap-2" variant="outline" onClick={newChat}>
            <MessageSquarePlus className="h-4 w-4" /> New chat
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {sessions.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">No chats yet.</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                'group flex cursor-pointer items-center gap-1 rounded-lg px-3 py-2 text-sm hover:bg-accent',
                s.id === sessionId && 'bg-accent font-medium'
              )}
              onClick={() => { setSessionId(s.id); setListOpen(false) }}
            >
              <span className="flex-1 truncate">{s.title}</span>
              <button
                className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
                title="Delete chat"
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm('Delete this chat and its images?')) del.mutate(s.id)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </aside>
      {listOpen && <div className="absolute inset-0 z-10 bg-black/40 md:hidden" onClick={() => setListOpen(false)} />}

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Button size="icon" variant="ghost" className="h-8 w-8 md:hidden" onClick={() => setListOpen(true)}>
            <PanelLeft className="h-4 w-4" />
          </Button>
          <Sparkles className="h-4 w-4 text-primary" />
          <h1 className="flex-1 truncate text-sm font-semibold">{sessions.find((s) => s.id === sessionId)?.title ?? 'AI Assistant'}</h1>
          <Button size="sm" variant="ghost" className="gap-1" onClick={newChat}>
            <MessageSquarePlus className="h-4 w-4" /> <span className="hidden sm:inline">New session</span>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-4 py-2">
          <ModelSelect label="Chat model" value={model} onChange={setModel} options={CHAT_MODELS} />
          <ModelSelect label="Thinking" value={effort} onChange={setEffort} options={EFFORTS} />
          <ModelSelect label="Image model" value={imageModel} onChange={setImageModel} options={IMAGE_MODELS} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          {notConfigured && (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              AI is not configured. Set <code>OPENAI_API_KEY</code> in the backend <code>.env</code> and restart the server.
            </div>
          )}

          {showEmpty ? (
            <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Sparkles className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold">What would you like to create?</h2>
              <p className="text-sm text-muted-foreground">
                Attach a floor plan, sketch, photo or PDF and describe the result you want, and I will generate a realistic 3D image.
                You can also ask questions or upload documents to analyse.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent" onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((m) => (
                <Bubble key={m.id} message={m} onOpen={setLightbox} />
              ))}
              {pending && (
                <>
                  <div className="flex justify-end">
                    <div className="max-w-[85%] space-y-2 rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground">
                      {pending.files.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {pending.files.map((f, i) =>
                            pending.previews[i] ? (
                              <img key={i} src={pending.previews[i]} alt={f.name} className="h-32 w-32 rounded-lg object-cover" />
                            ) : (
                              <div key={i} className="flex items-center gap-2 rounded-md bg-background/20 px-3 py-2 text-xs">
                                <FileText className="h-4 w-4" /> {f.name}
                              </div>
                            )
                          )}
                        </div>
                      )}
                      {pending.content && <p className="whitespace-pre-wrap text-sm">{pending.content}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                    {elapsed < 8 ? 'Thinking…' : 'Working on it. Image generation can take a minute or two…'} ({elapsed}s)
                  </div>
                </>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t p-3">
          <div className="mx-auto max-w-3xl">
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <div key={i} className="relative">
                    {previews[i] ? (
                      <img src={previews[i]} alt={f.name} className="h-16 w-16 rounded-lg border object-cover" />
                    ) : (
                      <div className="flex h-16 max-w-[10rem] items-center gap-2 rounded-lg border px-3 text-xs">
                        <FileText className="h-4 w-4 shrink-0" /> <span className="truncate">{f.name}</span>
                      </div>
                    )}
                    <button
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-0.5 text-background"
                      onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border bg-background p-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
              />
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" title="Attach images or files" onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                value={input}
                rows={1}
                placeholder="Describe what you want, or ask anything…"
                className="max-h-40 min-h-[36px] resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                }}
                onPaste={(e) => {
                  const pasted = Array.from(e.clipboardData.files)
                  if (pasted.length) { e.preventDefault(); addFiles(pasted) }
                }}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full"
                disabled={send.isPending || (!input.trim() && !files.length)}
                onClick={submit}
              >
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line · drag and drop or paste images/PDFs
            </p>
          </div>
        </div>
      </section>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/80 text-sm font-medium">
          Drop files to attach
        </div>
      )}
      {lightbox && <Lightbox attachment={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
