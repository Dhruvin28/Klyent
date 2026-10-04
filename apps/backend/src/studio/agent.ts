import { openai } from '../lib/openai'
import { config } from '../config'
import { TOOL_SCHEMAS, TOOL_IMPLEMENTATIONS } from './tools'
import { keywordSearch } from './search'

export interface AskSource {
  kind: string
  id: string
  label: string
  excerpt: string
}

export interface AskResponse {
  answer: string
  sources: AskSource[]
}

const SYSTEM_PROMPT = `You are an AI project assistant for an interior design business ("Studio AI").

Your job is to help the user retrieve and understand information from project WhatsApp
conversations and documents (quotations, BOQs, drawings, catalogues, contracts).

Rules:
1. Prefer retrieved source information over assumptions. Use the provided tools to search
   before answering factual questions.
2. Never invent project details, prices, dates or names that are not in the retrieved data.
2b. Structured tools (search_quotes, search_decisions, search_tasks) only see facts that were
   already extracted into the database. If one of them comes back empty, that does NOT mean the
   information doesn't exist -- it may only be in the raw conversation or an uploaded document
   that wasn't structured yet. Before concluding something is "not found", also try
   search_documents and search_messages with relevant keywords. Only say information is missing
   after checking both structured tools AND raw search.
3. If information is uncertain or not found, explicitly say so -- do not guess.
4. Always identify the project when possible.
5. When answering factual questions, cite the source (group/document name and date).
6. Prefer the most recent confirmed information over older discussion.
7. Distinguish between discussion, proposal and final decision.
8. Distinguish quoted prices from approved/final prices. If multiple prices exist, list all of
   them with their status and let the latest CONFIRMED/APPROVED one stand out.
9. Identify pending tasks and deadlines when relevant to the question.
10. If conflicting information exists, surface the conflict instead of silently picking one.

Keep answers concise and structured. End with a "Sources:" list referencing where each fact
came from (e.g. "Patel Residence group, 18 Sept" or "Kitchen Quotation.pdf").`

/**
 * Agentic RAG: lets the model call search tools instead of stuffing the
 * whole DB into the prompt. Falls back to a direct hybrid-search
 * context-stuffing approach if no OpenAI key is configured, so the
 * retrieval pipeline can still be smoke-tested without billing.
 */
export async function askQuestion(userId: string, question: string, opts: { projectName?: string } = {}): Promise<AskResponse> {
  if (!config.openai.apiKey) {
    return askWithoutLLM(userId, question)
  }

  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: opts.projectName ? `[Project context: ${opts.projectName}]\n${question}` : question },
  ]

  const collectedSources: AskSource[] = []
  const seen = new Set<string>()

  for (let turn = 0; turn < 5; turn++) {
    const completion = await openai.chat.completions.create({
      model: config.openai.chatModel,
      messages,
      tools: TOOL_SCHEMAS,
      tool_choice: 'auto',
    })

    const choice = completion.choices[0]
    const msg = choice.message
    messages.push(msg as any)

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { answer: msg.content || '', sources: collectedSources }
    }

    for (const call of msg.tool_calls) {
      const fn = TOOL_IMPLEMENTATIONS[call.function.name]
      let result: any
      try {
        const args = JSON.parse(call.function.arguments || '{}')
        result = fn ? await fn(userId, args) : { error: 'Unknown tool' }
      } catch (err: any) {
        result = { error: err.message }
      }

      recordSources(result, collectedSources, seen)

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 6000),
      })
    }
  }

  return {
    answer: 'I gathered information but could not finalize an answer in time. Please try a more specific question.',
    sources: collectedSources,
  }
}

function recordSources(result: any, collected: AskSource[], seen: Set<string>) {
  const items = Array.isArray(result) ? result : [result]
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const id = item.id || item.documentId || item.document_id
    if (!id || seen.has(id)) continue
    const label = item.fileName || item.file_name || item.groupName || item.group_name || 'Source'
    const excerpt = (item.content || item.decision || item.title || '').toString().slice(0, 200)
    if (!excerpt) continue
    seen.add(id)
    collected.push({
      kind: item.kind || 'record',
      id,
      label: `${label}${item.timestamp ? ` — ${new Date(item.timestamp).toLocaleDateString()}` : ''}`,
      excerpt,
    })
  }
}

/**
 * Fallback path with no LLM configured: plain keyword search, no synthesis
 * and no embedding calls (semantic search needs the same OpenAI key this
 * path exists because we don't have).
 */
async function askWithoutLLM(userId: string, question: string): Promise<AskResponse> {
  const results = await keywordSearch(userId, question, { limit: 8 })
  const sources: AskSource[] = results.map((r) => ({
    kind: r.kind,
    id: r.id,
    label: r.fileName || r.groupName || 'Source',
    excerpt: r.content.slice(0, 200),
  }))
  return {
    answer:
      'OPENAI_API_KEY is not configured, so I can only show raw matching passages (no AI synthesis). Configure OPENAI_API_KEY to get a direct answer.',
    sources,
  }
}
