import { eq, and, desc } from 'drizzle-orm'
import { db, studioProjects } from '../db'
import { openai } from '../lib/openai'
import { config } from '../config'

export type StudioProject = typeof studioProjects.$inferSelect

export async function listProjects(userId: string): Promise<StudioProject[]> {
  return db
    .select()
    .from(studioProjects)
    .where(eq(studioProjects.userId, userId))
    .orderBy(desc(studioProjects.updatedAt))
}

export async function getProject(userId: string, id: string): Promise<StudioProject | null> {
  const [row] = await db
    .select()
    .from(studioProjects)
    .where(and(eq(studioProjects.id, id), eq(studioProjects.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function createProject(
  userId: string,
  input: { name: string; clientName?: string; siteAddress?: string; projectType?: string; budget?: number; timelineNotes?: string; clientId?: string }
): Promise<StudioProject> {
  const id = crypto.randomUUID()
  await db.insert(studioProjects).values({
    id,
    userId,
    name: input.name,
    clientName: input.clientName ?? null,
    siteAddress: input.siteAddress ?? null,
    projectType: input.projectType ?? null,
    budget: input.budget !== undefined ? String(input.budget) : null,
    timelineNotes: input.timelineNotes ?? null,
    clientId: input.clientId ?? null,
  })
  const [row] = await db.select().from(studioProjects).where(eq(studioProjects.id, id)).limit(1)
  return row
}

export async function findProjectByName(userId: string, name: string): Promise<StudioProject | null> {
  const rows = await db.select().from(studioProjects).where(eq(studioProjects.userId, userId))
  const needle = name.trim().toLowerCase()
  return rows.find((p) => p.name.trim().toLowerCase() === needle) ?? null
}

/**
 * Resolve a project for incoming content.
 *
 * Priority:
 *  1. The WhatsApp group is already mapped to a project -> confidence 1.0 (handled by the caller)
 *  2. groupName matches an existing project name closely -> confidence 0.95
 *  3. LLM guesses from content against the list of known projects -> variable confidence
 *  4. No match -> null project, confidence 0 (left for manual review)
 *
 * Low-confidence classification is surfaced rather than silently trusted.
 */
export async function detectProject(
  userId: string,
  params: { groupName?: string | null; content?: string | null }
): Promise<{ projectId: string | null; confidence: number }> {
  const { groupName, content } = params

  if (groupName) {
    const exact = await findProjectByName(userId, groupName)
    if (exact) return { projectId: exact.id, confidence: 0.95 }
  }

  const projects = await listProjects(userId)
  if (projects.length === 0) {
    return { projectId: null, confidence: 0 }
  }

  if (!config.openai.apiKey) {
    return { projectId: null, confidence: 0 }
  }

  const text = [groupName, content].filter(Boolean).join('\n')
  if (!text.trim()) {
    return { projectId: null, confidence: 0 }
  }

  try {
    const projectList = projects.map((p) => `- ${p.name} (id: ${p.id})`).join('\n')
    const completion = await openai.chat.completions.create({
      model: config.openai.chatModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You match WhatsApp group names/messages to an existing interior design project. ' +
            'Respond ONLY with JSON: {"project_id": string|null, "confidence": number between 0 and 1}. ' +
            'If nothing matches well, return project_id null and low confidence.',
        },
        {
          role: 'user',
          content: `Known projects:\n${projectList}\n\nGroup name: ${groupName || '(none)'}\nContent: ${text.slice(0, 1000)}`,
        },
      ],
    })
    const parsed = JSON.parse(completion.choices[0].message.content || '{}')
    const projectId = typeof parsed.project_id === 'string' ? parsed.project_id : null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    // Validate the returned id actually exists to avoid hallucinated ids.
    if (projectId && projects.some((p) => p.id === projectId)) {
      return { projectId, confidence }
    }
    return { projectId: null, confidence }
  } catch (err) {
    console.error('Project detection failed:', err)
    return { projectId: null, confidence: 0 }
  }
}
