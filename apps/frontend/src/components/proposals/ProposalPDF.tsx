import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import type { Proposal } from '@/types'

// Disable hyphenation — prevents "23-rd", "Pro-posal" breaks
Font.registerHyphenationCallback((word) => [word])

// ── Color palette (matches sample) ──────────────────────────
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

  // ── Watermark ──
  watermark: {
    position: 'absolute',
    top: 220,
    left: 148,
    width: 300,
    height: 300,
    opacity: 0.05,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  headerLeft: {
    width: 190,
    paddingRight: 8,
  },
  logo: {
    width: 64,
    height: 64,
    objectFit: 'contain',
    marginBottom: 7,
  },
  logoPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 4,
    backgroundColor: C.bgGreen,
    borderWidth: 1,
    borderColor: C.accentGreen,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  logoPlaceholderText: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: C.accentGreen,
  },
  companyName: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
    marginBottom: 6,
    lineHeight: 1.2,
  },
  companyDetail: {
    fontSize: 8,
    color: C.textLight,
    marginBottom: 3,
    lineHeight: 1.4,
  },
  headerVDivider: {
    width: 1,
    backgroundColor: C.border,
    marginHorizontal: 14,
    minHeight: 100,
  },
  headerRight: {
    flex: 1,
    paddingLeft: 4,
  },
  proposalTitle: {
    fontSize: 34,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
    letterSpacing: 2,
    lineHeight: 1,
    marginBottom: 3,
  },
  proposalSubtitle: {
    fontSize: 8,
    letterSpacing: 3.5,
    color: C.textLight,
    marginBottom: 10,
  },
  metaHDivider: {
    height: 1,
    backgroundColor: C.border,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: 6,
    alignItems: 'flex-start',
  },
  metaLabel: {
    width: 68,
    fontSize: 8,
    color: C.textLight,
  },
  metaColon: {
    width: 10,
    fontSize: 8,
    color: C.textLight,
    textAlign: 'center',
  },
  metaValue: {
    flex: 1,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
  },

  // ── Header bottom rule ──
  headerRule: {
    height: 1,
    backgroundColor: C.border,
    marginTop: 12,
    marginBottom: 14,
  },

  // ── Details boxes ──
  detailsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  detailBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  detailBoxHeader: {
    backgroundColor: C.darkGreen,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  detailBoxHeaderText: {
    color: C.white,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.5,
    letterSpacing: 0.5,
  },
  detailBoxContent: {
    padding: 10,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 7,
  },
  detailLabel: {
    width: 46,
    fontSize: 8,
    color: C.textLight,
  },
  detailColon: {
    width: 10,
    fontSize: 8,
    color: C.textLight,
    textAlign: 'center',
  },
  detailValue: {
    flex: 1,
    fontSize: 8,
    color: C.text,
    fontFamily: 'Helvetica-Bold',
  },
  detailBlankLine: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginTop: 7,
    marginLeft: 4,
  },

  // ── Sections ──
  section: {
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.accentGreen,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCircleInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.white,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
    letterSpacing: 0.3,
  },
  sectionBody: {
    paddingLeft: 26,
  },
  sectionText: {
    fontSize: 8.5,
    color: C.textMed,
    lineHeight: 1.65,
  },

  // ── Scope of work ──
  scopeBox: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 3,
    padding: 12,
  },
  scopeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  scopeItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 7,
    paddingRight: 10,
  },
  scopeDotOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: C.accentGreen,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
    marginTop: 1,
    flexShrink: 0,
  },
  scopeDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.accentGreen,
  },
  scopeText: {
    flex: 1,
    fontSize: 8.5,
    color: C.textMed,
    lineHeight: 1.4,
  },

  // ── Fees table ──
  feesTable: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 6,
  },
  feesTableHeader: {
    flexDirection: 'row',
    backgroundColor: C.darkGreen,
  },
  feesTableHeaderCell: {
    padding: 7,
    color: C.white,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.5,
    textAlign: 'center',
  },
  feesTableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.white,
  },
  feesTableCell: {
    padding: 8,
    fontSize: 8.5,
  },
  feesAmountWordsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    backgroundColor: C.bgLight,
  },
  feesAmountWords: {
    padding: 6,
    paddingLeft: 8,
    fontSize: 8,
    fontFamily: 'Helvetica-Oblique',
    color: C.textLight,
  },
  feesNote: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Oblique',
    color: C.textLight,
    marginTop: 3,
    paddingLeft: 2,
  },

  // ── Milestones table ──
  msTable: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  msHeaderRow: {
    flexDirection: 'row',
    backgroundColor: C.darkGreen,
  },
  msHeaderCell: {
    padding: 6,
    color: C.white,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textAlign: 'center',
  },
  msRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  msCell: {
    padding: 6,
    fontSize: 8,
    color: C.text,
  },
  msTotalRow: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    borderTopColor: C.darkGreen,
    backgroundColor: C.bgGreen,
  },
  paymentIntro: {
    fontSize: 8.5,
    color: C.textMed,
    lineHeight: 1.5,
    marginBottom: 8,
  },

  // ── Terms ──
  termRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  termBullet: {
    width: 14,
    fontSize: 10,
    color: C.accentGreen,
    fontFamily: 'Helvetica-Bold',
    lineHeight: 1.3,
  },
  termText: {
    flex: 1,
    fontSize: 8.5,
    color: C.textMed,
    lineHeight: 1.55,
  },

  // ── Footer ──
  footer: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 12,
  },
  closingText: {
    fontSize: 9,
    color: C.textMed,
    textAlign: 'center',
    fontFamily: 'Helvetica-Oblique',
    marginBottom: 16,
  },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  signatureLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
    marginBottom: 24,
  },
  signatureLine: {
    width: 145,
    borderBottomWidth: 1,
    borderBottomColor: '#888888',
  },
  signatureCaption: {
    fontSize: 7.5,
    color: C.textLight,
    marginTop: 4,
  },
  thankYouBar: {
    backgroundColor: C.darkGreen,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 2,
    alignItems: 'center',
  },
  thankYouText: {
    color: C.white,
    fontSize: 8,
    letterSpacing: 5,
    fontFamily: 'Helvetica-Bold',
  },
})

// ── Helpers ──────────────────────────────────────────────────
function ordinal(n: number): string {
  if (n > 3 && n < 21) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

function fmtDate(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${d}${ordinal(d)} ${months[m - 1]} ${y}`
}

function fmtAmount(n: number): string {
  return `Rs. ${n.toLocaleString('en-IN')}/-`
}

// ── Component ─────────────────────────────────────────────────
interface Props { proposal: Proposal }

export function ProposalPDF({ proposal: p }: Props) {
  const scope = p.scopeOfWork ?? []
  const milestones = p.paymentMilestones ?? []
  const terms = p.termsAndConditions ?? []
  const totalPct = milestones.reduce((a, m) => a + m.percentage, 0)
  const totalAmt = milestones.reduce((a, m) => a + m.amount, 0)
  const initials = (p.companyName ?? 'C').slice(0, 2).toUpperCase()

  return (
    <Document title={`Proposal – ${p.proposalNumber}`} author={p.companyName ?? ''}>
      <Page size="A4" style={styles.page}>

        {/* Watermark */}
        {p.companyLogoUrl && (
          <Image src={p.companyLogoUrl} style={styles.watermark} />
        )}

        {/* ── HEADER ────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Left – company info */}
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
            {p.companyAddress && (
              <Text style={styles.companyDetail}>{p.companyAddress}</Text>
            )}
            {p.companyPhone && (
              <Text style={styles.companyDetail}>{p.companyPhone}</Text>
            )}
            {p.companyWebsite && (
              <Text style={styles.companyDetail}>{p.companyWebsite}</Text>
            )}
          </View>

          {/* Vertical divider */}
          <View style={styles.headerVDivider} />

          {/* Right – proposal title & meta */}
          <View style={styles.headerRight}>
            <Text style={styles.proposalTitle}>PROPOSAL</Text>
            <Text style={styles.proposalSubtitle}>{p.serviceType.toUpperCase()}</Text>
            <View style={styles.metaHDivider} />

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{fmtDate(p.date)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Proposal No.</Text>
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

        {/* Full-width rule below header */}
        <View style={styles.headerRule} />

        {/* ── CLIENT + PROJECT DETAILS ───────────────────────── */}
        <View style={styles.detailsRow}>
          {/* Client */}
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
                  {val
                    ? <Text style={styles.detailValue}>{val}</Text>
                    : <View style={styles.detailBlankLine} />
                  }
                </View>
              ))}
            </View>
          </View>

          {/* Project */}
          <View style={styles.detailBox}>
            <View style={styles.detailBoxHeader}>
              <Text style={styles.detailBoxHeaderText}>PROJECT DETAILS</Text>
            </View>
            <View style={styles.detailBoxContent}>
              {[
                ['Site Name', p.siteName],
                ['Location', p.projectLocation],
                ['Type', p.projectType],
                ['Scope', p.projectScope],
              ].map(([label, val]) => (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailColon}>:</Text>
                  {val
                    ? <Text style={styles.detailValue}>{val}</Text>
                    : <View style={styles.detailBlankLine} />
                  }
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── ABOUT COMPANY ──────────────────────────────────── */}
        {p.aboutCompany && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionCircle}>
                <View style={styles.sectionCircleInner} />
              </View>
              <Text style={styles.sectionTitle}>
                ABOUT {(p.companyName ?? 'US').toUpperCase()}
              </Text>
            </View>
            <View style={styles.sectionBody}>
              <Text style={styles.sectionText}>{p.aboutCompany}</Text>
            </View>
          </View>
        )}

        {/* ── SCOPE OF WORK ──────────────────────────────────── */}
        {scope.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionCircle}>
                <View style={styles.sectionCircleInner} />
              </View>
              <Text style={styles.sectionTitle}>SCOPE OF WORK</Text>
            </View>
            <View style={[styles.sectionBody, styles.scopeBox]}>
              <View style={styles.scopeGrid}>
                {scope.map((item, i) => (
                  <View key={i} style={styles.scopeItem}>
                    <View style={styles.scopeDotOuter}>
                      <View style={styles.scopeDotInner} />
                    </View>
                    <Text style={styles.scopeText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* ── FEES ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionCircle}>
              <View style={styles.sectionCircleInner} />
            </View>
            <Text style={styles.sectionTitle}>FEES</Text>
          </View>
          <View style={styles.sectionBody}>
            <View style={styles.feesTable}>
              {/* Header */}
              <View style={styles.feesTableHeader}>
                <Text style={[styles.feesTableHeaderCell, { flex: 2, textAlign: 'left' }]}>
                  DESCRIPTION
                </Text>
                <Text style={[styles.feesTableHeaderCell, { flex: 1, textAlign: 'right' }]}>
                  FEES
                </Text>
              </View>
              {/* Amount row */}
              <View style={styles.feesTableRow}>
                <Text style={[styles.feesTableCell, { flex: 2 }]}>{p.feesDescription}</Text>
                <Text style={[styles.feesTableCell, { flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>
                  {fmtAmount(p.feesAmount)}
                </Text>
              </View>
              {/* Amount in words */}
              {p.feesAmountInWords && (
                <View style={styles.feesAmountWordsRow}>
                  <Text style={styles.feesAmountWords}>({p.feesAmountInWords})</Text>
                </View>
              )}
            </View>
            {p.feesNote && (
              <Text style={styles.feesNote}>Note: {p.feesNote}</Text>
            )}
          </View>
        </View>

        {/* ── PAYMENT STRUCTURE ──────────────────────────────── */}
        {milestones.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionCircle}>
                <View style={styles.sectionCircleInner} />
              </View>
              <Text style={styles.sectionTitle}>PAYMENT STRUCTURE</Text>
            </View>
            <View style={styles.sectionBody}>
              <Text style={styles.paymentIntro}>
                The project fees will be payable in the following milestones:
              </Text>
              <View style={styles.msTable}>
                {/* Header */}
                <View style={styles.msHeaderRow}>
                  <Text style={[styles.msHeaderCell, { width: 55 }]}>Milestone</Text>
                  <Text style={[styles.msHeaderCell, { flex: 1, textAlign: 'left' }]}>Description</Text>
                  <Text style={[styles.msHeaderCell, { width: 60 }]}>Payment %</Text>
                  <Text style={[styles.msHeaderCell, { width: 85, textAlign: 'right' }]}>Amount (Rs.)</Text>
                </View>
                {/* Rows */}
                {milestones.map((m, i) => (
                  <View key={i} style={[styles.msRow, i % 2 === 1 ? { backgroundColor: C.bgLight } : {}]}>
                    <Text style={[styles.msCell, { width: 55, textAlign: 'center' }]}>{m.milestone}</Text>
                    <Text style={[styles.msCell, { flex: 1 }]}>{m.description}</Text>
                    <Text style={[styles.msCell, { width: 60, textAlign: 'center' }]}>{m.percentage}%</Text>
                    <Text style={[styles.msCell, { width: 85, textAlign: 'right' }]}>{fmtAmount(m.amount)}</Text>
                  </View>
                ))}
                {/* Total */}
                <View style={styles.msTotalRow}>
                  <Text style={[styles.msCell, { width: 55, textAlign: 'center', fontFamily: 'Helvetica-Bold' }]}>Total</Text>
                  <Text style={[styles.msCell, { flex: 1 }]} />
                  <Text style={[styles.msCell, { width: 60, textAlign: 'center', fontFamily: 'Helvetica-Bold' }]}>{totalPct}%</Text>
                  <Text style={[styles.msCell, { width: 85, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{fmtAmount(totalAmt)}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── TERMS & CONDITIONS ─────────────────────────────── */}
        {terms.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionCircle}>
                <View style={styles.sectionCircleInner} />
              </View>
              <Text style={styles.sectionTitle}>TERMS &amp; CONDITIONS</Text>
            </View>
            <View style={styles.sectionBody}>
              {terms.map((t, i) => (
                <View key={i} style={styles.termRow}>
                  <Text style={styles.termBullet}>•</Text>
                  <Text style={styles.termText}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── FOOTER ─────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.closingText}>
            We look forward to working with you.
          </Text>

          <View style={styles.signatureRow}>
            <View>
              <Text style={styles.signatureLabel}>
                For, {p.companyName ?? 'Company'}
              </Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureCaption}>Authorized Signature</Text>
            </View>
            <View>
              <Text style={styles.signatureLabel}>Accepted By,</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureCaption}>Signature &amp; Date</Text>
            </View>
          </View>

          <View style={styles.thankYouBar}>
            <Text style={styles.thankYouText}>
              T H A N K  Y O U  F O R  Y O U R  T R U S T  I N  U S .
            </Text>
          </View>
        </View>

      </Page>
    </Document>
  )
}
