import { eq, and, desc } from 'drizzle-orm'
import { db, studioMessages, studioWhatsappGroups, studioMessageMedia } from '../db'
import { detectProject, findProjectByName } from './projectService'
import { embedText } from './embeddings'
import { extractFacts, persistFacts } from './extraction'
import { ingestDocument } from './documentService'

export type StudioMessage = typeof studioMessages.$inferSelect

export interface IncomingMessage {
  source?: string // "whatsapp" | "manual_import"
  group_id?: string | null // external whatsapp group id
  group_name: string
  sender?: string | null
  sender_id?: string | null
  message: string // text content, or caption for media
  message_type?: string // text|image|pdf|docx|xlsx|voice|video|location|contact|link
  timestamp: string // ISO date
  external_message_id?: string | null
  reply_to_external_id?: string | null
  media?: {
    buffer: Buffer
    fileName: string
    mimeType: string
  } | null
}

async function resolveGroup(
  userId: string,
  groupName: string,
  externalGroupId?: string | null
): Promise<{ id: string; projectId: string | null }> {
  const conditions = externalGroupId
    ? and(eq(studioWhatsappGroups.userId, userId), eq(studioWhatsappGroups.externalGroupId, externalGroupId))
    : and(eq(studioWhatsappGroups.userId, userId), eq(studioWhatsappGroups.name, groupName))

  const [existing] = await db.select().from(studioWhatsappGroups).where(conditions).limit(1)
  if (existing) return { id: existing.id, projectId: existing.projectId }

  const id = crypto.randomUUID()
  await db.insert(studioWhatsappGroups).values({
    id,
    userId,
    name: groupName,
    externalGroupId: externalGroupId ?? null,
  })
  return { id, projectId: null }
}

/**
 * Ingest one message (text or media) from any source. This is the single
 * entry point any capture layer (manual import, a live bridge, or the
 * official Cloud API webhook) calls -- it is provider-agnostic so swapping
 * the capture mechanism never touches this pipeline.
 */
export async function ingestMessage(userId: string, input: IncomingMessage): Promise<StudioMessage> {
  const group = await resolveGroup(userId, input.group_name, input.group_id)

  let projectId = group.projectId
  let confidence = projectId ? 1 : 0
  if (!projectId) {
    const detection = await detectProject(userId, { groupName: input.group_name, content: input.message })
    projectId = detection.projectId
    confidence = detection.confidence
  }

  let replyToId: string | null = null
  if (input.reply_to_external_id) {
    const [parent] = await db
      .select({ id: studioMessages.id })
      .from(studioMessages)
      .where(and(eq(studioMessages.userId, userId), eq(studioMessages.externalMessageId, input.reply_to_external_id)))
      .limit(1)
    replyToId = parent?.id ?? null
  }

  const messageType = input.message_type || (input.media ? guessTypeFromMime(input.media.mimeType) : 'text')

  let embedding: number[] | null = null
  if (input.message && input.message.trim().length > 2) {
    try {
      embedding = await embedText(input.message)
    } catch (err) {
      console.error('Message embedding failed:', err)
    }
  }

  const id = crypto.randomUUID()
  await db
    .insert(studioMessages)
    .values({
      id,
      userId,
      source: input.source || 'whatsapp',
      groupId: group.id,
      groupName: input.group_name,
      projectId,
      projectConfidence: String(confidence),
      sender: input.sender ?? null,
      senderId: input.sender_id ?? null,
      messageType,
      content: input.message ?? '',
      replyToMessageId: replyToId,
      externalMessageId: input.external_message_id ?? null,
      embedding,
      timestamp: new Date(input.timestamp),
    })
    .onDuplicateKeyUpdate({ set: { content: input.message ?? '', embedding } })

  const message = input.external_message_id
    ? (
        await db
          .select()
          .from(studioMessages)
          .where(and(eq(studioMessages.userId, userId), eq(studioMessages.externalMessageId, input.external_message_id)))
          .limit(1)
      )[0]
    : (await db.select().from(studioMessages).where(eq(studioMessages.id, id)).limit(1))[0]

  // Media: store the file, run OCR/text extraction, chunk + embed it as a document
  // linked back to this message.
  if (input.media) {
    const doc = await ingestDocument(userId, {
      buffer: input.media.buffer,
      fileName: input.media.fileName,
      mimeType: input.media.mimeType,
      groupName: input.group_name,
      sourceMessageId: message.id,
      projectIdHint: projectId,
    })
    await db.insert(studioMessageMedia).values({
      id: crypto.randomUUID(),
      messageId: message.id,
      fileName: input.media.fileName,
      mimeType: input.media.mimeType,
      storageUrl: doc.storageUrl,
      mediaKind: guessMediaKind(input.media.mimeType),
    })
  }

  // Fact extraction (kept inline/awaited for MVP simplicity; move to a queue
  // before production volume).
  if (input.message && input.message.trim().length > 2) {
    try {
      const facts = await extractFacts(input.message, input.timestamp)
      await persistFacts(userId, facts, { projectId, sourceMessageId: message.id })
    } catch (err) {
      console.error('Fact extraction/persist failed:', err)
    }
  }

  return message
}

function guessTypeFromMime(mime: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'voice'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('word')) return 'docx'
  if (mime.includes('sheet') || mime.includes('excel')) return 'xlsx'
  return 'document'
}

function guessMediaKind(mime: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

export async function listMessages(userId: string, params: { projectId?: string; limit?: number }): Promise<StudioMessage[]> {
  const conditions = [eq(studioMessages.userId, userId)]
  if (params.projectId) conditions.push(eq(studioMessages.projectId, params.projectId))
  return db
    .select()
    .from(studioMessages)
    .where(and(...conditions))
    .orderBy(desc(studioMessages.timestamp))
    .limit(params.limit ?? 100)
}
