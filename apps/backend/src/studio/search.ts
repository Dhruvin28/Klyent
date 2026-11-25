import { eq, and, desc, like, or } from 'drizzle-orm'
import { db, studioMessages, studioDocuments, studioDocumentChunks } from '../db'
import { embedText, cosineSimilarity } from './embeddings'

export interface SearchResult {
  kind: 'message' | 'document_chunk'
  id: string
  documentId?: string
  content: string
  projectId: string | null
  groupName?: string | null
  sender?: string | null
  fileName?: string | null
  timestamp?: Date | null
  score: number
}

export interface SearchFilters {
  projectId?: string | null
  limit?: number
}

// Rows scanned per table for in-Node cosine similarity. MySQL has no pgvector
// equivalent here, so instead of an index scan we score a bounded, recent
// candidate window per user/project — correct and fast at MVP data volumes
// (per-user data stays small). Revisit with a real vector store if a single
// studio's message/chunk volume grows into the tens of thousands.
const CANDIDATE_WINDOW = 500

/**
 * Hybrid retrieval: semantic (cosine similarity over stored embeddings)
 * across both messages and document_chunks, scoped to the owning user and
 * optionally a project.
 */
export async function hybridSearch(userId: string, questionText: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const limit = filters.limit ?? 12
  const embedding = await embedText(questionText)

  const msgConditions = [eq(studioMessages.userId, userId)]
  if (filters.projectId) msgConditions.push(eq(studioMessages.projectId, filters.projectId))

  const messageCandidates = await db
    .select()
    .from(studioMessages)
    .where(and(...msgConditions))
    .orderBy(desc(studioMessages.timestamp))
    .limit(CANDIDATE_WINDOW)

  const messageScored: SearchResult[] = messageCandidates
    .filter((m) => Array.isArray(m.embedding) && m.content)
    .map((m) => ({
      kind: 'message' as const,
      id: m.id,
      content: m.content as string,
      projectId: m.projectId,
      groupName: m.groupName,
      sender: m.sender,
      timestamp: m.timestamp,
      score: cosineSimilarity(embedding, m.embedding as number[]),
    }))

  const docConditions = [eq(studioDocuments.userId, userId)]
  if (filters.projectId) docConditions.push(eq(studioDocuments.projectId, filters.projectId))

  const chunkRows = await db
    .select({
      id: studioDocumentChunks.id,
      documentId: studioDocumentChunks.documentId,
      content: studioDocumentChunks.content,
      embedding: studioDocumentChunks.embedding,
      projectId: studioDocuments.projectId,
      fileName: studioDocuments.fileName,
      createdAt: studioDocuments.createdAt,
    })
    .from(studioDocumentChunks)
    .innerJoin(studioDocuments, eq(studioDocuments.id, studioDocumentChunks.documentId))
    .where(and(...docConditions))
    .limit(CANDIDATE_WINDOW)

  const chunkScored: SearchResult[] = chunkRows
    .filter((c) => Array.isArray(c.embedding))
    .map((c) => ({
      kind: 'document_chunk' as const,
      id: c.id,
      documentId: c.documentId,
      content: c.content,
      projectId: c.projectId,
      fileName: c.fileName,
      timestamp: c.createdAt,
      score: cosineSimilarity(embedding, c.embedding as number[]),
    }))

  const results = [...messageScored, ...chunkScored]
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

const STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'did', 'does', 'do', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'to',
  'of', 'for', 'about', 'with', 'and', 'or', 'in', 'on', 'at', 'this',
  'that', 'it', 'be', 'has', 'have', 'had',
])

/**
 * Pure keyword search, useful for exact phrase / code / price lookups, and
 * as the no-LLM fallback for /ask (semantic search needs an OpenAI key for
 * embeddings; this needs none). A whole question is tokenized into its
 * significant words and OR-matched rather than treated as one exact phrase.
 */
export async function keywordSearch(userId: string, term: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const limit = filters.limit ?? 12
  const words = term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))

  const keywordConditions = (words.length > 0 ? words : [term]).map((w) => like(studioMessages.content, `%${w}%`))

  const conditions = [eq(studioMessages.userId, userId), or(...keywordConditions)!]
  if (filters.projectId) conditions.push(eq(studioMessages.projectId, filters.projectId))

  const rows = await db
    .select()
    .from(studioMessages)
    .where(and(...conditions))
    .orderBy(desc(studioMessages.timestamp))
    .limit(limit)

  return rows.map((r) => ({
    kind: 'message' as const,
    id: r.id,
    content: r.content ?? '',
    projectId: r.projectId,
    groupName: r.groupName,
    sender: r.sender,
    timestamp: r.timestamp,
    score: 0.5,
  }))
}
