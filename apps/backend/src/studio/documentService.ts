import { eq, and, desc } from 'drizzle-orm'
import { db, studioDocuments, studioDocumentChunks } from '../db'
import { uploadToS3 } from '../lib/s3'
import { extractText } from './textExtract'
import { chunkText } from './chunking'
import { embedBatch } from './embeddings'
import { detectProject } from './projectService'
import { openai } from '../lib/openai'
import { config } from '../config'
import { extractFacts, persistFacts } from './extraction'

export type StudioDocument = typeof studioDocuments.$inferSelect

const DOCUMENT_TYPES = [
  'boq',
  'quotation',
  'invoice',
  'purchase_order',
  'floor_plan',
  'electrical_drawing',
  'furniture_drawing',
  'material_catalogue',
  'client_brief',
  'contract',
  'estimate',
  'payment_receipt',
  'other',
]

async function classifyDocument(text: string, fileName: string): Promise<string> {
  if (!config.openai.apiKey || !text.trim()) return 'other'
  try {
    const completion = await openai.chat.completions.create({
      model: config.openai.chatModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Classify an interior-design business document into exactly one of: ${DOCUMENT_TYPES.join(
            ', '
          )}. Respond ONLY as JSON: {"document_type": string}`,
        },
        { role: 'user', content: `File name: ${fileName}\n\nContent (truncated):\n${text.slice(0, 3000)}` },
      ],
    })
    const parsed = JSON.parse(completion.choices[0].message.content || '{}')
    return DOCUMENT_TYPES.includes(parsed.document_type) ? parsed.document_type : 'other'
  } catch (err) {
    console.error('Document classification failed:', err)
    return 'other'
  }
}

export async function ingestDocument(
  userId: string,
  params: {
    buffer: Buffer
    fileName: string
    mimeType: string
    groupName?: string | null
    sourceMessageId?: string | null
    uploadedBy?: string | null
    projectIdHint?: string | null
  }
): Promise<StudioDocument> {
  const { buffer, fileName, mimeType } = params

  const key = `studio/${userId}/documents/${crypto.randomUUID()}-${fileName}`
  const storageUrl = await uploadToS3(key, buffer, mimeType || 'application/octet-stream')
  const { text, ocrUsed } = await extractText(buffer, mimeType, fileName)
  const documentType = await classifyDocument(text, fileName)

  let projectId = params.projectIdHint ?? null
  let confidence = projectId ? 1 : 0
  if (!projectId) {
    const detection = await detectProject(userId, { groupName: params.groupName, content: text.slice(0, 2000) })
    projectId = detection.projectId
    confidence = detection.confidence
  }

  const id = crypto.randomUUID()
  await db.insert(studioDocuments).values({
    id,
    userId,
    projectId,
    projectConfidence: String(confidence),
    sourceMessageId: params.sourceMessageId ?? null,
    fileName,
    mimeType,
    storageUrl,
    extractedText: text,
    documentType,
    ocrUsed,
    uploadedBy: params.uploadedBy ?? null,
  })

  const [doc] = await db.select().from(studioDocuments).where(eq(studioDocuments.id, id)).limit(1)

  await chunkAndEmbedDocument(doc.id, text)

  // Documents (BOQs, quotations, invoices...) carry the same kinds of facts
  // as messages -- prices, decisions, deadlines -- so run the same
  // extraction pipeline and link results back to this document.
  if (text && text.trim().length > 10) {
    try {
      const facts = await extractFacts(text, new Date().toISOString())
      await persistFacts(userId, facts, { projectId, sourceDocumentId: doc.id })
    } catch (err) {
      console.error('Document fact extraction/persist failed:', err)
    }
  }

  return doc
}

export async function chunkAndEmbedDocument(documentId: string, text: string) {
  const chunks = chunkText(text)
  if (chunks.length === 0) return

  // Without an OpenAI key, store chunks unembedded (still keyword-searchable
  // via LIKE, just not semantically) instead of failing the whole upload.
  let embeddings: (number[] | null)[] = chunks.map(() => null)
  if (config.openai.apiKey) {
    try {
      embeddings = await embedBatch(chunks)
    } catch (err) {
      console.error('Chunk embedding failed:', err)
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    await db.insert(studioDocumentChunks).values({
      id: crypto.randomUUID(),
      documentId,
      chunkIndex: i,
      content: chunks[i],
      embedding: embeddings[i],
    })
  }
}

export async function listDocuments(userId: string, projectId?: string): Promise<StudioDocument[]> {
  const conditions = [eq(studioDocuments.userId, userId)]
  if (projectId) conditions.push(eq(studioDocuments.projectId, projectId))
  return db
    .select()
    .from(studioDocuments)
    .where(and(...conditions))
    .orderBy(desc(studioDocuments.createdAt))
    .limit(200)
}

export async function getDocument(userId: string, id: string): Promise<StudioDocument | null> {
  const [row] = await db
    .select()
    .from(studioDocuments)
    .where(and(eq(studioDocuments.id, id), eq(studioDocuments.userId, userId)))
    .limit(1)
  return row ?? null
}
