import { openai } from '../lib/openai'
import { config } from '../config'

export async function embedText(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: text.slice(0, 8000), // defensive cap
  })
  return res.data[0].embedding
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const res = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: texts.map((t) => t.slice(0, 8000)),
  })
  return res.data.map((d) => d.embedding)
}

/** Cosine similarity between two equal-length embedding vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
