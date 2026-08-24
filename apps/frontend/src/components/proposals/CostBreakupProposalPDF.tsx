import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import type { Proposal } from '@/types'

// Disable hyphenation — prevents "23-rd", "Pro-posal" breaks
Font.registerHyphenationCallback((word) => [word])

// ── Color palette (matches ProposalPDF for brand consistency) ──
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
  gold: '#b8860b',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: C.text,
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 34,
    backgroundColor: C.white,
  },

  // ── Header ──
  header: { flexDirection: 'row', marginBottom: 0 },
  headerLeft: { width: 190, paddingRight: 8 },
  logo: { width: 56, height: 56, objectFit: 'contain', marginBottom: 6 },
  logoPlaceholder: {
    width: 48, height: 48, borderRadius: 4, backgroundColor: C.bgGreen,
    borderWidth: 1, borderColor: C.accentGreen, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  logoPlaceholderText: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accentGreen },
  companyName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.text, marginBottom: 4, lineHeight: 1.2 },
  companyTagline: { fontSize: 7.5, fontFamily: 'Helvetica-Oblique', color: C.accentGreen, marginBottom: 5 },
  companyDetail: { fontSize: 8, color: C.textLight, marginBottom: 3, lineHeight: 1.4 },
  headerVDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 14, minHeight: 90 },
  headerRight: { flex: 1, paddingLeft: 4, justifyContent: 'center' },
  metaRow: { flexDirection: 'row', marginBottom: 6, alignItems: 'flex-start' },
  metaLabel: { width: 68, fontSize: 8, color: C.textLight },
  metaColon: { width: 10, fontSize: 8, color: C.textLight, textAlign: 'center' },
  metaValue: { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.text },
  headerRule: { height: 2, backgroundColor: C.darkGreen, marginTop: 10, marginBottom: 10 },

  // ── Project title banner ──
  projectBanner: {
    backgroundColor: C.darkGreen,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 2,
    marginBottom: 14,
    alignItems: 'center',
  },
  projectBannerText: { color: C.white, fontSize: 14, fontFamily: 'Helvetica-Bold', letterSpacing: 1.5 },

  // ── Details boxes ──
  detailsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  detailBox: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 2, overflow: 'hidden' },
  detailBoxHeader: { backgroundColor: C.darkGreen, paddingVertical: 7, paddingHorizontal: 10 },
  detailBoxHeaderText: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8.5, letterSpacing: 0.5 },
  detailBoxContent: { padding: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 7 },
  detailLabel: { width: 46, fontSize: 8, color: C.textLight },
  detailColon: { width: 10, fontSize: 8, color: C.textLight, textAlign: 'center' },
  detailValue: { flex: 1, fontSize: 8, color: C.text, fontFamily: 'Helvetica-Bold' },
  detailBlankLine: { flex: 1, borderBottomWidth: 1, borderBottomColor: C.border, marginTop: 7, marginLeft: 4 },

  // ── Material section tables ──
  section: { marginBottom: 14 },
  sectionTable: { borderWidth: 1, borderColor: C.border, borderRadius: 2, overflow: 'hidden' },
  sectionTitleBar: { backgroundColor: C.darkGreen, paddingVertical: 7, paddingHorizontal: 10 },
  sectionTitleText: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9.5, letterSpacing: 0.5 },
  colHeaderRow: { flexDirection: 'row', backgroundColor: C.accentGreen },
  colHeaderCell: { padding: 6, color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  matRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.borderLight },
  matCellNo: { width: 26, padding: 6, fontSize: 8, color: C.textLight, textAlign: 'center' },
  matCellDesc: { flex: 1, padding: 6, fontSize: 8, color: C.textMed, lineHeight: 1.4 },
  matCellRate: { width: 110, padding: 6, fontSize: 8, color: C.text, textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  // ── Cost breakup table ──
  cbTable: { borderWidth: 1, borderColor: C.border, borderRadius: 2, overflow: 'hidden' },
  cbHeaderRow: { flexDirection: 'row', backgroundColor: C.darkGreen },
  cbHeaderCell: { padding: 7, color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  cbRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  cbCellItem: { width: 110, padding: 8, fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.text },
  cbCellDesc: { flex: 1, padding: 8, fontSize: 8, color: C.textMed, lineHeight: 1.4 },
  cbCellAmount: { width: 90, padding: 8, fontSize: 8.5, textAlign: 'right', color: C.text, fontFamily: 'Helvetica-Bold' },
  cbTotalRow: { flexDirection: 'row', backgroundColor: C.darkGreen, marginTop: 8, borderRadius: 2, overflow: 'hidden' },
  cbTotalLabel: { flex: 1, padding: 10, color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 10, letterSpacing: 0.5 },
  cbTotalAmount: { padding: 10, color: '#f2c744', fontFamily: 'Helvetica-Bold', fontSize: 12, textAlign: 'right' },

  // ── About / note ──
  sectionHeading: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.text, marginBottom: 6, letterSpacing: 0.3 },
  aboutText: { fontSize: 8.5, color: C.textMed, lineHeight: 1.6, marginBottom: 14 },
  footerNote: { fontSize: 7.5, fontFamily: 'Helvetica-Oblique', color: C.textLight, textAlign: 'center', marginTop: 10 },

  // ── Footer / signature ──
  footer: { marginTop: 18, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12 },
  signatureRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  signatureLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.text, marginBottom: 24 },
  signatureLine: { width: 145, borderBottomWidth: 1, borderBottomColor: '#888888' },
  signatureCaption: { fontSize: 7.5, color: C.textLight, marginTop: 4 },
})

function fmtDate(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const suffix = (n: number) => (n > 3 && n < 21) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${d}${suffix(d)} ${months[m - 1]} ${y}`
}

function fmtAmount(n: number): string {
  return `Rs. ${n.toLocaleString('en-IN')}/-`
}

interface Props { proposal: Proposal }

export function CostBreakupProposalPDF({ proposal: p }: Props) {
  const sections = p.materialSections ?? []
  const items = p.costBreakupItems ?? []
  const total = items.reduce((a, i) => a + i.amount, 0)
  const initials = (p.companyName ?? 'C').slice(0, 2).toUpperCase()

  return (
    <Document title={`Estimate – ${p.proposalNumber}`} author={p.companyName ?? ''}>
      <Page size="A4" style={styles.page} wrap>
        {/* ── HEADER ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {p.companyLogoUrl
              ? <Image src={p.companyLogoUrl} style={styles.logo} />
              : (
                <View style={styles.logoPlaceholder}>
                  <Text style={styles.logoPlaceholderText}>{initials}</Text>
                </View>
              )
            }
            <Text style={styles.companyName}>{p.companyName ?? 'Your Company'}</Text>
            {p.serviceType && <Text style={styles.companyTagline}>{p.serviceType}</Text>}
            {p.companyAddress && <Text style={styles.companyDetail}>{p.companyAddress}</Text>}
            {p.companyPhone && <Text style={styles.companyDetail}>{p.companyPhone}</Text>}
            {p.companyWebsite && <Text style={styles.companyDetail}>{p.companyWebsite}</Text>}
          </View>

          <View style={styles.headerVDivider} />

          <View style={styles.headerRight}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{fmtDate(p.date)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Estimate No.</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{p.proposalNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Valid Till</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{fmtDate(p.validTill)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.headerRule} />

        {/* ── PROJECT TITLE BANNER ── */}
        {p.siteName && (
          <View style={styles.projectBanner}>
            <Text style={styles.projectBannerText}>{p.siteName.toUpperCase()}</Text>
          </View>
        )}

        {/* ── CLIENT + PROJECT DETAILS ── */}
        <View style={styles.detailsRow}>
          <View style={styles.detailBox}>
            <View style={styles.detailBoxHeader}>
              <Text style={styles.detailBoxHeaderText}>CLIENT DETAILS</Text>
            </View>
            <View style={styles.detailBoxContent}>
              {[
                ['Name', p.clientName],
                ['Phone', p.clientPhone],
                ['Email', p.clientEmail],
                ['Address', p.clientAddress],
              ].map(([label, val]) => (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailColon}>:</Text>
                  {val ? <Text style={styles.detailValue}>{val}</Text> : <View style={styles.detailBlankLine} />}
                </View>
              ))}
            </View>
          </View>

          <View style={styles.detailBox}>
            <View style={styles.detailBoxHeader}>
              <Text style={styles.detailBoxHeaderText}>PROJECT DETAILS</Text>
            </View>
            <View style={styles.detailBoxContent}>
              {[
                ['Location', p.projectLocation],
                ['Type', p.projectType],
                ['Scope', p.projectScope],
              ].map(([label, val]) => (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailColon}>:</Text>
                  {val ? <Text style={styles.detailValue}>{val}</Text> : <View style={styles.detailBlankLine} />}
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── ABOUT COMPANY ── */}
        {p.aboutCompany && (
          <View>
            <Text style={styles.sectionHeading}>ABOUT {(p.companyName ?? 'US').toUpperCase()}</Text>
            <Text style={styles.aboutText}>{p.aboutCompany}</Text>
          </View>
        )}

        {/* ── MATERIAL SECTIONS ── */}
        {sections.map((sec) => (
          <View key={sec.id} style={styles.section} wrap={false}>
            <View style={styles.sectionTable}>
              <View style={styles.sectionTitleBar}>
                <Text style={styles.sectionTitleText}>{sec.title.toUpperCase()}</Text>
              </View>
              <View style={styles.colHeaderRow}>
                <Text style={[styles.colHeaderCell, { width: 26, textAlign: 'center' }]}>No.</Text>
                <Text style={[styles.colHeaderCell, { flex: 1 }]}>Product Description</Text>
                <Text style={[styles.colHeaderCell, { width: 110, textAlign: 'right' }]}>{sec.rateLabel || 'Rate'}</Text>
              </View>
              {sec.items.map((item, i) => (
                <View key={i} style={[styles.matRow, i % 2 === 1 ? { backgroundColor: C.bgLight } : {}]}>
                  <Text style={styles.matCellNo}>{item.srNo}</Text>
                  <Text style={styles.matCellDesc}>{item.description}</Text>
                  <Text style={styles.matCellRate}>{item.rate || ''}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* ── COST BREAKUP ── */}
        {items.length > 0 && (
          <View style={styles.section} wrap={false}>
            <View style={styles.cbTable}>
              <View style={styles.cbHeaderRow}>
                <Text style={[styles.cbHeaderCell, { width: 110 }]}>Item</Text>
                <Text style={[styles.cbHeaderCell, { flex: 1 }]}>Description</Text>
                <Text style={[styles.cbHeaderCell, { width: 90, textAlign: 'right' }]}>Amount</Text>
              </View>
              {items.map((item, i) => (
                <View key={i} style={[styles.cbRow, i % 2 === 1 ? { backgroundColor: C.bgLight } : {}]}>
                  <Text style={styles.cbCellItem}>{item.item}</Text>
                  <Text style={styles.cbCellDesc}>{item.description}</Text>
                  <Text style={styles.cbCellAmount}>{fmtAmount(item.amount)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.cbTotalRow}>
              <Text style={styles.cbTotalLabel}>TOTAL PROJECT COST</Text>
              <Text style={styles.cbTotalAmount}>{fmtAmount(total)}</Text>
            </View>
            {p.feesAmountInWords && (
              <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Oblique', color: C.textLight, marginTop: 5 }}>
                ({p.feesAmountInWords})
              </Text>
            )}
            <Text style={styles.footerNote}>
              {p.feesNote || `${p.companyName ?? 'We'} | All prices are estimates subject to final measurement & design confirmation.`}
            </Text>
          </View>
        )}

        {/* ── TERMS (optional) ── */}
        {(p.termsAndConditions ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>TERMS &amp; CONDITIONS</Text>
            {(p.termsAndConditions ?? []).map((t, i) => (
              <Text key={i} style={{ fontSize: 8.5, color: C.textMed, lineHeight: 1.55, marginBottom: 4 }}>
                • {t}
              </Text>
            ))}
          </View>
        )}

        {/* ── FOOTER / SIGNATURE ── */}
        <View style={styles.footer} wrap={false}>
          <View style={styles.signatureRow}>
            <View>
              <Text style={styles.signatureLabel}>For, {p.companyName ?? 'Company'}</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureCaption}>Authorized Signature</Text>
            </View>
            <View>
              <Text style={styles.signatureLabel}>Accepted By,</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureCaption}>Signature &amp; Date</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
