import { FastifyInstance } from 'fastify'
import { eq, and, gte, inArray, count, sql, isNotNull } from 'drizzle-orm'
import { db, clients, payments, activityLogs, users, freelanceProjects, freelanceWorkLogs } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import reportRoutes from './report'

export default async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // Full business report data, behind the same auth hook.
  await app.register(reportRoutes)

  // GET /api/dashboard/stats
  app.get('/stats', async (request, reply) => {
    const userId = request.user.sub

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

    // Run all queries in parallel
    const [
      clientStatusCounts,
      allActiveClients,
      totalRevenueRow,
      recentPayments,
      recentClients,
      recentActivity,
      freelanceBilledRow,
      freelancePaidRow,
      freelanceActiveRow,
    ] = await Promise.all([
      // Client counts by status
      db
        .select({ status: clients.status, count: count() })
        .from(clients)
        .where(eq(clients.userId, userId))
        .groupBy(clients.status),

      // All active/on-hold clients with their payment amounts for pending balance
      db
        .select({ totalDealAmount: clients.totalDealAmount, clientId: clients.id })
        .from(clients)
        .where(and(eq(clients.userId, userId), inArray(clients.status, ['ACTIVE', 'ON_HOLD']))),

      // Total revenue (all payments for this user's clients)
      db
        .select({ total: sql<string>`sum(${payments.amount})` })
        .from(payments)
        .innerJoin(clients, and(eq(payments.clientId, clients.id), eq(clients.userId, userId))),

      // Payments in last 12 months for monthly revenue chart
      db
        .select({ date: payments.date, amount: payments.amount })
        .from(payments)
        .innerJoin(clients, and(eq(payments.clientId, clients.id), eq(clients.userId, userId)))
        .where(gte(payments.date, twelveMonthsAgo)),

      // Clients created in last 12 months for growth chart
      db
        .select({ createdAt: clients.createdAt })
        .from(clients)
        .where(and(eq(clients.userId, userId), gte(clients.createdAt, twelveMonthsAgo))),

      // Recent activity logs (join with clients to filter by userId)
      db
        .select({
          id: activityLogs.id,
          type: activityLogs.type,
          metadata: activityLogs.metadata,
          clientId: activityLogs.clientId,
          userId: activityLogs.userId,
          createdAt: activityLogs.createdAt,
          userName: users.name,
          userId2: users.id,
          clientName: clients.name,
          clientId2: clients.id,
        })
        .from(activityLogs)
        .innerJoin(clients, and(eq(activityLogs.clientId, clients.id), eq(clients.userId, userId)))
        .innerJoin(users, eq(activityLogs.userId, users.id))
        .orderBy(sql`${activityLogs.createdAt} desc`)
        .limit(10),

      // Freelance: total billed (sum of work log amounts)
      db
        .select({ total: sql<string>`COALESCE(SUM(${freelanceWorkLogs.amount}), 0)` })
        .from(freelanceWorkLogs)
        .innerJoin(freelanceProjects, and(eq(freelanceWorkLogs.freelanceProjectId, freelanceProjects.id), eq(freelanceProjects.userId, userId))),

      // Freelance: total paid (sum of payments linked to a freelance project)
      db
        .select({ total: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
        .from(payments)
        .where(and(eq(payments.userId, userId), isNotNull(payments.freelanceProjectId))),

      // Freelance: active project count
      db
        .select({ count: count() })
        .from(freelanceProjects)
        .where(and(eq(freelanceProjects.userId, userId), eq(freelanceProjects.status, 'ACTIVE'))),
    ])

    // For pending balance, we need the paid amounts for active/on-hold clients
    const activeClientIds = allActiveClients.map((c) => c.clientId)
    const paidAmounts =
      activeClientIds.length > 0
        ? await db
            .select({
              clientId: payments.clientId,
              paid: sql<string>`sum(${payments.amount})`,
            })
            .from(payments)
            .where(and(isNotNull(payments.clientId), inArray(payments.clientId, activeClientIds)))
            .groupBy(payments.clientId)
        : []

    const paidMap = new Map(paidAmounts.map((p) => [p.clientId, Number(p.paid ?? 0)]))

    const pendingPayments = allActiveClients.reduce((sum, client) => {
      const totalPaid = paidMap.get(client.clientId) ?? 0
      const remaining = Number(client.totalDealAmount) - totalPaid
      return sum + (remaining > 0 ? remaining : 0)
    }, 0)

    // Aggregate monthly revenue in JS
    const revenueMap = new Map<string, { month: number; year: number; total: number }>()
    for (const p of recentPayments) {
      const d = new Date(p.date)
      const month = d.getMonth() + 1
      const year = d.getFullYear()
      const key = `${year}-${month}`
      const entry = revenueMap.get(key) ?? { month, year, total: 0 }
      entry.total = Number((entry.total + Number(p.amount)).toFixed(2))
      revenueMap.set(key, entry)
    }

    // Aggregate client growth in JS
    const growthMap = new Map<string, { month: number; year: number; count: number }>()
    for (const c of recentClients) {
      const d = new Date(c.createdAt)
      const month = d.getMonth() + 1
      const year = d.getFullYear()
      const key = `${year}-${month}`
      const entry = growthMap.get(key) ?? { month, year, count: 0 }
      entry.count += 1
      growthMap.set(key, entry)
    }

    const sortByYearMonth = (a: { year: number; month: number }, b: { year: number; month: number }) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month

    // Calculate totals
    const totalClients = clientStatusCounts.reduce((sum, g) => sum + Number(g.count), 0)
    const activeClients = Number(clientStatusCounts.find((g) => g.status === 'ACTIVE')?.count ?? 0)
    const completedClients = Number(clientStatusCounts.find((g) => g.status === 'COMPLETED')?.count ?? 0)
    const onHoldClients = Number(clientStatusCounts.find((g) => g.status === 'ON_HOLD')?.count ?? 0)

    const totalRevenue = Number(totalRevenueRow[0]?.total ?? 0)

    const freelanceBilled = Number(freelanceBilledRow[0]?.total ?? 0)
    const freelancePaid = Number(freelancePaidRow[0]?.total ?? 0)
    const freelancePending = Math.max(0, freelanceBilled - freelancePaid)
    const freelanceActiveProjects = Number(freelanceActiveRow[0]?.count ?? 0)

    const formattedActivity = recentActivity.map((a) => ({
      id: a.id,
      type: a.type,
      metadata: a.metadata,
      clientId: a.clientId,
      userId: a.userId,
      createdAt: a.createdAt,
      user: { id: a.userId2, name: a.userName },
      client: { id: a.clientId2, name: a.clientName },
    }))

    return reply.send({
      data: {
        totalRevenue,
        totalClients,
        activeClients,
        completedClients,
        onHoldClients,
        pendingPayments,
        freelanceBilled,
        freelancePaid,
        freelancePending,
        freelanceActiveProjects,
        monthlyRevenue: Array.from(revenueMap.values()).sort(sortByYearMonth),
        clientGrowth: Array.from(growthMap.values()).sort(sortByYearMonth),
        recentActivity: formattedActivity,
      },
    })
  })
}
