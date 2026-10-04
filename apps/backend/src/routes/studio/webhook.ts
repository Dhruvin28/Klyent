import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { db, users } from '../../db'
import { config } from '../../config'
import { ingestMessage } from '../../studio/messageService'

/**
 * Option A groundwork: official WhatsApp Cloud API webhook scaffold. Off
 * until STUDIO_WHATSAPP_* env vars are configured. NOT wired to any group by
 * default -- the Cloud API's group-messaging support is limited and does not
 * retroactively grant access to arbitrary pre-existing personal WhatsApp
 * groups. Validate current capability against Meta's docs for your use case
 * before enabling this; Option C (the import page) and a self-hosted bridge
 * (Option B) remain the practical paths for "one group per project" studios.
 *
 * Multi-tenant note: a single Meta app/number maps to exactly one Klyent
 * user via STUDIO_WHATSAPP_OWNER_USER_ID-style resolution once this is
 * actually enabled -- resolve the owning user from the phone_number_id
 * mapping when wiring this up for real.
 */
export default async function studioWebhookRoutes(app: FastifyInstance) {
  // Meta verification handshake.
  app.get('/', async (request, reply) => {
    const query = request.query as Record<string, string>
    const mode = query['hub.mode']
    const token = query['hub.verify_token']
    const challenge = query['hub.challenge']

    if (config.studioWhatsapp.verifyToken && mode === 'subscribe' && token === config.studioWhatsapp.verifyToken) {
      return reply.code(200).send(challenge)
    }
    return reply.code(403).send()
  })

  // Inbound message/media events.
  app.post('/', async (request, reply) => {
    if (!config.studioWhatsapp.accessToken) {
      // Not configured — scaffold only.
      return reply.code(503).send({ error: 'Studio AI WhatsApp webhook is not configured' })
    }

    try {
      if (config.studioWhatsapp.appSecret) {
        // NOTE: HMAC verification needs the raw request body, which requires
        // a custom JSON content-type parser that stashes the raw buffer
        // before parsing (Fastify doesn't expose it by default). Add that
        // when actually enabling Option A — until then this branch is
        // unreachable because the route 503s above without an access token.
        const signature = request.headers['x-hub-signature-256']
        if (!verifySignature((request as any).rawBody, typeof signature === 'string' ? signature : undefined)) {
          return reply.code(401).send()
        }
      }

      // A real deployment resolves the owning Klyent user from the webhook's
      // phone_number_id (one Meta number per studio). Until that mapping
      // exists, route to the first configured owner as a scaffold default.
      const [owner] = await db.select({ id: users.id }).from(users).limit(1)
      if (!owner) return reply.code(200).send()

      const body = request.body as any
      const entries = body?.entry || []
      for (const entry of entries) {
        for (const change of entry.changes || []) {
          const value = change.value
          for (const msg of value?.messages || []) {
            await ingestMessage(owner.id, {
              source: 'whatsapp',
              group_id: value.metadata?.phone_number_id,
              group_name: value.contacts?.[0]?.profile?.name || 'Unknown',
              sender: value.contacts?.[0]?.profile?.name,
              sender_id: msg.from,
              message: msg.text?.body || msg.caption || '',
              message_type: msg.type,
              timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
              external_message_id: msg.id,
            })
          }
        }
      }

      return reply.code(200).send()
    } catch (err) {
      console.error('Studio WhatsApp webhook error:', err)
      return reply.code(500).send()
    }
  })
}

function verifySignature(rawBody: Buffer | undefined, signatureHeader?: string): boolean {
  if (!signatureHeader || !rawBody) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', config.studioWhatsapp.appSecret).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}
