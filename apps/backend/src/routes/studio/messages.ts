import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { requireStudioIngestionKey } from '../../middleware/studioIngestionKey'
import { ingestMessage, listMessages } from '../../studio/messageService'

export default async function studioMessageRoutes(app: FastifyInstance) {
  // GET /api/studio/messages?projectId=... — requires normal JWT auth
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { projectId, limit } = request.query as { projectId?: string; limit?: string }
    const messages = await listMessages(userId, { projectId, limit: limit ? Number(limit) : undefined })
    return reply.send({ data: messages })
  })

  /**
   * POST /api/studio/messages — generic, provider-agnostic ingestion endpoint
   * (multipart form: group_name, timestamp, message, + optional media file
   * and metadata fields). This is the one endpoint any capture layer calls —
   * a manual import script, a self-hosted bridge, or the official WhatsApp
   * Cloud API webhook — without the rest of the system ever changing.
   *
   * Authenticated with a per-user Studio AI ingestion key (`x-api-key`),
   * not a JWT, since the caller is a bridge/script, not a logged-in browser.
   */
  app.post('/', { preHandler: requireStudioIngestionKey }, async (request, reply) => {
    const userId = request.studioUserId!
    let data: Awaited<ReturnType<typeof request.file>> | null = null
    if (request.isMultipart()) {
      try {
        data = await request.file()
      } catch {
        data = null
      }
    }

    const fields = data?.fields ?? (request.body as Record<string, any>) ?? {}
    const field = (name: string): string | undefined => {
      const f = fields[name]
      return f && typeof f === 'object' && 'value' in f ? f.value : f
    }

    const groupName = field('group_name')
    const timestamp = field('timestamp')
    if (!groupName || !timestamp) {
      if (data?.file) data.file.resume()
      return reply.code(400).send({ error: 'group_name and timestamp are required' })
    }

    let media: { buffer: Buffer; fileName: string; mimeType: string } | null = null
    if (data?.file) {
      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk as Buffer)
      media = { buffer: Buffer.concat(chunks), fileName: data.filename, mimeType: data.mimetype }
    }

    const message = await ingestMessage(userId, {
      source: field('source'),
      group_id: field('group_id'),
      group_name: groupName,
      sender: field('sender'),
      sender_id: field('sender_id'),
      message: field('message') || '',
      message_type: field('message_type'),
      timestamp,
      external_message_id: field('external_message_id'),
      reply_to_external_id: field('reply_to_external_id'),
      media,
    })

    return reply.code(201).send({ data: message })
  })
}
