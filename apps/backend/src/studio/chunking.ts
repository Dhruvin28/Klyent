/**
 * Simple, dependency-free text chunker. Splits on paragraph boundaries first,
 * then hard-wraps anything still too long. Good enough for BOQs, quotations,
 * catalogues and chat transcripts; swap for a token-aware splitter later if
 * documents start exceeding model context in a single chunk.
 */
export function chunkText(text: string, opts?: { maxChars?: number; overlapChars?: number }): string[] {
  const maxChars = opts?.maxChars ?? 1800 // ~450 tokens
  const overlapChars = opts?.overlapChars ?? 200

  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= maxChars) {
      current = current ? `${current}\n\n${para}` : para
      continue
    }

    if (current) chunks.push(current)

    if (para.length <= maxChars) {
      current = para
    } else {
      // Hard-wrap an oversized paragraph with overlap.
      let start = 0
      while (start < para.length) {
        const end = Math.min(start + maxChars, para.length)
        chunks.push(para.slice(start, end))
        start = end - overlapChars
        if (start < 0 || end === para.length) break
      }
      current = ''
    }
  }

  if (current) chunks.push(current)

  return chunks
}
