import { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export default async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/dashboard/stats
  app.get('/stats', async (request, reply) => {
    const userId = request.user.sub

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

    // Run all queries in parallel
    const [
      clientCounts,
      allClients,
      totalRevenueAgg,
      recentPayments,
      recentClients,
      recentActivity,
    ] = await Promise.all([
      prisma.client.groupBy({
        by: ['status'],
        where: { userId },
        _count: true,
      }),

      prisma.client.findMany({
        where: { userId, status: { in: ['ACTIVE', 'ON_HOLD'] } },
        select: {
          totalDealAmount: true,
          payments: { select: { amount: true } },
        },
      }),

      prisma.payment.aggregate({
        where: { client: { userId } },
        _sum: { amount: true },
      }),

      // Payments in last 12 months for monthly revenue chart
      prisma.payment.findMany({
        where: {
          client: { userId },
          date: { gte: twelveMonthsAgo },
        },
        select: { date: true, amount: true },
      }),

      // Clients created in last 12 months for growth chart
      prisma.client.findMany({
        where: {
          userId,
          createdAt: { gte: twelveMonthsAgo },
        },
        select: { createdAt: true },
      }),

      prisma.activityLog.findMany({
        where: { client: { userId } },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      }),
    ])

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
    const totalClients = clientCounts.reduce((sum, g) => sum + g._count, 0)
    const activeClients = clientCounts.find((g) => g.status === 'ACTIVE')?._count ?? 0
    const completedClients = clientCounts.find((g) => g.status === 'COMPLETED')?._count ?? 0
    const onHoldClients = clientCounts.find((g) => g.status === 'ON_HOLD')?._count ?? 0

    const pendingPayments = allClients.reduce((sum, client) => {
      const totalPaid = client.payments.reduce((s, p) => s + Number(p.amount), 0)
      const remaining = Number(client.totalDealAmount) - totalPaid
      return sum + (remaining > 0 ? remaining : 0)
    }, 0)

    const totalRevenue = Number(totalRevenueAgg._sum.amount ?? 0)

    return reply.send({
      data: {
        totalRevenue,
        totalClients,
        activeClients,
        completedClients,
        onHoldClients,
        pendingPayments,
        monthlyRevenue: Array.from(revenueMap.values()).sort(sortByYearMonth),
        clientGrowth: Array.from(growthMap.values()).sort(sortByYearMonth),
        recentActivity,
      },
    })
  })
}
