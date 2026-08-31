import { FastifyInstance } from 'fastify'
import { eq, and, desc, sql, isNotNull, inArray } from 'drizzle-orm'
import {
  db, clients, payments, users, freelanceProjects, freelanceWorkLogs, invoices, proposals,
} from '../../db'

// GET /api/dashboard/report
//
// One complete snapshot of everything the signed-in user owns, shaped for the
// business report PDF: company letterhead, headline totals, a per-client
// ledger, every payment, freelance projects, and invoice/proposal counts.
//
// The headline figures are computed the same way as /dashboard/stats so the
// report and the dashboard tiles never disagree.
export default async function reportRoutes(app: FastifyInstance) {
  app.get('/report', async (request, reply) => {
    const userId = request.user.sub

    const [
      company,
      clientRows,
      paymentRows,
      freelanceRows,
      freelanceLogTotals,
      invoiceTotals,
      proposalCounts,
    ] = await Promise.all([
      db.select({
        name: users.name,
        email: users.email,
        companyName: users.companyName,
        companyLogoUrl: users.companyLogoUrl,
        companyPhone: users.companyPhone,
        companyAddress: users.companyAddress,
        companyWebsite: users.companyWebsite,
        companyGstin: users.companyGstin,
      }).from(users).where(eq(users.id, userId)).limit(1),

      db.select().from(clients).where(eq(clients.userId, userId)).orderBy(desc(clients.createdAt)),

      // Every payment, with whichever counterparty it belongs to.
      db.select({
        id: payments.id,
        amount: payments.amount,
        method: payments.method,
        date: payments.date,
        notes: payments.notes,
        clientId: payments.clientId,
        freelanceProjectId: payments.freelanceProjectId,
        clientName: clients.name,
        freelanceClientName: freelanceProjects.clientName,
        freelanceWorkType: freelanceProjects.workType,
      })
        .from(payments)
        .leftJoin(clients, eq(payments.clientId, clients.id))
        .leftJoin(freelanceProjects, eq(payments.freelanceProjectId, freelanceProjects.id))
        .where(eq(payments.userId, userId))
        .orderBy(desc(payments.date)),

      db.select().from(freelanceProjects).where(eq(freelanceProjects.userId, userId)).orderBy(desc(freelanceProjects.createdAt)),

      // Billed per freelance project, from its work logs.
      db.select({
        freelanceProjectId: freelanceWorkLogs.freelanceProjectId,
        billed: sql<string>`COALESCE(SUM(${freelanceWorkLogs.amount}), 0)`,
      })
        .from(freelanceWorkLogs)
        .innerJoin(freelanceProjects, and(
          eq(freelanceWorkLogs.freelanceProjectId, freelanceProjects.id),
          eq(freelanceProjects.userId, userId)
        ))
        .groupBy(freelanceWorkLogs.freelanceProjectId),

      db.select({
        count: sql<number>`COUNT(*)`,
        billed: sql<string>`COALESCE(SUM(${invoices.totalAmount}), 0)`,
        collected: sql<string>`COALESCE(SUM(${invoices.amountPaid}), 0)`,
      }).from(invoices).where(eq(invoices.userId, userId)),

      db.select({ status: proposals.status, count: sql<number>`COUNT(*)` })
        .from(proposals).where(eq(proposals.userId, userId)).groupBy(proposals.status),
    ])

    // ── Per-client paid totals ──────────────────────────────────
    const clientIds = clientRows.map((c) => c.id)
    const paidPerClient = clientIds.length > 0
      ? await db.select({
          clientId: payments.clientId,
          paid: sql<string>`SUM(${payments.amount})`,
          paymentCount: sql<number>`COUNT(*)`,
          lastPaymentDate: sql<Date>`MAX(${payments.date})`,
        })
          .from(payments)
          .where(and(isNotNull(payments.clientId), inArray(payments.clientId, clientIds)))
          .groupBy(payments.clientId)
      : []

    const paidMap = new Map(paidPerClient.map((p) => [
      p.clientId,
      { paid: Number(p.paid ?? 0), count: Number(p.paymentCount ?? 0), lastPaymentDate: p.lastPaymentDate },
    ]))

    const clientReport = clientRows.map((c) => {
      const stats = paidMap.get(c.id)
      const dealAmount = Number(c.totalDealAmount)
      const totalPaid = stats?.paid ?? 0
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        status: c.status,
        projectDescription: c.projectDescription,
        totalDealAmount: dealAmount,
        totalPaid,
        // Only shortfalls count as pending; an overpayment is not negative debt.
        pending: Math.max(0, dealAmount - totalPaid),
        paymentCount: stats?.count ?? 0,
        lastPaymentDate: stats?.lastPaymentDate ?? null,
        createdAt: c.createdAt,
      }
    })

    // ── Freelance projects with billed/paid/pending ─────────────
    const billedMap = new Map(freelanceLogTotals.map((f) => [f.freelanceProjectId, Number(f.billed ?? 0)]))
    const freelancePaidMap = new Map<string, number>()
    for (const p of paymentRows) {
      if (!p.freelanceProjectId) continue
      freelancePaidMap.set(p.freelanceProjectId, (freelancePaidMap.get(p.freelanceProjectId) ?? 0) + Number(p.amount))
    }

    const freelanceReport = freelanceRows.map((f) => {
      const billed = billedMap.get(f.id) ?? 0
      const paid = freelancePaidMap.get(f.id) ?? 0
      return {
        id: f.id,
        clientName: f.clientName,
        workType: f.workType,
        chargeType: f.chargeType,
        rate: Number(f.rate),
        status: f.status,
        billed,
        paid,
        pending: Math.max(0, billed - paid),
        createdAt: f.createdAt,
      }
    })

    // ── Headline totals ─────────────────────────────────────────
    // Matches /dashboard/stats: "revenue" is client payments only, and
    // "pending" counts active/on-hold clients only.
    const clientRevenue = clientReport.reduce((sum, c) => sum + c.totalPaid, 0)
    const pendingPayments = clientReport
      .filter((c) => c.status === 'ACTIVE' || c.status === 'ON_HOLD')
      .reduce((sum, c) => sum + c.pending, 0)

    const freelanceBilled = freelanceReport.reduce((sum, f) => sum + f.billed, 0)
    const freelancePaid = freelanceReport.reduce((sum, f) => sum + f.paid, 0)

    // Every rupee actually banked, client work and freelance together.
    const totalReceived = paymentRows.reduce((sum, p) => sum + Number(p.amount), 0)

    // ── Payment method split ────────────────────────────────────
    const methodMap = new Map<string, { count: number; total: number }>()
    for (const p of paymentRows) {
      const entry = methodMap.get(p.method) ?? { count: 0, total: 0 }
      entry.count += 1
      entry.total += Number(p.amount)
      methodMap.set(p.method, entry)
    }

    // ── Monthly revenue, last 12 months ─────────────────────────
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
    const monthlyMap = new Map<string, { month: number; year: number; total: number }>()
    for (const p of paymentRows) {
      const d = new Date(p.date)
      if (d < twelveMonthsAgo) continue
      const month = d.getMonth() + 1
      const year = d.getFullYear()
      const key = `${year}-${month}`
      const entry = monthlyMap.get(key) ?? { month, year, total: 0 }
      entry.total = Number((entry.total + Number(p.amount)).toFixed(2))
      monthlyMap.set(key, entry)
    }

    const invoiceBilled = Number(invoiceTotals[0]?.billed ?? 0)
    const invoiceCollected = Number(invoiceTotals[0]?.collected ?? 0)

    return reply.send({
      data: {
        generatedAt: new Date().toISOString(),
        company: company[0] ?? null,

        summary: {
          totalClients: clientReport.length,
          activeClients: clientReport.filter((c) => c.status === 'ACTIVE').length,
          completedClients: clientReport.filter((c) => c.status === 'COMPLETED').length,
          onHoldClients: clientReport.filter((c) => c.status === 'ON_HOLD').length,

          totalDealValue: clientReport.reduce((sum, c) => sum + c.totalDealAmount, 0),
          totalRevenue: clientRevenue,
          pendingPayments,
          totalReceived,
          paymentCount: paymentRows.length,

          freelanceProjects: freelanceReport.length,
          freelanceActiveProjects: freelanceReport.filter((f) => f.status === 'ACTIVE').length,
          freelanceBilled,
          freelancePaid,
          freelancePending: Math.max(0, freelanceBilled - freelancePaid),

          invoiceCount: Number(invoiceTotals[0]?.count ?? 0),
          invoiceBilled,
          invoiceCollected,
          invoiceOutstanding: Math.max(0, invoiceBilled - invoiceCollected),

          proposalCount: proposalCounts.reduce((sum, p) => sum + Number(p.count), 0),
          proposalsByStatus: Object.fromEntries(proposalCounts.map((p) => [p.status, Number(p.count)])),
        },

        clients: clientReport,
        payments: paymentRows.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          date: p.date,
          notes: p.notes,
          // Freelance payments have no client row, so fall back to the project.
          counterparty: p.clientName ?? p.freelanceClientName ?? 'Unknown',
          source: p.clientId ? 'CLIENT' : p.freelanceProjectId ? 'FREELANCE' : 'OTHER',
          workType: p.freelanceWorkType ?? null,
        })),
        freelanceProjects: freelanceReport,

        paymentMethods: Array.from(methodMap.entries()).map(([method, v]) => ({
          method,
          count: v.count,
          total: v.total,
        })),
        monthlyRevenue: Array.from(monthlyMap.values()).sort((a, b) =>
          a.year !== b.year ? a.year - b.year : a.month - b.month
        ),
      },
    })
  })
}
