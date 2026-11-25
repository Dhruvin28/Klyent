import { FastifyInstance } from 'fastify'
import { eq, and, gte, ne, sql, count } from 'drizzle-orm'
import { db, studioProjects, studioDocuments, studioQuotes, studioDecisions, studioDeadlines, studioTasks } from '../../db'
import { authenticate } from '../../middleware/authenticate'

export default async function studioSummaryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/summary/daily
  app.get('/daily', async (request, reply) => {
    const userId = request.user.sub
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

    const [[activeProjects], [newDocsToday], [newQuotesToday], [decisionsToday], deadlinesSoon, pendingHighPriority] =
      await Promise.all([
        db.select({ c: count() }).from(studioProjects).where(and(eq(studioProjects.userId, userId), eq(studioProjects.status, 'ACTIVE'))),
        db.select({ c: count() }).from(studioDocuments).where(and(eq(studioDocuments.userId, userId), gte(studioDocuments.createdAt, startOfDay))),
        db.select({ c: count() }).from(studioQuotes).where(and(eq(studioQuotes.userId, userId), gte(studioQuotes.createdAt, startOfDay))),
        db.select({ c: count() }).from(studioDecisions).where(and(eq(studioDecisions.userId, userId), gte(studioDecisions.createdAt, startOfDay))),
        db
          .select({ description: studioDeadlines.description, dueDate: studioDeadlines.dueDate, projectName: studioProjects.name })
          .from(studioDeadlines)
          .leftJoin(studioProjects, eq(studioProjects.id, studioDeadlines.projectId))
          .where(and(eq(studioDeadlines.userId, userId), gte(studioDeadlines.dueDate, new Date()), sql`${studioDeadlines.dueDate} <= ${soon}`))
          .orderBy(studioDeadlines.dueDate),
        db
          .select({ title: studioTasks.title, projectName: studioProjects.name })
          .from(studioTasks)
          .leftJoin(studioProjects, eq(studioProjects.id, studioTasks.projectId))
          .where(and(eq(studioTasks.userId, userId), ne(studioTasks.status, 'done'), eq(studioTasks.priority, 'high')))
          .limit(10),
      ])

    return reply.send({
      activeProjects: activeProjects.c,
      newDocumentsToday: newDocsToday.c,
      newQuotesToday: newQuotesToday.c,
      decisionsToday: decisionsToday.c,
      upcomingDeadlines: deadlinesSoon,
      needsAttention: pendingHighPriority,
    })
  })

  // GET /api/studio/summary/weekly
  app.get('/weekly', async (request, reply) => {
    const userId = request.user.sub
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [[activeProjects], [newDocs], [newQuotes], [decisions], [pending], [overdue]] = await Promise.all([
      db.select({ c: count() }).from(studioProjects).where(and(eq(studioProjects.userId, userId), eq(studioProjects.status, 'ACTIVE'))),
      db.select({ c: count() }).from(studioDocuments).where(and(eq(studioDocuments.userId, userId), gte(studioDocuments.createdAt, weekAgo))),
      db.select({ c: count() }).from(studioQuotes).where(and(eq(studioQuotes.userId, userId), gte(studioQuotes.createdAt, weekAgo))),
      db.select({ c: count() }).from(studioDecisions).where(and(eq(studioDecisions.userId, userId), gte(studioDecisions.createdAt, weekAgo))),
      db.select({ c: count() }).from(studioTasks).where(and(eq(studioTasks.userId, userId), ne(studioTasks.status, 'done'))),
      db
        .select({ c: count() })
        .from(studioTasks)
        .where(and(eq(studioTasks.userId, userId), ne(studioTasks.status, 'done'), sql`${studioTasks.dueDate} < NOW()`)),
    ])

    return reply.send({
      activeProjects: activeProjects.c,
      newDocuments: newDocs.c,
      newQuotes: newQuotes.c,
      decisionsMade: decisions.c,
      pendingTasks: pending.c,
      overdueTasks: overdue.c,
    })
  })
}
