import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import type { BusinessReport, ReportClientRow, ReportPaymentRow } from '@/types'

// Disable hyphenation — prevents "Pay-ment", "23-rd" breaks
Font.registerHyphenationCallback((word) => [word])

// ── Color palette (matches ProposalPDF / InvoicePDF) ────────
const C = {
  darkGreen: '#1a3c00',
  accentGreen: '#4a7c20',
  white: '#ffffff',
  border: '#cccccc',
  borderLight: '#e8e8e8',
  text: '#1a1a1a',
  textMed: '#444444',
  textLight: '#666666',
  bgLight: '#f5f5f5',
  bgGreen: '#f0f4eb',
  amber: '#a86400',
  red: '#a33',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: C.text,
    paddingTop: 30,
    paddingBottom: 46,
    paddingHorizontal: 34,
    backgroundColor: C.white,
  },

  watermark: {
    position: 'absolute',
    top: 240,
    left: 148,
    width: 300,
    height: 300,
    opacity: 0.04,
  },

  // ── Header ──
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  headerLeft: { flex: 1, paddingRight: 12 },
  logo: { width: 58, height: 58, objectFit: 'contain', marginBottom: 6 },
  logoPlaceholder: {
    width: 48, height: 48, borderRadius: 4, marginBottom: 6,
    backgroundColor: C.darkGreen, alignItems: 'center', justifyContent: 'center',
  },
  logoPlaceholderText: { color: C.white, fontSize: 17, fontFamily: 'Helvetica-Bold' },
  companyName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.darkGreen, marginBottom: 3 },
  companyDetail: { fontSize: 8, color: C.textMed, marginBottom: 1.5, lineHeight: 1.4 },

  headerRight: { width: 190, alignItems: 'flex-end' },
  reportTitle: { fontSize: 19, fontFamily: 'Helvetica-Bold', color: C.darkGreen, letterSpacing: 1 },
  reportSubtitle: { fontSize: 8, color: C.accentGreen, letterSpacing: 0.8, marginTop: 2 },
  metaDivider: { height: 1, backgroundColor: C.border, alignSelf: 'stretch', marginVertical: 7 },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2.5 },
  metaLabel: { fontSize: 8, color: C.textLight, width: 74, textAlign: 'right' },
  metaColon: { fontSize: 8, color: C.textLight, width: 8, textAlign: 'center' },
  metaValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.text, width: 92, textAlign: 'right' },

  headerRule: { height: 2, backgroundColor: C.darkGreen, marginTop: 10, marginBottom: 14 },

  // ── Section ──
  section: { marginBottom: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sectionCircle: {
    width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5, borderColor: C.accentGreen,
    marginRight: 5, alignItems: 'center', justifyContent: 'center',
  },
  sectionCircleInner: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.accentGreen },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.darkGreen, letterSpacing: 0.7 },

  // ── KPI tiles ──
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiTile: {
    width: '31.8%', borderWidth: 1, borderColor: C.borderLight, borderRadius: 4,
    padding: 8, backgroundColor: C.bgLight,
  },
  kpiTileAccent: {
    width: '31.8%', borderWidth: 1, borderColor: C.accentGreen, borderRadius: 4,
    padding: 8, backgroundColor: C.bgGreen,
  },
  kpiLabel: { fontSize: 7, color: C.textLight, letterSpacing: 0.4, marginBottom: 3 },
  kpiValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.text },
  kpiValueGreen: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.darkGreen },
  kpiValueAmber: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.amber },
  kpiSub: { fontSize: 7, color: C.textLight, marginTop: 2 },

  // ── Tables ──
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 3, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: C.darkGreen, paddingVertical: 5, paddingHorizontal: 5 },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.white, letterSpacing: 0.3 },
  tableRow: {
    flexDirection: 'row', paddingVertical: 4.5, paddingHorizontal: 5,
    borderTopWidth: 1, borderTopColor: C.borderLight, alignItems: 'flex-start',
  },
  td: { fontSize: 8, color: C.text, lineHeight: 1.3 },
  tdMuted: { fontSize: 7, color: C.textLight, marginTop: 1 },
  totalRow: {
    flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 5,
    borderTopWidth: 1.5, borderTopColor: C.darkGreen, backgroundColor: C.bgGreen,
  },
  tdTotal: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.darkGreen },

  badge: {
    fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.textMed,
    borderWidth: 1, borderColor: C.border, borderRadius: 2,
    paddingHorizontal: 3, paddingVertical: 1, alignSelf: 'flex-start',
  },

  emptyNote: {
    fontSize: 8, color: C.textLight, fontStyle: 'italic',
    padding: 8, borderWidth: 1, borderColor: C.borderLight, borderRadius: 3,
  },

  continued: { fontSize: 7, color: C.textLight, marginBottom: 4 },

  // ── Footer ──
  footer: {
    position: 'absolute', bottom: 20, left: 34, right: 34,
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: C.borderLight, paddingTop: 5,
  },
  footerText: { fontSize: 7, color: C.textLight },
})

// ── Column widths, shared between each table's header and body ──
const clientCols = {
  sr: { width: 18, textAlign: 'center' as const },
  name: { flex: 1, paddingRight: 4 },
  status: { width: 52 },
  deal: { width: 66, textAlign: 'right' as const },
  paid: { width: 66, textAlign: 'right' as const },
  pending: { width: 66, textAlign: 'right' as const },
  count: { width: 30, textAlign: 'center' as const },
}

const paymentCols = {
  sr: { width: 18, textAlign: 'center' as const },
  date: { width: 60 },
  party: { flex: 1, paddingRight: 4 },
  source: { width: 50 },
  method: { width: 46 },
  amount: { width: 70, textAlign: 'right' as const },
}

const freelanceCols = {
  sr: { width: 18, textAlign: 'center' as const },
  client: { flex: 1, paddingRight: 4 },
  work: { width: 90 },
  status: { width: 52 },
  billed: { width: 62, textAlign: 'right' as const },
  paid: { width: 62, textAlign: 'right' as const },
  pending: { width: 62, textAlign: 'right' as const },
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  CLIENT: 'Client',
  FREELANCE: 'Freelance',
  OTHER: 'Other',
  CASH: 'Cash',
  ONLINE: 'Online',
  CHEQUE: 'Cheque',
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(value?: string | Date | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d)
}

function fmtDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

// Long tables are split by hand so each page can carry its own header row.
// react-pdf's `fixed` would repeat a header on every page of the document,
// including pages belonging to other sections.
function chunk<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return []
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

// Rows per page, measured against worst-case two-line rows (long names with an
// email/phone subline) on A4. A bare page fits 26 such rows; each table page
// also carries a section heading, so these leave room for that plus a margin.
// Page 1 is full with the summary blocks, so every table starts on its own page.
const CLIENT_ROWS_PER_PAGE = 22
const PAYMENT_ROWS_PER_PAGE = 22
const FREELANCE_ROWS_PER_PAGE = 22

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionCircle}><View style={styles.sectionCircleInner} /></View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  )
}

function Footer({ company, generatedAt }: { company?: string | null; generatedAt: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{company ?? 'Business Report'} · Generated {fmtDateTime(generatedAt)}</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  )
}

// ── Client ledger ─────────────────────────────────────────────
function ClientTableHeader() {
  return (
    <View style={styles.tableHeader}>
      <Text style={[styles.th, clientCols.sr]}>#</Text>
      <Text style={[styles.th, clientCols.name]}>CLIENT</Text>
      <Text style={[styles.th, clientCols.status]}>STATUS</Text>
      <Text style={[styles.th, clientCols.deal]}>DEAL VALUE</Text>
      <Text style={[styles.th, clientCols.paid]}>RECEIVED</Text>
      <Text style={[styles.th, clientCols.pending]}>PENDING</Text>
      <Text style={[styles.th, clientCols.count]}>PMTS</Text>
    </View>
  )
}

function ClientRow({ row, index }: { row: ReportClientRow; index: number }) {
  return (
    <View style={[styles.tableRow, index % 2 === 1 ? { backgroundColor: C.bgLight } : {}]} wrap={false}>
      <Text style={[styles.td, clientCols.sr]}>{index + 1}</Text>
      <View style={clientCols.name}>
        <Text style={styles.td}>{row.name}</Text>
        {(row.email || row.phone) && (
          <Text style={styles.tdMuted}>{[row.phone, row.email].filter(Boolean).join(' · ')}</Text>
        )}
      </View>
      <Text style={[styles.td, clientCols.status]}>{STATUS_LABEL[row.status] ?? row.status}</Text>
      <Text style={[styles.td, clientCols.deal]}>{fmt(row.totalDealAmount)}</Text>
      <Text style={[styles.td, clientCols.paid]}>{fmt(row.totalPaid)}</Text>
      <Text style={[styles.td, clientCols.pending, row.pending > 0 ? { color: C.amber, fontFamily: 'Helvetica-Bold' } : {}]}>
        {fmt(row.pending)}
      </Text>
      <Text style={[styles.td, clientCols.count]}>{row.paymentCount}</Text>
    </View>
  )
}

// ── Payment register ──────────────────────────────────────────
function PaymentTableHeader() {
  return (
    <View style={styles.tableHeader}>
      <Text style={[styles.th, paymentCols.sr]}>#</Text>
      <Text style={[styles.th, paymentCols.date]}>DATE</Text>
      <Text style={[styles.th, paymentCols.party]}>RECEIVED FROM</Text>
      <Text style={[styles.th, paymentCols.source]}>SOURCE</Text>
      <Text style={[styles.th, paymentCols.method]}>METHOD</Text>
      <Text style={[styles.th, paymentCols.amount]}>AMOUNT</Text>
    </View>
  )
}

function PaymentRow({ row, index }: { row: ReportPaymentRow; index: number }) {
  return (
    <View style={[styles.tableRow, index % 2 === 1 ? { backgroundColor: C.bgLight } : {}]} wrap={false}>
      <Text style={[styles.td, paymentCols.sr]}>{index + 1}</Text>
      <Text style={[styles.td, paymentCols.date]}>{fmtDate(row.date)}</Text>
      <View style={paymentCols.party}>
        <Text style={styles.td}>{row.counterparty}</Text>
        {row.workType && <Text style={styles.tdMuted}>{row.workType}</Text>}
      </View>
      <Text style={[styles.td, paymentCols.source]}>{STATUS_LABEL[row.source] ?? row.source}</Text>
      <Text style={[styles.td, paymentCols.method]}>{STATUS_LABEL[row.method] ?? row.method}</Text>
      <Text style={[styles.td, paymentCols.amount, { fontFamily: 'Helvetica-Bold' }]}>{fmt(row.amount)}</Text>
    </View>
  )
}

interface Props { report: BusinessReport }

export function BusinessReportPDF({ report }: Props) {
  const { company, summary, clients, payments, freelanceProjects, paymentMethods, monthlyRevenue } = report
  const companyName = company?.companyName ?? company?.name ?? 'Business Report'
  const initials = companyName.slice(0, 2).toUpperCase()
  const logo = company?.companyLogoUrl ?? null

  const clientPages = chunk(clients, CLIENT_ROWS_PER_PAGE)
  const paymentPages = chunk(payments, PAYMENT_ROWS_PER_PAGE)
  const freelancePages = chunk(freelanceProjects, FREELANCE_ROWS_PER_PAGE)

  const clientTotals = clients.reduce(
    (acc, c) => ({
      deal: acc.deal + c.totalDealAmount,
      paid: acc.paid + c.totalPaid,
      pending: acc.pending + c.pending,
    }),
    { deal: 0, paid: 0, pending: 0 }
  )

  return (
    <Document title={`Business Report – ${companyName}`} author={companyName}>
      {/* ══ PAGE 1 — Summary ══════════════════════════════════ */}
      <Page size="A4" style={styles.page}>
        {logo && <Image src={logo} style={styles.watermark} />}

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logo
              ? <Image src={logo} style={styles.logo} />
              : (
                <View style={styles.logoPlaceholder}>
                  <Text style={styles.logoPlaceholderText}>{initials}</Text>
                </View>
              )
            }
            <Text style={styles.companyName}>{companyName}</Text>
            {company?.companyAddress && <Text style={styles.companyDetail}>{company.companyAddress}</Text>}
            {company?.companyPhone && <Text style={styles.companyDetail}>{company.companyPhone}</Text>}
            {company?.email && <Text style={styles.companyDetail}>{company.email}</Text>}
            {company?.companyWebsite && <Text style={styles.companyDetail}>{company.companyWebsite}</Text>}
            {company?.companyGstin && (
              <Text style={[styles.companyDetail, { fontFamily: 'Helvetica-Bold', color: C.darkGreen }]}>
                GSTIN: {company.companyGstin}
              </Text>
            )}
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.reportTitle}>BUSINESS REPORT</Text>
            <Text style={styles.reportSubtitle}>COMPLETE DATA EXPORT</Text>
            <View style={styles.metaDivider} />
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Generated</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{fmtDate(report.generatedAt)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Clients</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{summary.totalClients}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Payments</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{summary.paymentCount}</Text>
            </View>
          </View>
        </View>

        <View style={styles.headerRule} />

        {/* ── Financial summary ── */}
        <View style={styles.section}>
          <SectionHeader title="FINANCIAL SUMMARY" />
          <View style={styles.kpiGrid}>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>TOTAL BILLED</Text>
              <Text style={styles.kpiValue}>Rs. {fmt(summary.totalRevenue + summary.pendingPayments)}</Text>
              <Text style={styles.kpiSub}>Revenue plus outstanding</Text>
            </View>
            <View style={styles.kpiTileAccent}>
              <Text style={styles.kpiLabel}>TOTAL REVENUE</Text>
              <Text style={styles.kpiValueGreen}>Rs. {fmt(summary.totalRevenue)}</Text>
              <Text style={styles.kpiSub}>Received from clients</Text>
            </View>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>PENDING PAYMENTS</Text>
              <Text style={styles.kpiValueAmber}>Rs. {fmt(summary.pendingPayments)}</Text>
              <Text style={styles.kpiSub}>Active &amp; on-hold clients</Text>
            </View>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>TOTAL RECEIVED</Text>
              <Text style={styles.kpiValueGreen}>Rs. {fmt(summary.totalReceived)}</Text>
              <Text style={styles.kpiSub}>Clients + freelance, {summary.paymentCount} payments</Text>
            </View>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>TOTAL DEAL VALUE</Text>
              <Text style={styles.kpiValue}>Rs. {fmt(summary.totalDealValue)}</Text>
              <Text style={styles.kpiSub}>Across all clients</Text>
            </View>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>ACTIVE CLIENTS</Text>
              <Text style={styles.kpiValue}>{summary.activeClients}</Text>
              <Text style={styles.kpiSub}>
                {summary.completedClients} completed · {summary.onHoldClients} on hold
              </Text>
            </View>
          </View>
        </View>

        {/* ── Freelance / invoices / proposals ── */}
        <View style={styles.section}>
          <SectionHeader title="BUSINESS OVERVIEW" />
          <View style={styles.kpiGrid}>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>FREELANCE BILLED</Text>
              <Text style={styles.kpiValue}>Rs. {fmt(summary.freelanceBilled)}</Text>
              <Text style={styles.kpiSub}>
                {summary.freelanceProjects} project{summary.freelanceProjects !== 1 ? 's' : ''} · {summary.freelanceActiveProjects} active
              </Text>
            </View>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>FREELANCE RECEIVED</Text>
              <Text style={styles.kpiValueGreen}>Rs. {fmt(summary.freelancePaid)}</Text>
              <Text style={styles.kpiSub}>Rs. {fmt(summary.freelancePending)} pending</Text>
            </View>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>INVOICES</Text>
              <Text style={styles.kpiValue}>Rs. {fmt(summary.invoiceBilled)}</Text>
              <Text style={styles.kpiSub}>
                {summary.invoiceCount} raised · Rs. {fmt(summary.invoiceOutstanding)} outstanding
              </Text>
            </View>
          </View>
        </View>

        {/* ── Payment methods + monthly revenue, side by side ── */}
        <View style={[styles.section, { flexDirection: 'row', gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <SectionHeader title="PAYMENT METHODS" />
            {paymentMethods.length === 0 ? (
              <Text style={styles.emptyNote}>No payments recorded yet.</Text>
            ) : (
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { flex: 1 }]}>METHOD</Text>
                  <Text style={[styles.th, { width: 34, textAlign: 'center' }]}>COUNT</Text>
                  <Text style={[styles.th, { width: 72, textAlign: 'right' }]}>TOTAL</Text>
                </View>
                {paymentMethods.map((m, i) => (
                  <View key={m.method} style={[styles.tableRow, i % 2 === 1 ? { backgroundColor: C.bgLight } : {}]}>
                    <Text style={[styles.td, { flex: 1 }]}>{STATUS_LABEL[m.method] ?? m.method}</Text>
                    <Text style={[styles.td, { width: 34, textAlign: 'center' }]}>{m.count}</Text>
                    <Text style={[styles.td, { width: 72, textAlign: 'right' }]}>{fmt(m.total)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <SectionHeader title="REVENUE — LAST 12 MONTHS" />
            {monthlyRevenue.length === 0 ? (
              <Text style={styles.emptyNote}>No payments in the last 12 months.</Text>
            ) : (
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { flex: 1 }]}>MONTH</Text>
                  <Text style={[styles.th, { width: 80, textAlign: 'right' }]}>COLLECTED</Text>
                </View>
                {monthlyRevenue.map((m, i) => (
                  <View key={`${m.year}-${m.month}`} style={[styles.tableRow, i % 2 === 1 ? { backgroundColor: C.bgLight } : {}]}>
                    <Text style={[styles.td, { flex: 1 }]}>{MONTHS[m.month - 1]} {m.year}</Text>
                    <Text style={[styles.td, { width: 80, textAlign: 'right' }]}>{fmt(m.total)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* The client ledger begins on its own page — this one is full. */}
        {clients.length === 0 && (
          <View style={styles.section}>
            <SectionHeader title="CLIENT LEDGER" />
            <Text style={styles.emptyNote}>No clients added yet.</Text>
          </View>
        )}

        <Footer company={companyName} generatedAt={report.generatedAt} />
      </Page>

      {/* ══ Client ledger ════════════════════════════════════ */}
      {clientPages.map((pageRows, pageIndex) => {
        const isLast = pageIndex === clientPages.length - 1
        const offset = pageIndex * CLIENT_ROWS_PER_PAGE
        return (
          <Page key={`clients-${pageIndex}`} size="A4" style={styles.page}>
            <View style={styles.section}>
              <SectionHeader title="CLIENT LEDGER" />
              {pageIndex > 0 && <Text style={styles.continued}>continued</Text>}
              <View style={styles.table}>
                <ClientTableHeader />
                {pageRows.map((c, i) => <ClientRow key={c.id} row={c} index={offset + i} />)}
                {isLast && (
                  <View style={styles.totalRow}>
                    <Text style={[styles.tdTotal, clientCols.sr]} />
                    <Text style={[styles.tdTotal, clientCols.name]}>TOTAL ({clients.length} clients)</Text>
                    <Text style={[styles.tdTotal, clientCols.status]} />
                    <Text style={[styles.tdTotal, clientCols.deal]}>{fmt(clientTotals.deal)}</Text>
                    <Text style={[styles.tdTotal, clientCols.paid]}>{fmt(clientTotals.paid)}</Text>
                    <Text style={[styles.tdTotal, clientCols.pending]}>{fmt(clientTotals.pending)}</Text>
                    <Text style={[styles.tdTotal, clientCols.count]} />
                  </View>
                )}
              </View>
            </View>
            <Footer company={companyName} generatedAt={report.generatedAt} />
          </Page>
        )
      })}

      {/* ══ Freelance projects ═══════════════════════════════ */}
      {freelanceProjects.length > 0 && freelancePages.map((pageRows, pageIndex) => (
        <Page key={`freelance-${pageIndex}`} size="A4" style={styles.page}>
          <View style={styles.section}>
            <SectionHeader title="FREELANCE PROJECTS" />
            {pageIndex > 0 && <Text style={styles.continued}>continued</Text>}
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, freelanceCols.sr]}>#</Text>
                <Text style={[styles.th, freelanceCols.client]}>CLIENT</Text>
                <Text style={[styles.th, freelanceCols.work]}>WORK TYPE</Text>
                <Text style={[styles.th, freelanceCols.status]}>STATUS</Text>
                <Text style={[styles.th, freelanceCols.billed]}>BILLED</Text>
                <Text style={[styles.th, freelanceCols.paid]}>RECEIVED</Text>
                <Text style={[styles.th, freelanceCols.pending]}>PENDING</Text>
              </View>
              {pageRows.map((f, i) => {
                const index = pageIndex * FREELANCE_ROWS_PER_PAGE + i
                return (
                  <View key={f.id} style={[styles.tableRow, index % 2 === 1 ? { backgroundColor: C.bgLight } : {}]} wrap={false}>
                    <Text style={[styles.td, freelanceCols.sr]}>{index + 1}</Text>
                    <Text style={[styles.td, freelanceCols.client]}>{f.clientName}</Text>
                    <View style={freelanceCols.work}>
                      <Text style={styles.td}>{f.workType}</Text>
                      <Text style={styles.tdMuted}>Rs. {fmt(f.rate)} / {f.chargeType}</Text>
                    </View>
                    <Text style={[styles.td, freelanceCols.status]}>{f.status === 'ACTIVE' ? 'Active' : 'Completed'}</Text>
                    <Text style={[styles.td, freelanceCols.billed]}>{fmt(f.billed)}</Text>
                    <Text style={[styles.td, freelanceCols.paid]}>{fmt(f.paid)}</Text>
                    <Text style={[styles.td, freelanceCols.pending, f.pending > 0 ? { color: C.amber, fontFamily: 'Helvetica-Bold' } : {}]}>
                      {fmt(f.pending)}
                    </Text>
                  </View>
                )
              })}
              {pageIndex === freelancePages.length - 1 && (
                <View style={styles.totalRow}>
                  <Text style={[styles.tdTotal, freelanceCols.sr]} />
                  <Text style={[styles.tdTotal, freelanceCols.client]}>TOTAL</Text>
                  <Text style={[styles.tdTotal, freelanceCols.work]} />
                  <Text style={[styles.tdTotal, freelanceCols.status]} />
                  <Text style={[styles.tdTotal, freelanceCols.billed]}>{fmt(summary.freelanceBilled)}</Text>
                  <Text style={[styles.tdTotal, freelanceCols.paid]}>{fmt(summary.freelancePaid)}</Text>
                  <Text style={[styles.tdTotal, freelanceCols.pending]}>{fmt(summary.freelancePending)}</Text>
                </View>
              )}
            </View>
          </View>
          <Footer company={companyName} generatedAt={report.generatedAt} />
        </Page>
      ))}

      {/* ══ Payment register ═════════════════════════════════ */}
      {payments.length > 0 && paymentPages.map((pageRows, pageIndex) => (
        <Page key={`payments-${pageIndex}`} size="A4" style={styles.page}>
          <View style={styles.section}>
            <SectionHeader title="PAYMENT REGISTER" />
            {pageIndex > 0 && <Text style={styles.continued}>continued</Text>}
            <View style={styles.table}>
              <PaymentTableHeader />
              {pageRows.map((p, i) => (
                <PaymentRow key={p.id} row={p} index={pageIndex * PAYMENT_ROWS_PER_PAGE + i} />
              ))}
              {pageIndex === paymentPages.length - 1 && (
                <View style={styles.totalRow}>
                  <Text style={[styles.tdTotal, paymentCols.sr]} />
                  <Text style={[styles.tdTotal, paymentCols.date]} />
                  <Text style={[styles.tdTotal, paymentCols.party]}>TOTAL RECEIVED ({payments.length} payments)</Text>
                  <Text style={[styles.tdTotal, paymentCols.source]} />
                  <Text style={[styles.tdTotal, paymentCols.method]} />
                  <Text style={[styles.tdTotal, paymentCols.amount]}>{fmt(summary.totalReceived)}</Text>
                </View>
              )}
            </View>
          </View>
          <Footer company={companyName} generatedAt={report.generatedAt} />
        </Page>
      ))}

    </Document>
  )
}
