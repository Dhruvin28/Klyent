import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import type { Invoice } from '@/types'
import { computeInvoiceTotals } from '@/lib/invoiceTotals'

// Disable hyphenation — prevents "In-voice", "23-rd" breaks
Font.registerHyphenationCallback((word) => [word])

// ── Color palette (matches ProposalPDF) ─────────────────────
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
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: C.text,
    paddingTop: 30,
    paddingBottom: 48,
    paddingHorizontal: 34,
    backgroundColor: C.white,
  },

  watermark: {
    position: 'absolute',
    top: 220,
    left: 148,
    width: 300,
    height: 300,
    opacity: 0.05,
  },

  // ── Header ──
  header: { flexDirection: 'row' },
  headerLeft: { width: 210, paddingRight: 10 },
  logo: { width: 60, height: 60, objectFit: 'contain', marginBottom: 6 },
  logoPlaceholder: {
    width: 50, height: 50, borderRadius: 4, marginBottom: 6,
    backgroundColor: C.darkGreen, alignItems: 'center', justifyContent: 'center',
  },
  logoPlaceholderText: { color: C.white, fontSize: 18, fontFamily: 'Helvetica-Bold' },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.darkGreen, marginBottom: 3 },
  companyDetail: { fontSize: 8, color: C.textMed, marginBottom: 1.5, lineHeight: 1.4 },

  headerVDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 12 },

  headerRight: { flex: 1, alignItems: 'flex-end' },
  invoiceTitle: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: C.darkGreen, letterSpacing: 1.5 },
  invoiceSubtitle: { fontSize: 8, color: C.accentGreen, letterSpacing: 1, marginTop: 1 },
  metaHDivider: { height: 1, backgroundColor: C.border, alignSelf: 'stretch', marginVertical: 7 },
  metaRow: { flexDirection: 'row', marginBottom: 2.5, justifyContent: 'flex-end' },
  metaLabel: { fontSize: 8, color: C.textLight, width: 70, textAlign: 'right' },
  metaColon: { fontSize: 8, color: C.textLight, width: 8, textAlign: 'center' },
  metaValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.text, width: 95, textAlign: 'right' },

  headerRule: { height: 2, backgroundColor: C.darkGreen, marginTop: 10, marginBottom: 12 },

  // ── Party boxes ──
  detailsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  detailBox: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 3 },
  detailBoxHeader: { backgroundColor: C.darkGreen, paddingVertical: 4, paddingHorizontal: 7 },
  detailBoxHeaderText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.white, letterSpacing: 0.6 },
  detailBoxContent: { padding: 7 },
  partyName: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.text, marginBottom: 3 },
  partyLine: { fontSize: 8, color: C.textMed, marginBottom: 1.5, lineHeight: 1.4 },
  partyGstin: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.darkGreen, marginTop: 3 },

  // ── Supply strip ──
  supplyStrip: {
    flexDirection: 'row', backgroundColor: C.bgGreen, borderWidth: 1, borderColor: C.borderLight,
    borderRadius: 3, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 12,
  },
  supplyItem: { flex: 1 },
  supplyLabel: { fontSize: 7, color: C.textLight, letterSpacing: 0.4 },
  supplyValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.text, marginTop: 1 },

  // ── Line items table ──
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 3, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: C.darkGreen, paddingVertical: 5, paddingHorizontal: 5 },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.white, letterSpacing: 0.3 },
  tableRow: {
    flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 5,
    borderTopWidth: 1, borderTopColor: C.borderLight, alignItems: 'flex-start',
  },
  td: { fontSize: 8, color: C.text, lineHeight: 1.35 },
  tdMuted: { fontSize: 7, color: C.textLight, marginTop: 1 },

  // Column widths, shared by header and body
  colSr: { width: 20, textAlign: 'center' },
  colDesc: { flex: 1, paddingRight: 4 },
  colHsn: { width: 44, textAlign: 'center' },
  colQty: { width: 40, textAlign: 'right' },
  colRate: { width: 52, textAlign: 'right' },
  colDisc: { width: 32, textAlign: 'right' },
  colTax: { width: 32, textAlign: 'right' },
  colAmt: { width: 62, textAlign: 'right' },

  // ── Totals ──
  totalsRow: { flexDirection: 'row', marginTop: 12, gap: 10 },
  totalsLeft: { flex: 1 },
  totalsRight: { width: 210 },

  totalLine: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 3, paddingHorizontal: 7,
    borderBottomWidth: 1, borderBottomColor: C.borderLight,
  },
  totalLabel: { fontSize: 8.5, color: C.textMed },
  totalValue: { fontSize: 8.5, color: C.text, fontFamily: 'Helvetica-Bold' },
  grandTotalLine: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: C.darkGreen, paddingVertical: 6, paddingHorizontal: 7, borderRadius: 3, marginTop: 3,
  },
  grandTotalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white },
  grandTotalValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.white },
  balanceLine: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4, paddingHorizontal: 7, marginTop: 3,
    borderWidth: 1, borderColor: C.accentGreen, borderRadius: 3, backgroundColor: C.bgGreen,
  },

  wordsBox: {
    borderWidth: 1, borderColor: C.borderLight, borderRadius: 3,
    padding: 7, backgroundColor: C.bgLight, marginBottom: 8,
  },
  wordsLabel: { fontSize: 7, color: C.textLight, letterSpacing: 0.4, marginBottom: 2 },
  wordsText: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.text, lineHeight: 1.35 },

  // ── Tax summary ──
  taxTable: { borderWidth: 1, borderColor: C.borderLight, borderRadius: 3, overflow: 'hidden' },
  taxHeaderRow: { flexDirection: 'row', backgroundColor: C.bgLight, paddingVertical: 3.5, paddingHorizontal: 5 },
  taxTh: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.textMed },
  taxRow: { flexDirection: 'row', paddingVertical: 3.5, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: C.borderLight },
  taxTd: { fontSize: 7.5, color: C.text },

  // ── Bank / notes ──
  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.darkGreen,
    letterSpacing: 0.6, marginBottom: 4,
  },
  bankGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    borderWidth: 1, borderColor: C.borderLight, borderRadius: 3, padding: 7,
  },
  bankItem: { width: '50%', marginBottom: 3 },
  bankLabel: { fontSize: 7, color: C.textLight },
  bankValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.text },

  noteText: { fontSize: 8, color: C.textMed, lineHeight: 1.45 },
  termRow: { flexDirection: 'row', marginBottom: 2 },
  termBullet: { fontSize: 8, color: C.accentGreen, width: 8 },
  termText: { fontSize: 8, color: C.textMed, flex: 1, lineHeight: 1.45 },

  // ── Footer ──
  footer: { marginTop: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  signatureBlock: { width: 170, alignItems: 'flex-end' },
  signatureLabel: { fontSize: 8, color: C.textMed, marginBottom: 26 },
  signatureLine: { width: 150, height: 1, backgroundColor: C.border },
  signatureCaption: { fontSize: 7, color: C.textLight, marginTop: 3 },

  pageNumber: {
    position: 'absolute', bottom: 22, left: 34, right: 34,
    textAlign: 'center', fontSize: 7, color: C.textLight,
  },
})

function fmtDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d)
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface Props { invoice: Invoice }

export function InvoicePDF({ invoice: inv }: Props) {
  const items = inv.lineItems ?? []
  const terms = inv.termsAndConditions ?? []
  const initials = (inv.companyName ?? 'C').slice(0, 2).toUpperCase()

  // The per-slab rollup for the tax summary is not stored, so it is derived
  // from the same helper the editor uses.
  const { taxBreakup } = computeInvoiceTotals(items, inv.supplierStateCode, inv.placeOfSupplyCode)

  const hasBank = !!(inv.bankName || inv.bankAccountNumber || inv.upiId)
  const balanceDue = inv.totalAmount - inv.amountPaid

  return (
    <Document title={`Invoice - ${inv.invoiceNumber}`} author={inv.companyName ?? ''}>
      <Page size="A4" style={styles.page}>

        {inv.companyLogoUrl && <Image src={inv.companyLogoUrl} style={styles.watermark} />}

        {/* ── HEADER ────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {inv.companyLogoUrl
              ? <Image src={inv.companyLogoUrl} style={styles.logo} />
              : (
                <View style={styles.logoPlaceholder}>
                  <Text style={styles.logoPlaceholderText}>{initials}</Text>
                </View>
              )
            }
            <Text style={styles.companyName}>{inv.companyName ?? 'Your Company'}</Text>
            {inv.companyAddress && <Text style={styles.companyDetail}>{inv.companyAddress}</Text>}
            {inv.companyPhone && <Text style={styles.companyDetail}>{inv.companyPhone}</Text>}
            {inv.companyWebsite && <Text style={styles.companyDetail}>{inv.companyWebsite}</Text>}
            {inv.companyGstin && (
              <Text style={[styles.companyDetail, { fontFamily: 'Helvetica-Bold', color: C.darkGreen }]}>
                GSTIN: {inv.companyGstin}
              </Text>
            )}
          </View>

          <View style={styles.headerVDivider} />

          <View style={styles.headerRight}>
            <Text style={styles.invoiceTitle}>TAX INVOICE</Text>
            <Text style={styles.invoiceSubtitle}>
              {inv.status === 'PAID' ? 'PAID IN FULL' : 'ORIGINAL FOR RECIPIENT'}
            </Text>
            <View style={styles.metaHDivider} />

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Invoice No.</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{inv.invoiceNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Invoice Date</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{fmtDate(inv.invoiceDate)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Due Date</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{fmtDate(inv.dueDate)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.headerRule} />

        {/* ── BILL TO / SHIP FROM ────────────────────────────── */}
        <View style={styles.detailsRow}>
          <View style={styles.detailBox}>
            <View style={styles.detailBoxHeader}>
              <Text style={styles.detailBoxHeaderText}>BILL TO</Text>
            </View>
            <View style={styles.detailBoxContent}>
              <Text style={styles.partyName}>{inv.clientName}</Text>
              {inv.clientAddress && <Text style={styles.partyLine}>{inv.clientAddress}</Text>}
              {inv.clientPhone && <Text style={styles.partyLine}>Phone: {inv.clientPhone}</Text>}
              {inv.clientEmail && <Text style={styles.partyLine}>{inv.clientEmail}</Text>}
              {inv.clientGstin && <Text style={styles.partyGstin}>GSTIN: {inv.clientGstin}</Text>}
            </View>
          </View>

          <View style={styles.detailBox}>
            <View style={styles.detailBoxHeader}>
              <Text style={styles.detailBoxHeaderText}>SUPPLIED BY</Text>
            </View>
            <View style={styles.detailBoxContent}>
              <Text style={styles.partyName}>{inv.companyName ?? 'Your Company'}</Text>
              {inv.companyAddress && <Text style={styles.partyLine}>{inv.companyAddress}</Text>}
              {inv.companyPhone && <Text style={styles.partyLine}>Phone: {inv.companyPhone}</Text>}
              {inv.companyGstin && <Text style={styles.partyGstin}>GSTIN: {inv.companyGstin}</Text>}
            </View>
          </View>
        </View>

        {/* ── Place of supply strip ──────────────────────────── */}
        <View style={styles.supplyStrip}>
          <View style={styles.supplyItem}>
            <Text style={styles.supplyLabel}>PLACE OF SUPPLY</Text>
            <Text style={styles.supplyValue}>
              {inv.placeOfSupplyName
                ? `${inv.placeOfSupplyCode} - ${inv.placeOfSupplyName}`
                : '—'}
            </Text>
          </View>
          <View style={styles.supplyItem}>
            <Text style={styles.supplyLabel}>SUPPLIER STATE</Text>
            <Text style={styles.supplyValue}>
              {inv.supplierStateName
                ? `${inv.supplierStateCode} - ${inv.supplierStateName}`
                : '—'}
            </Text>
          </View>
          <View style={styles.supplyItem}>
            <Text style={styles.supplyLabel}>TAX TYPE</Text>
            <Text style={styles.supplyValue}>
              {inv.isInterState ? 'IGST (Inter-state)' : 'CGST + SGST (Intra-state)'}
            </Text>
          </View>
        </View>

        {/* ── LINE ITEMS ─────────────────────────────────────── */}
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.th, styles.colSr]}>#</Text>
            <Text style={[styles.th, styles.colDesc]}>DESCRIPTION</Text>
            <Text style={[styles.th, styles.colHsn]}>HSN/SAC</Text>
            <Text style={[styles.th, styles.colQty]}>QTY</Text>
            <Text style={[styles.th, styles.colRate]}>RATE</Text>
            <Text style={[styles.th, styles.colDisc]}>DISC%</Text>
            <Text style={[styles.th, styles.colTax]}>GST%</Text>
            <Text style={[styles.th, styles.colAmt]}>AMOUNT</Text>
          </View>

          {items.map((item, i) => {
            const gross = (item.quantity || 0) * (item.rate || 0)
            const taxable = gross - (gross * (item.discountPercent || 0)) / 100
            return (
              <View key={item.id ?? i} style={[styles.tableRow, i % 2 === 1 ? { backgroundColor: C.bgLight } : {}]} wrap={false}>
                <Text style={[styles.td, styles.colSr]}>{i + 1}</Text>
                <View style={styles.colDesc}>
                  <Text style={styles.td}>{item.description}</Text>
                  {item.unit && <Text style={styles.tdMuted}>Unit: {item.unit}</Text>}
                </View>
                <Text style={[styles.td, styles.colHsn]}>{item.hsnSac || '—'}</Text>
                <Text style={[styles.td, styles.colQty]}>{item.quantity}</Text>
                <Text style={[styles.td, styles.colRate]}>{fmt(item.rate)}</Text>
                <Text style={[styles.td, styles.colDisc]}>{item.discountPercent || 0}</Text>
                <Text style={[styles.td, styles.colTax]}>{item.taxRate || 0}</Text>
                <Text style={[styles.td, styles.colAmt, { fontFamily: 'Helvetica-Bold' }]}>{fmt(taxable)}</Text>
              </View>
            )
          })}
        </View>

        {/* ── TOTALS ─────────────────────────────────────────── */}
        <View style={styles.totalsRow}>
          {/* Left: amount in words + tax summary */}
          <View style={styles.totalsLeft}>
            {inv.amountInWords && (
              <View style={styles.wordsBox}>
                <Text style={styles.wordsLabel}>AMOUNT IN WORDS</Text>
                <Text style={styles.wordsText}>{inv.amountInWords}</Text>
              </View>
            )}

            {taxBreakup.length > 0 && (
              <View style={styles.taxTable}>
                <View style={styles.taxHeaderRow}>
                  <Text style={[styles.taxTh, { width: 34 }]}>RATE</Text>
                  <Text style={[styles.taxTh, { flex: 1, textAlign: 'right' }]}>TAXABLE</Text>
                  {inv.isInterState ? (
                    <Text style={[styles.taxTh, { width: 58, textAlign: 'right' }]}>IGST</Text>
                  ) : (
                    <>
                      <Text style={[styles.taxTh, { width: 54, textAlign: 'right' }]}>CGST</Text>
                      <Text style={[styles.taxTh, { width: 54, textAlign: 'right' }]}>SGST</Text>
                    </>
                  )}
                </View>
                {taxBreakup.map((t) => (
                  <View key={t.taxRate} style={styles.taxRow}>
                    <Text style={[styles.taxTd, { width: 34 }]}>{t.taxRate}%</Text>
                    <Text style={[styles.taxTd, { flex: 1, textAlign: 'right' }]}>{fmt(t.taxableAmount)}</Text>
                    {inv.isInterState ? (
                      <Text style={[styles.taxTd, { width: 58, textAlign: 'right' }]}>{fmt(t.igst)}</Text>
                    ) : (
                      <>
                        <Text style={[styles.taxTd, { width: 54, textAlign: 'right' }]}>{fmt(t.cgst)}</Text>
                        <Text style={[styles.taxTd, { width: 54, textAlign: 'right' }]}>{fmt(t.sgst)}</Text>
                      </>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Right: money column */}
          <View style={styles.totalsRight}>
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{fmt(inv.subtotal)}</Text>
            </View>
            {inv.discountTotal > 0 && (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={styles.totalValue}>- {fmt(inv.discountTotal)}</Text>
              </View>
            )}
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Taxable Value</Text>
              <Text style={styles.totalValue}>{fmt(inv.taxableAmount)}</Text>
            </View>
            {inv.isInterState ? (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>IGST</Text>
                <Text style={styles.totalValue}>{fmt(inv.igstAmount)}</Text>
              </View>
            ) : (
              <>
                <View style={styles.totalLine}>
                  <Text style={styles.totalLabel}>CGST</Text>
                  <Text style={styles.totalValue}>{fmt(inv.cgstAmount)}</Text>
                </View>
                <View style={styles.totalLine}>
                  <Text style={styles.totalLabel}>SGST</Text>
                  <Text style={styles.totalValue}>{fmt(inv.sgstAmount)}</Text>
                </View>
              </>
            )}
            {inv.roundOff !== 0 && (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Round Off</Text>
                <Text style={styles.totalValue}>{inv.roundOff > 0 ? '+' : ''}{fmt(inv.roundOff)}</Text>
              </View>
            )}

            <View style={styles.grandTotalLine}>
              <Text style={styles.grandTotalLabel}>TOTAL</Text>
              <Text style={styles.grandTotalValue}>Rs. {fmt(inv.totalAmount)}</Text>
            </View>

            {inv.amountPaid > 0 && (
              <>
                <View style={styles.totalLine}>
                  <Text style={styles.totalLabel}>Amount Received</Text>
                  <Text style={styles.totalValue}>{fmt(inv.amountPaid)}</Text>
                </View>
                <View style={styles.balanceLine}>
                  <Text style={[styles.totalLabel, { fontFamily: 'Helvetica-Bold', color: C.darkGreen }]}>
                    Balance Due
                  </Text>
                  <Text style={[styles.totalValue, { color: C.darkGreen }]}>Rs. {fmt(balanceDue)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ── BANK DETAILS ───────────────────────────────────── */}
        {hasBank && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PAYMENT DETAILS</Text>
            <View style={styles.bankGrid}>
              {inv.bankAccountName && (
                <View style={styles.bankItem}>
                  <Text style={styles.bankLabel}>Account Name</Text>
                  <Text style={styles.bankValue}>{inv.bankAccountName}</Text>
                </View>
              )}
              {inv.bankName && (
                <View style={styles.bankItem}>
                  <Text style={styles.bankLabel}>Bank</Text>
                  <Text style={styles.bankValue}>{inv.bankName}</Text>
                </View>
              )}
              {inv.bankAccountNumber && (
                <View style={styles.bankItem}>
                  <Text style={styles.bankLabel}>Account Number</Text>
                  <Text style={styles.bankValue}>{inv.bankAccountNumber}</Text>
                </View>
              )}
              {inv.bankIfsc && (
                <View style={styles.bankItem}>
                  <Text style={styles.bankLabel}>IFSC</Text>
                  <Text style={styles.bankValue}>{inv.bankIfsc}</Text>
                </View>
              )}
              {inv.upiId && (
                <View style={styles.bankItem}>
                  <Text style={styles.bankLabel}>UPI ID</Text>
                  <Text style={styles.bankValue}>{inv.upiId}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── NOTES ──────────────────────────────────────────── */}
        {inv.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>NOTES</Text>
            <Text style={styles.noteText}>{inv.notes}</Text>
          </View>
        )}

        {/* ── TERMS ──────────────────────────────────────────── */}
        {terms.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TERMS &amp; CONDITIONS</Text>
            {terms.map((t, i) => (
              <View key={i} style={styles.termRow}>
                <Text style={styles.termBullet}>•</Text>
                <Text style={styles.termText}>{t}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── FOOTER ─────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={[styles.noteText, { flex: 1 }]}>
            This is a computer-generated invoice.
          </Text>
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureLabel}>For, {inv.companyName ?? 'Company'}</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureCaption}>Authorized Signatory</Text>
          </View>
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  )
}
