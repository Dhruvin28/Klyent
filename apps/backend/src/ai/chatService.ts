import OpenAI, { toFile } from 'openai'
import { and, asc, eq } from 'drizzle-orm'
import { config } from '../config'
import { openai } from '../lib/openai'
import { db, aiMessages, aiAttachments, aiSessions } from '../db'
import { extractText } from '../studio/textExtract'
import { renderPdfPages } from './pdfRender'

export const SYSTEM_PROMPT = `You are the AI assistant inside Klyent, a studio/business management app. You work like ChatGPT: answer questions, analyse uploaded files, images and PDFs, write and edit text, and generate images. Use the full conversation history for context and follow-ups.

YOUR MAIN JOB — realistic 3D images that are EXACT to the attached 2D plans:
Users attach floor plans, elevations, sections, sketches, product photos or PDFs (drawings, brief, spec sheet) and want a photorealistic 3D render that matches the source exactly.

Step 1 — analyse before you render. Go through EVERY page of every attached PDF/image (not just the first) and extract, silently, a complete inventory:
- overall footprint and shape, every room/zone with its label and dimensions, wall positions and thicknesses
- every door and window: position, wall, width, swing direction; stairs, columns, level changes, ceiling heights/depth/elevation data
- every fixture, furniture item, appliance and built-in: type, position, size, orientation
- scale, north arrow, dimension strings, annotations, materials/finish notes, legends, title block
Cross-check pages against each other (plan vs elevation vs section) so heights and depth are consistent.

Step 2 — call generate_image with reference="uploaded". The prompt must contain that inventory in words: list every room and element with its position (e.g. "top-left", "south wall, 2 m from the corner") and dimension, the camera/viewpoint, materials, colours, lighting, and "photorealistic, ultra-detailed architectural visualisation, physically based materials, natural global illumination". Use an isometric / 3/4 aerial cutaway view for a whole floor plan, or eye-level perspective for a single room, unless the user asks otherwise.

Fidelity rules (strict):
- The 2D plan is the single source of truth. Keep layout, proportions, room count, wall positions, openings, furniture placement and dimensions EXACTLY as drawn. Do not add, remove, move, resize, rotate or mirror anything. Do not invent rooms, furniture or text that is not in the source.
- Only things the plan leaves unspecified (finishes, lighting, textures) may be chosen by you, and must not contradict the plan.
- If the user attached a plan/sketch/photo/PDF and gave no instruction, generate the realistic 3D render of it.
- If the user asks for a change to a previously generated image, call generate_image with reference="last_generated" and describe the full desired result, keeping everything else unchanged.
- Always call generate_image yourself when an image is wanted; never just output a prompt. You may call it more than once if several views are requested (max 4).
- After generating, reply briefly: what you rendered, any assumptions for unspecified details, and anything in the plan that was unclear or unreadable. Do not paste image links.

For everything else (questions, summaries, extracting data, writing, calculations) answer directly, accurately and concisely, using Markdown when it helps. If an attached file is unreadable or information is missing, say so plainly instead of guessing.`

const IMAGE_TOOL: any = {
  type: 'function',
  name: 'generate_image',
  strict: false,
  description:
    'Generate or edit an image (e.g. a photorealistic 3D render). Shows the result to the user in the chat. Uses attached reference images when requested.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Complete, detailed image prompt.' },
      reference: {
        type: 'string',
        enum: ['uploaded', 'last_generated', 'none'],
        description:
          'Which images to use as visual reference: "uploaded" = everything the user attached, including every page of attached PDFs (use for rendering from a plan/sketch/photo/PDF), "last_generated" = the most recent image generated in this chat (use for edits/variations), "none" = generate from the prompt alone.',
      },
      size: {
        type: 'string',
        enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
        description: 'Output size. Use 1536x1024 for most interiors/exteriors (landscape). Default auto.',
      },
    },
    required: ['prompt', 'reference'],
  },
}

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_VISION_IMAGES = 8 // most recent uploaded images sent to the model as pixels
const MAX_PDF_FILES = 2 // most recent PDFs sent natively (older ones fall back to extracted text)
const MAX_DOC_CHARS = 60_000
const MAX_TOOL_ROUNDS = 4

export function isImageMime(m: string) {
  return IMAGE_MIME.has(m)
}

type MessageRow = typeof aiMessages.$inferSelect
type AttachmentRow = typeof aiAttachments.$inferSelect
type ChatMessage = any // OpenAI Responses API input item

export interface AttachmentMeta {
  id: string
  name: string
  mimeType: string
  size: number
  kind: 'upload' | 'generated'
}

export interface ChatMessageDto {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
  attachments: AttachmentMeta[]
}

export interface AiRunOptions {
  model: string
  reasoningEffort: string // '' = model default
  imageModel: string
}

export interface UploadInput {
  buffer: Buffer
  filename: string
  mimetype: string
}

export function aiConfigured() {
  return !!config.openai.apiKey
}

function toMeta(a: Pick<AttachmentRow, 'id' | 'name' | 'mimeType' | 'size' | 'kind'>): AttachmentMeta {
  return { id: a.id, name: a.name, mimeType: a.mimeType, size: a.size, kind: a.kind }
}

export async function listSessionMessages(sessionId: string): Promise<ChatMessageDto[]> {
  const msgs = await db.select().from(aiMessages).where(eq(aiMessages.sessionId, sessionId)).orderBy(asc(aiMessages.createdAt))
  const atts = await db
    .select({
      id: aiAttachments.id,
      messageId: aiAttachments.messageId,
      name: aiAttachments.name,
      mimeType: aiAttachments.mimeType,
      size: aiAttachments.size,
      kind: aiAttachments.kind,
    })
    .from(aiAttachments)
    .where(eq(aiAttachments.sessionId, sessionId))
    .orderBy(asc(aiAttachments.createdAt))
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    attachments: atts.filter((a) => a.messageId === m.id).map(toMeta),
  }))
}

/** Turn stored history into OpenAI chat messages (with images/PDFs inline). */
async function buildHistory(sessionId: string, nativePdf = true): Promise<{ messages: ChatMessage[]; rows: MessageRow[]; atts: AttachmentRow[] }> {
  const rows = await db.select().from(aiMessages).where(eq(aiMessages.sessionId, sessionId)).orderBy(asc(aiMessages.createdAt))
  const atts = await db.select().from(aiAttachments).where(eq(aiAttachments.sessionId, sessionId)).orderBy(asc(aiAttachments.createdAt))

  const uploads = atts.filter((a) => a.kind === 'upload')
  const visionIds = new Set(uploads.filter((a) => isImageMime(a.mimeType)).slice(-MAX_VISION_IMAGES).map((a) => a.id))
  const pdfIds = new Set(nativePdf ? uploads.filter((a) => a.mimeType === 'application/pdf').slice(-MAX_PDF_FILES).map((a) => a.id) : [])

  const messages: ChatMessage[] = []
  for (const row of rows) {
    const mine = atts.filter((a) => a.messageId === row.id)
    if (row.role === 'assistant') {
      const gen = mine.filter((a) => a.kind === 'generated')
      const note = gen.length ? `\n\n[${gen.length} generated image${gen.length > 1 ? 's' : ''} shown to the user: ${gen.map((g) => g.name).join(', ')}]` : ''
      messages.push({ role: 'assistant', content: row.content + note })
      continue
    }

    const parts: any[] = []
    let text = row.content
    for (const a of mine) {
      if (isImageMime(a.mimeType)) {
        if (visionIds.has(a.id)) {
          parts.push({ type: 'input_image', image_url: `data:${a.mimeType};base64,${a.data.toString('base64')}`, detail: 'high' })
          text += `\n[Attached image: ${a.name}]`
        } else {
          text += `\n[Attached image (older, not re-sent): ${a.name}]`
        }
        continue
      }
      if (a.mimeType === 'application/pdf' && pdfIds.has(a.id)) {
        parts.push({ type: 'input_file', filename: a.name, file_data: `data:application/pdf;base64,${a.data.toString('base64')}` })
        text += `\n[Attached PDF: ${a.name}]`
      } else {
        const extracted = await extractAttachmentText(a)
        text += `\n\n--- Attached file: ${a.name} ---\n${extracted || '(no readable text could be extracted)'}\n--- end of ${a.name} ---`
      }
    }
    parts.unshift({ type: 'input_text', text: text.trim() || '(no text)' })
    messages.push({ role: 'user', content: parts })
  }
  return { messages, rows, atts }
}

async function extractAttachmentText(a: AttachmentRow): Promise<string> {
  try {
    const r = await extractText(a.data, a.mimeType, a.name)
    return r.text.length > MAX_DOC_CHARS ? r.text.slice(0, MAX_DOC_CHARS) + '\n[…truncated]' : r.text
  } catch {
    return ''
  }
}

function mimeToExt(mime: string) {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'
}

async function runChat(opts: AiRunOptions, input: ChatMessage[], withTools: boolean, previousResponseId?: string) {
  const base: any = { model: opts.model, instructions: SYSTEM_PROMPT, input }
  if (previousResponseId) base.previous_response_id = previousResponseId
  if (withTools) {
    base.tools = [IMAGE_TOOL]
    base.tool_choice = 'auto'
  }
  if (opts.reasoningEffort) base.reasoning = { effort: opts.reasoningEffort }
  try {
    return await openai.responses.create(base)
  } catch (err: any) {
    // Some models reject the reasoning parameter; retry once without it.
    if (err?.status === 400 && base.reasoning && /reasoning/i.test(err?.message ?? '')) {
      delete base.reasoning
      return await openai.responses.create(base)
    }
    throw err
  }
}

interface GeneratedImage {
  buffer: Buffer
  mimeType: string
}

const FIDELITY_PREFIX = `The attached image(s) are the user's 2D architectural plan / drawing pages. Produce a photorealistic 3D rendering of EXACTLY this plan.
STRICT: keep the layout, room shapes and proportions, wall positions, door and window positions, stairs, fixtures, furniture placement, orientation and relative dimensions identical to the drawing. Do not add, remove, move, resize, mirror or rotate anything. Do not invent rooms or objects. Preserve every labelled element. Real-world materials, realistic lighting and depth are applied ON TOP of the unchanged geometry.
Details extracted from the plan:
`

const MAX_REF_IMAGES = 10

async function loadReferenceImages(uploaded: AttachmentRow[]): Promise<{ buffer: Buffer; mimeType: string }[]> {
  const out: { buffer: Buffer; mimeType: string }[] = []
  for (const a of uploaded) {
    if (isImageMime(a.mimeType)) {
      out.push({ buffer: a.data, mimeType: a.mimeType })
    } else if (a.mimeType === 'application/pdf') {
      try {
        for (const png of await renderPdfPages(a.data)) out.push({ buffer: png, mimeType: 'image/png' })
      } catch (err: any) {
        console.error('[ai] pdf rasterise failed:', a.name, err?.message ?? err)
      }
    }
  }
  return out.slice(0, MAX_REF_IMAGES)
}

async function generateImage(
  imageModel: string,
  args: { prompt: string; reference?: string; size?: string },
  refs: { uploaded: AttachmentRow[]; lastGenerated: AttachmentRow | null; generatedThisTurn: GeneratedImage[] }
): Promise<GeneratedImage> {
  const size = (['1024x1024', '1536x1024', '1024x1536'].includes(args.size ?? '') ? args.size : 'auto') as any
  const quality = 'high' as const

  let refImages: { buffer: Buffer; mimeType: string }[] = []
  let fromPlan = false
  if (args.reference === 'uploaded') {
    refImages = await loadReferenceImages(refs.uploaded)
    fromPlan = refImages.length > 0
  } else if (args.reference === 'last_generated') {
    const last = refs.generatedThisTurn.at(-1)
    if (last) refImages = [{ buffer: last.buffer, mimeType: last.mimeType }]
    else if (refs.lastGenerated) refImages = [{ buffer: refs.lastGenerated.data, mimeType: refs.lastGenerated.mimeType }]
  }

  let b64: string | undefined
  if (refImages.length) {
    const files = await Promise.all(
      refImages.map((r, i) => toFile(r.buffer, `ref-${i}.${mimeToExt(r.mimeType)}`, { type: isImageMime(r.mimeType) ? r.mimeType : 'image/png' }))
    )
    const prompt = fromPlan ? FIDELITY_PREFIX + args.prompt : args.prompt
    const params: any = { model: imageModel, image: files, prompt, size, quality, n: 1, input_fidelity: 'high' }
    let res
    try {
      res = await openai.images.edit(params)
    } catch (err: any) {
      // Not every image model supports input_fidelity; retry without it.
      if (err?.status === 400 && /input_fidelity/i.test(err?.message ?? '')) {
        delete params.input_fidelity
        res = await openai.images.edit(params)
      } else {
        throw err
      }
    }
    b64 = res.data?.[0]?.b64_json
  } else {
    const res = await openai.images.generate({ model: imageModel, prompt: args.prompt, size, quality, n: 1 } as any)
    b64 = res.data?.[0]?.b64_json
  }
  if (!b64) throw new Error('The image model returned no image.')
  return { buffer: Buffer.from(b64, 'base64'), mimeType: 'image/png' }
}

export interface SendResult {
  userMessage: ChatMessageDto
  assistantMessage: ChatMessageDto
}

export async function sendMessage(opts: { userId: string; sessionId: string; content: string; files: UploadInput[]; run: AiRunOptions }): Promise<SendResult> {
  const { userId, sessionId, content, files, run } = opts

  // 1. Persist the user's message + uploads.
  const userMsgId = crypto.randomUUID()
  await db.insert(aiMessages).values({ id: userMsgId, sessionId, userId, role: 'user', content })
  const userAttRows = files.map((f) => ({
    id: crypto.randomUUID(),
    messageId: userMsgId,
    sessionId,
    userId,
    kind: 'upload' as const,
    name: f.filename,
    mimeType: f.mimetype,
    size: f.buffer.length,
    data: f.buffer,
  }))
  if (userAttRows.length) await db.insert(aiAttachments).values(userAttRows)

  // Title the session from its first message.
  const [session] = await db.select().from(aiSessions).where(eq(aiSessions.id, sessionId)).limit(1)
  if (session && session.title === 'New chat') {
    const base = content.trim() || files[0]?.filename || 'New chat'
    await db.update(aiSessions).set({ title: base.replace(/\s+/g, ' ').slice(0, 60) }).where(eq(aiSessions.id, sessionId))
  } else {
    await db.update(aiSessions).set({ updatedAt: new Date() }).where(eq(aiSessions.id, sessionId))
  }

  // 2. Build context from the whole thread and run the model (with tool loop).
  const { messages, atts } = await buildHistory(sessionId)
  const isVisual = (a: AttachmentRow) => isImageMime(a.mimeType) || a.mimeType === 'application/pdf'
  const currentUploads = atts.filter((a) => a.messageId === userMsgId && isVisual(a))
  const priorUploads = atts.filter((a) => a.kind === 'upload' && isVisual(a))
  const refs = {
    uploaded: currentUploads.length ? currentUploads : priorUploads,
    lastGenerated: atts.filter((a) => a.kind === 'generated').at(-1) ?? null,
    generatedThisTurn: [] as GeneratedImage[],
  }

  let input: ChatMessage[] = messages
  let nativePdf = true
  let previousId: string | undefined

  let finalText = ''
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const withTools = refs.generatedThisTurn.length < 4
    let response
    try {
      response = await runChat(run, input, withTools, previousId)
    } catch (err: any) {
      // The model rejected native PDF input: fall back to extracted PDF text once.
      if (nativePdf && round === 0 && err?.status === 400 && /file|pdf|content.?part/i.test(err?.message ?? '')) {
        nativePdf = false
        input = (await buildHistory(sessionId, false)).messages
        response = await runChat(run, input, withTools)
      } else {
        throw err
      }
    }

    const calls = (response.output as any[]).filter((o) => o.type === 'function_call')
    if (!calls.length) {
      finalText = response.output_text ?? ''
      break
    }

    const outputs: ChatMessage[] = []
    for (const call of calls) {
      let result: string
      try {
        const args = JSON.parse(call.arguments || '{}')
        if (call.name !== 'generate_image') throw new Error(`Unknown tool ${call.name}`)
        if (refs.generatedThisTurn.length >= 4) throw new Error('Image limit reached for this reply.')
        const img = await generateImage(run.imageModel, args, refs)
        refs.generatedThisTurn.push(img)
        result = 'Image generated successfully and is now displayed to the user.'
      } catch (err: any) {
        console.error('[ai] image generation failed:', err?.message ?? err)
        result = `Image generation failed: ${err?.message ?? 'unknown error'}. Tell the user and suggest what to try.`
      }
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: result })
    }
    previousId = response.id
    input = outputs
    if (round === MAX_TOOL_ROUNDS - 1) finalText = 'Done.'
  }
  if (!finalText.trim()) finalText = refs.generatedThisTurn.length ? 'Here is your image.' : 'I could not produce a response.'

  // 3. Persist the assistant reply and generated images.
  const asstMsgId = crypto.randomUUID()
  const stamp = Date.now()
  await db.insert(aiMessages).values({ id: asstMsgId, sessionId, userId, role: 'assistant', content: finalText })
  const genRows = refs.generatedThisTurn.map((g, i) => ({
    id: crypto.randomUUID(),
    messageId: asstMsgId,
    sessionId,
    userId,
    kind: 'generated' as const,
    name: `render-${stamp}-${i + 1}.png`,
    mimeType: g.mimeType,
    size: g.buffer.length,
    data: g.buffer,
  }))
  if (genRows.length) await db.insert(aiAttachments).values(genRows)
  await db.update(aiSessions).set({ updatedAt: new Date() }).where(eq(aiSessions.id, sessionId))

  const now = new Date()
  return {
    userMessage: { id: userMsgId, role: 'user', content, createdAt: now, attachments: userAttRows.map(toMeta) },
    assistantMessage: { id: asstMsgId, role: 'assistant', content: finalText, createdAt: now, attachments: genRows.map(toMeta) },
  }
}

export async function deleteSession(userId: string, sessionId: string) {
  await db.delete(aiAttachments).where(and(eq(aiAttachments.sessionId, sessionId), eq(aiAttachments.userId, userId)))
  await db.delete(aiMessages).where(and(eq(aiMessages.sessionId, sessionId), eq(aiMessages.userId, userId)))
  await db.delete(aiSessions).where(and(eq(aiSessions.id, sessionId), eq(aiSessions.userId, userId)))
}
