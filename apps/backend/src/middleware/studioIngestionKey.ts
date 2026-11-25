import crypto from 'crypto'
import { FastifyRequest, FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { db, users } from '../db'

// Ingestion keys are high-entropy random tokens (not user passwords), so a
// fast equality-lookup hash (SHA-256) is the right tool here, not bcrypt --
// it lets us resolve the owning user directly from the header instead of
// iterating every user's hash.
export function hashIngestionKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

export function generateIngestionKey(): string {
  return `studio_${crypto.randomBytes(24).toString('hex')}`
}

declare module 'fastify' {
  interface FastifyRequest {
    studioUserId?: string
  }
}

/**
 * Authenticates a request using a per-user Studio AI ingestion key
 * (`x-api-key` header) instead of a JWT. This is what a future WhatsApp
 * capture bridge/importer calls -- it writes directly into a user's
 * knowledge base, so it's scoped per tenant rather than one global secret.
 */
export async function requireStudioIngestionKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key']
  if (!apiKey || typeof apiKey !== 'string') {
    reply.code(401).send({ error: 'Missing x-api-key header' })
    return
  }

  const hash = hashIngestionKey(apiKey)
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.studioIngestionKeyHash, hash)).limit(1)

  if (!user) {
    reply.code(401).send({ error: 'Invalid API key' })
    return
  }

  request.studioUserId = user.id
}
