import { eq, and, or, like, desc, asc, count, sql } from 'drizzle-orm'
import {
  db,
  studioMessages,
  studioDocuments,
  studioTasks,
  studioDecisions,
  studioQuotes,
  studioVendors,
  studioMaterials,
  studioDeadlines,
} from '../db'
import { hybridSearch } from './search'
import { listProjects, findProjectByName } from './projectService'

/**
 * Tool implementations backing the agent's OpenAI function-calling loop.
 * The agent gets tools, not the whole database. Every tool is scoped to the
 * calling user (`userId`) since Klyent is multi-tenant.
 */

export async function search_messages(userId: string, args: { query: string; project_name?: string; limit?: number }) {
  const project = args.project_name ? await findProjectByName(userId, args.project_name) : null
  const results = await hybridSearch(userId, args.query, { projectId: project?.id ?? null, limit: args.limit ?? 8 })
  return results.filter((r) => r.kind === 'message')
}

export async function search_documents(userId: string, args: { query: string; project_name?: string; limit?: number }) {
  const project = args.project_name ? await findProjectByName(userId, args.project_name) : null
  const results = await hybridSearch(userId, args.query, { projectId: project?.id ?? null, limit: args.limit ?? 8 })
  return results.filter((r) => r.kind === 'document_chunk')
}

export async function search_projects(userId: string, args: { name_contains?: string }) {
  const all = await listProjects(userId)
  if (!args.name_contains) return all
  const needle = args.name_contains.toLowerCase()
  return all.filter((p) => p.name.toLowerCase().includes(needle))
}

export async function search_decisions(userId: string, args: { project_name?: string; topic?: string; limit?: number }) {
  const project = args.project_name ? await findProjectByName(userId, args.project_name) : null
  const conditions = [eq(studioDecisions.userId, userId)]
  if (project) conditions.push(eq(studioDecisions.projectId, project.id))
  if (args.topic) {
    conditions.push(
      or(like(studioDecisions.topic, `%${args.topic}%`), like(studioDecisions.decision, `%${args.topic}%`))!
    )
  }
  return db
    .select()
    .from(studioDecisions)
    .where(and(...conditions))
    .orderBy(desc(studioDecisions.createdAt))
    .limit(args.limit ?? 10)
}

export async function search_tasks(userId: string, args: { project_name?: string; status?: string; limit?: number }) {
  const project = args.project_name ? await findProjectByName(userId, args.project_name) : null
  const conditions = [eq(studioTasks.userId, userId)]
  if (project) conditions.push(eq(studioTasks.projectId, project.id))
  if (args.status) conditions.push(eq(studioTasks.status, args.status as any))
  return db
    .select()
    .from(studioTasks)
    .where(and(...conditions))
    .orderBy(sql`(${studioTasks.dueDate} IS NULL)`, asc(studioTasks.dueDate), desc(studioTasks.createdAt))
    .limit(args.limit ?? 20)
}

export async function search_quotes(userId: string, args: { project_name?: string; material?: string; limit?: number }) {
  const project = args.project_name ? await findProjectByName(userId, args.project_name) : null
  const conditions = [eq(studioQuotes.userId, userId)]
  if (project) conditions.push(eq(studioQuotes.projectId, project.id))
  if (args.material) {
    conditions.push(
      or(like(studioQuotes.description, `%${args.material}%`), like(studioMaterials.name, `%${args.material}%`))!
    )
  }
  const rows = await db
    .select({
      id: studioQuotes.id,
      projectId: studioQuotes.projectId,
      description: studioQuotes.description,
      price: studioQuotes.price,
      unit: studioQuotes.unit,
      status: studioQuotes.status,
      quoteDate: studioQuotes.quoteDate,
      createdAt: studioQuotes.createdAt,
      vendorName: studioVendors.name,
      materialName: studioMaterials.name,
    })
    .from(studioQuotes)
    .leftJoin(studioVendors, eq(studioVendors.id, studioQuotes.vendorId))
    .leftJoin(studioMaterials, eq(studioMaterials.id, studioQuotes.materialId))
    .where(and(...conditions))
    .orderBy(desc(studioQuotes.createdAt))
    .limit(args.limit ?? 10)
  return rows
}

export async function get_project_summary(userId: string, args: { project_name: string }) {
  const project = await findProjectByName(userId, args.project_name)
  if (!project) return { error: 'Project not found' }

  const [[taskStats], [decisionStats], [docStats], [quoteStats]] = await Promise.all([
    db
      .select({
        pending: count(sql`CASE WHEN ${studioTasks.status} != 'done' THEN 1 END`),
        total: count(),
      })
      .from(studioTasks)
      .where(and(eq(studioTasks.userId, userId), eq(studioTasks.projectId, project.id))),
    db
      .select({ total: count() })
      .from(studioDecisions)
      .where(and(eq(studioDecisions.userId, userId), eq(studioDecisions.projectId, project.id))),
    db
      .select({ total: count() })
      .from(studioDocuments)
      .where(and(eq(studioDocuments.userId, userId), eq(studioDocuments.projectId, project.id))),
    db
      .select({ total: count() })
      .from(studioQuotes)
      .where(and(eq(studioQuotes.userId, userId), eq(studioQuotes.projectId, project.id))),
  ])

  return { project, tasks: taskStats, decisions: decisionStats, documents: docStats, quotes: quoteStats }
}

export async function get_recent_activity(userId: string, args: { project_name?: string; limit?: number }) {
  const project = args.project_name ? await findProjectByName(userId, args.project_name) : null
  const conditions = [eq(studioMessages.userId, userId)]
  if (project) conditions.push(eq(studioMessages.projectId, project.id))
  return db
    .select({
      id: studioMessages.id,
      groupName: studioMessages.groupName,
      sender: studioMessages.sender,
      content: studioMessages.content,
      messageType: studioMessages.messageType,
      timestamp: studioMessages.timestamp,
    })
    .from(studioMessages)
    .where(and(...conditions))
    .orderBy(desc(studioMessages.timestamp))
    .limit(args.limit ?? 20)
}

export async function get_pending_tasks(userId: string, args: { project_name?: string }) {
  return search_tasks(userId, { project_name: args.project_name, status: 'open' })
}

export async function get_deadlines(userId: string, args: { project_name?: string; limit?: number }) {
  const project = args.project_name ? await findProjectByName(userId, args.project_name) : null
  const conditions = [eq(studioDeadlines.userId, userId)]
  if (project) conditions.push(eq(studioDeadlines.projectId, project.id))
  return db
    .select()
    .from(studioDeadlines)
    .where(and(...conditions))
    .orderBy(sql`(${studioDeadlines.dueDate} IS NULL)`, asc(studioDeadlines.dueDate))
    .limit(args.limit ?? 20)
}

export async function find_source_message(userId: string, args: { message_id: string }) {
  const [row] = await db
    .select()
    .from(studioMessages)
    .where(and(eq(studioMessages.id, args.message_id), eq(studioMessages.userId, userId)))
    .limit(1)
  return row ?? null
}

export const TOOL_IMPLEMENTATIONS: Record<string, (userId: string, args: any) => Promise<any>> = {
  search_messages,
  search_documents,
  search_projects,
  search_decisions,
  search_tasks,
  search_quotes,
  get_project_summary,
  get_recent_activity,
  get_pending_tasks,
  get_deadlines,
  find_source_message,
}

export const TOOL_SCHEMAS = [
  tool('search_messages', 'Semantic + keyword search over WhatsApp message content.', {
    query: { type: 'string', description: 'What to search for' },
    project_name: { type: 'string', description: 'Optional project name to filter by' },
  }),
  tool('search_documents', 'Semantic + keyword search over uploaded document text (BOQs, quotations, catalogues, etc).', {
    query: { type: 'string' },
    project_name: { type: 'string' },
  }),
  tool('search_projects', 'List known projects, optionally filtered by partial name.', {
    name_contains: { type: 'string' },
  }),
  tool('search_decisions', 'Search recorded decisions (approvals, finalizations).', {
    project_name: { type: 'string' },
    topic: { type: 'string' },
  }),
  tool('search_tasks', 'Search tasks/action items.', {
    project_name: { type: 'string' },
    status: { type: 'string', description: 'open|in_progress|done|cancelled' },
  }),
  tool('search_quotes', 'Search vendor price quotes and their status (quoted/revised/approved).', {
    project_name: { type: 'string' },
    material: { type: 'string' },
  }),
  tool(
    'get_project_summary',
    'Get a quick stats summary for a project (pending tasks, decisions, documents, quotes).',
    { project_name: { type: 'string' } },
    ['project_name']
  ),
  tool('get_recent_activity', 'Get the most recent messages, optionally scoped to a project.', {
    project_name: { type: 'string' },
  }),
  tool('get_pending_tasks', 'Get open/pending tasks, optionally scoped to a project.', {
    project_name: { type: 'string' },
  }),
  tool('get_deadlines', 'Get upcoming/known deadlines, optionally scoped to a project.', {
    project_name: { type: 'string' },
  }),
]

function tool(name: string, description: string, properties: Record<string, any>, required: string[] = []) {
  return {
    type: 'function' as const,
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  }
}
