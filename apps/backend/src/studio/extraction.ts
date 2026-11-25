import { eq, and } from 'drizzle-orm'
import { openai } from '../lib/openai'
import { config } from '../config'
import { db, studioDecisions, studioTasks, studioDeadlines, studioQuotes, studioVendors, studioMaterials } from '../db'

export interface ExtractedFacts {
  decisions: Array<{ topic: string; decision: string; decision_by?: string; confidence: number }>
  tasks: Array<{ title: string; description?: string; assigned_to?: string; due_date?: string; priority?: string }>
  prices: Array<{
    material?: string
    vendor?: string
    price?: number
    unit?: string
    status?: 'quoted' | 'revised' | 'approved' | 'rejected'
  }>
  deadlines: Array<{ description: string; due_date?: string }>
  materials: string[]
}

const SYSTEM_PROMPT = `You are an information-extraction engine for an interior design studio's
WhatsApp conversations. Extract ONLY what is explicitly stated or strongly implied in the
message. Never invent details. If nothing of a given category is present, return an empty array
for it. Respond ONLY with JSON matching this shape:

{
  "decisions": [{"topic": string, "decision": string, "decision_by": string|null, "confidence": number}],
  "tasks": [{"title": string, "description": string|null, "assigned_to": string|null, "due_date": string|null, "priority": "low"|"medium"|"high"}],
  "prices": [{"material": string|null, "vendor": string|null, "price": number|null, "unit": string|null, "status": "quoted"|"revised"|"approved"|"rejected"}],
  "deadlines": [{"description": string, "due_date": string|null}],
  "materials": [string]
}`

export async function extractFacts(messageText: string, messageDate: string): Promise<ExtractedFacts> {
  const empty: ExtractedFacts = { decisions: [], tasks: [], prices: [], deadlines: [], materials: [] }
  if (!config.openai.apiKey || !messageText || messageText.trim().length < 3) return empty

  try {
    const completion = await openai.chat.completions.create({
      model: config.openai.chatModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Message date: ${messageDate}\nMessage: "${messageText}"\n\nUse the message date to resolve relative dates like "Friday" or "next week" where possible.`,
        },
      ],
    })
    const parsed = JSON.parse(completion.choices[0].message.content || '{}')
    return {
      decisions: parsed.decisions ?? [],
      tasks: parsed.tasks ?? [],
      prices: parsed.prices ?? [],
      deadlines: parsed.deadlines ?? [],
      materials: parsed.materials ?? [],
    }
  } catch (err) {
    console.error('Fact extraction failed:', err)
    return empty
  }
}

export async function persistFacts(
  userId: string,
  facts: ExtractedFacts,
  ctx: { projectId: string | null; sourceMessageId?: string | null; sourceDocumentId?: string | null }
) {
  for (const d of facts.decisions) {
    await db.insert(studioDecisions).values({
      id: crypto.randomUUID(),
      userId,
      projectId: ctx.projectId,
      topic: d.topic,
      decision: d.decision,
      decisionBy: d.decision_by ?? null,
      sourceMessageId: ctx.sourceMessageId ?? null,
      sourceDocumentId: ctx.sourceDocumentId ?? null,
      confidence: String(d.confidence ?? 0.7),
    })
  }

  for (const t of facts.tasks) {
    await db.insert(studioTasks).values({
      id: crypto.randomUUID(),
      userId,
      projectId: ctx.projectId,
      title: t.title,
      description: t.description ?? null,
      assignedTo: t.assigned_to ?? null,
      priority: (t.priority as 'low' | 'medium' | 'high') ?? 'medium',
      dueDate: t.due_date ? new Date(t.due_date) : null,
      sourceMessageId: ctx.sourceMessageId ?? null,
    })
  }

  for (const dl of facts.deadlines) {
    await db.insert(studioDeadlines).values({
      id: crypto.randomUUID(),
      userId,
      projectId: ctx.projectId,
      description: dl.description,
      dueDate: dl.due_date ? new Date(dl.due_date) : null,
      sourceMessageId: ctx.sourceMessageId ?? null,
    })
  }

  for (const p of facts.prices) {
    let vendorId: string | null = null
    let materialId: string | null = null

    if (p.vendor) {
      const [existing] = await db
        .select({ id: studioVendors.id })
        .from(studioVendors)
        .where(and(eq(studioVendors.userId, userId), eq(studioVendors.name, p.vendor)))
        .limit(1)
      if (existing) {
        vendorId = existing.id
      } else {
        vendorId = crypto.randomUUID()
        await db.insert(studioVendors).values({ id: vendorId, userId, name: p.vendor })
      }
    }
    if (p.material) {
      materialId = crypto.randomUUID()
      await db.insert(studioMaterials).values({ id: materialId, userId, name: p.material })
    }

    await db.insert(studioQuotes).values({
      id: crypto.randomUUID(),
      userId,
      projectId: ctx.projectId,
      vendorId,
      materialId,
      description: p.material ?? null,
      price: p.price !== undefined && p.price !== null ? String(p.price) : null,
      unit: p.unit ?? null,
      status: p.status ?? 'quoted',
      quoteDate: new Date(),
      sourceMessageId: ctx.sourceMessageId ?? null,
      sourceDocumentId: ctx.sourceDocumentId ?? null,
      confidence: '0.7',
    })
  }
}
