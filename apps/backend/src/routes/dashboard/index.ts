import { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export default async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/dashboard/stats
  app.get('/stats', async (request, reply) => {
    const userId = request.user.sub

    // Run all aggregations in parallel for performance
    const [
      clientCounts,
      allClients,
      totalRevenueAgg,
      monthlyRevenue,
      clientGrowth,
      recentActivity,
    ] = await Promise.all([
      // Client counts by status
      prisma.client.groupBy({
        by: ['status'],
        where: { userId },
        _count: true,
      }),

      // All clients with their payment sums (for pending calc)
      prisma.client.findMany({
        where: { userId, status: { in: ['ACTIVE', 'ON_HOLD'] } },
        select: {
          totalDealAmount: true,
          _count: { select: { payments: true } },
          payments: {
            select: { amount: true },
          },
        },
      }),

      // Total revenue across all clients
      prisma.payment.aggregate({
        where: { client: { userId } },
        _sum: { amount: true },
      }),

      // Monthly revenue - last 12 months
      prisma.$queryRaw<Array<{ month: number; year: number; total: number }>>`
        SELECT
          EXTRACT(MONTH FROM p.date)::int AS month,
          EXTRACT(YEAR FROM p.date)::int AS year,
          SUM(p.amount)::float AS total
        FROM "Payment" p
        JOIN "Client" c ON c.id = p."clientId"
        WHERE c."userId" = ${userId}
          AND p.date >= NOW() - INTERVAL '12 months'
        GROUP BY year, month
        ORDER BY year ASC, month ASC
      `,

      // Client growth - last 12 months
      prisma.$queryRaw<Array<{ month: number; year: number; count: number }>>`
        SELECT
          EXTRACT(MONTH FROM "createdAt")::int AS month,
          EXTRACT(YEAR FROM "createdAt")::int AS year,
          COUNT(*)::int AS count
        FROM "Client"
        WHERE "userId" = ${userId}
          AND "createdAt" >= NOW() - INTERVAL '12 months'
        GROUP BY year, month
        ORDER BY year ASC, month ASC
      `,

      // Recent activity logs
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

    // Calculate totals
    const totalClients = clientCounts.reduce((sum, g) => sum + g._count, 0)
    const activeClients = clientCounts.find((g) => g.status === 'ACTIVE')?._count ?? 0
    const completedClients = clientCounts.find((g) => g.status === 'COMPLETED')?._count ?? 0
    const onHoldClients = clientCounts.find((g) => g.status === 'ON_HOLD')?._count ?? 0

    // Pending payments = sum(totalDealAmount - totalPaid) for active/on-hold clients
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
        monthlyRevenue: monthlyRevenue.map((r) => ({
          month: r.month,
          year: r.year,
          total: Number(r.total),
        })),
        clientGrowth: clientGrowth.map((r) => ({
          month: r.month,
          year: r.year,
          count: Number(r.count),
        })),
        recentActivity,
      },
    })
  })
}
