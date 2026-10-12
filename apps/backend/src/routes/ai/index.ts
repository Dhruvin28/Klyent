import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { db, aiSessions, aiAttachments } from '../../db'
import { aiConfigured, deleteSession, listSessionMessages, sendMessage, type UploadInput } from '../../ai/chatService'

const ALLOWED_UPLOAD = (mime: string, name: string) =>
  mime.startsWith('image/') ||
  mime === 'application/pdf' ||
  mime.startsWith('text/') ||
  mime.includes('wordprocessingml') ||
  mime.includes('spreadsheetml') ||
  mime === 'application/vnd.ms-excel' ||
  mime === 'application/json' ||
  /\.(pdf|docx|xlsx|xls|csv|txt|md|json)$/i.test(name)

async function parseChatMultipart(request: FastifyRequest) {
  let content = ''
  const opt: Record<string, string> = {}
  const files: UploadInput[] = []
  const parts = request.parts({ limits: { files: config.ai.maxFiles, fileSize: config.ai.maxFileSize } })
  for await (const part of parts) {
    if (part.type === 'file') {
      const chunks: Buffer[] = []
      for await (const chunk of part.file) chunks.push(chunk as Buffer)
      if (part.file.truncated) throw httpError(413, `"${part.filename}" is too large (max ${config.ai.maxFileSize / (1024 * 1024)}MB).`)
      if (!part.filename || !chunks.length) continue
      if (!ALLOWED_UPLOAD(part.mimetype, part.filename)) throw httpError(415, `Unsupported file type: ${part.filename}`)
      files.push({ buffer: Buffer.concat(chunks), filename: part.filename, mimetype: part.mimetype })
    } else if (['model', 'reasoningEffort', 'imageModel'].includes(part.fieldname)) {
      opt[part.fieldname] = String(part.value ?? '').trim()
    } else if (part.fieldname === 'content') {
      content = typeof part.value === 'string' ? part.value : String(part.value)
    }
  }
  return { content: content.trim(), files, opt }
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode })
}

export default async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  async function ownedSession(userId: string, id: string) {
    const [s] = await db.select().from(aiSessions).where(and(eq(aiSessions.id, id), eq(aiSessions.userId, userId))).limit(1)
    return s
  }

  // GET /api/ai/status
  app.get('/status', async (_req, reply) =>
    reply.send({ data: { configured: aiConfigured() } })
  )

  // GET /api/ai/sessions
  app.get('/sessions', async (request, reply) => {
    const rows = await db
      .select()
      .from(aiSessions)
      .where(eq(aiSessions.userId, request.user.sub))
      .orderBy(desc(aiSessions.updatedAt))
      .limit(200)
    return reply.send({ data: rows })
  })

  // POST /api/ai/sessions — start a new chat
  app.post('/sessions', async (request, reply) => {
    const id = crypto.randomUUID()
    await db.insert(aiSessions).values({ id, userId: request.user.sub })
    const session = await ownedSession(request.user.sub, id)
    return reply.code(201).send({ data: session })
  })

  // PATCH /api/ai/sessions/:id { title }
  app.patch('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ title: z.string().min(1).max(255) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Validation Error' })
    if (!(await ownedSession(request.user.sub, id))) return reply.code(404).send({ error: 'Session not found' })
    await db.update(aiSessions).set({ title: body.data.title }).where(eq(aiSessions.id, id))
    return reply.send({ data: await ownedSession(request.user.sub, id) })
  })

  // DELETE /api/ai/sessions/:id
  app.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await ownedSession(request.user.sub, id))) return reply.code(404).send({ error: 'Session not found' })
    await deleteSession(request.user.sub, id)
    return reply.code(204).send()
  })

  // GET /api/ai/sessions/:id/messages
  app.get('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await ownedSession(request.user.sub, id))) return reply.code(404).send({ error: 'Session not found' })
    return reply.send({ data: await listSessionMessages(id) })
  })

  // POST /api/ai/sessions/:id/messages — multipart: content + files[]
  app.post('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!aiConfigured()) {
      return reply.code(503).send({ error: 'AI not configured', message: 'OPENAI_API_KEY is not set on the server.' })
    }
    if (!(await ownedSession(request.user.sub, id))) return reply.code(404).send({ error: 'Session not found' })

    const { content, files, opt } = await parseChatMultipart(request)
    const NAME = /^[A-Za-z0-9][\w.:-]{0,99}$/
    const EFFORTS = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh']
    if (!NAME.test(opt.model ?? '') || !NAME.test(opt.imageModel ?? '')) {
      return reply.code(400).send({ error: 'Validation Error', message: 'Select a chat model and an image model.' })
    }
    if (!EFFORTS.includes(opt.reasoningEffort ?? '')) {
      return reply.code(400).send({ error: 'Validation Error', message: 'Invalid reasoning effort.' })
    }
    if (!content && !files.length) return reply.code(400).send({ error: 'Send a message or attach a file.' })

    try {
      const result = await sendMessage({
        userId: request.user.sub,
        sessionId: id,
        content,
        files,
        run: { model: opt.model, imageModel: opt.imageModel, reasoningEffort: opt.reasoningEffort ?? '' },
      })
      return reply.send({ data: result })
    } catch (err: any) {
      request.log.error({ err }, 'AI chat failed')
      const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? 502 : 500
      return reply.code(status).send({
        error: 'AI request failed',
        message: err?.error?.message ?? err?.message ?? 'The AI request failed. Please try again.',
      })
    }
  })

  // GET /api/ai/attachments/:id — raw bytes (image / file), owner only
  app.get('/attachments/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [a] = await db
      .select()
      .from(aiAttachments)
      .where(and(eq(aiAttachments.id, id), eq(aiAttachments.userId, request.user.sub)))
      .limit(1)
    if (!a) return reply.code(404).send({ error: 'Attachment not found' })
    const safeName = encodeURIComponent(a.name)
    return reply
      .header('Content-Type', a.mimeType)
      .header('Content-Disposition', `inline; filename*=UTF-8''${safeName}`)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(a.data)
  })
}
