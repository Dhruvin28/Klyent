import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import type { PurchaseOrder } from '@/types'
import { computeInvoiceTotals } from '@/lib/invoiceTotals'

Font.registerHyphenationCallback((word) => [word])

// Palette shared with InvoicePDF / ProposalPDF.
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
  page: { fontFamily: 'Helvetica', fontSize: 9, color: C.text, paddingTop: 30, paddingBottom: 48, paddingHorizontal: 34 },

  header: { flexDirection: 'row' },
  headerLeft: { width: 210, paddingRight: 10 },
  logo: { width: 60, height: 60, objectFit: 'contain', marginBottom: 6 },
  logoPlaceholder: { width: 50, height: 50, borderRadius: 4, marginBottom: 6, backgroundColor: C.darkGreen, alignItems: 'center', justifyContent: 'center' },
  logoPlaceholderText: { color: C.white, fontSize: 18, fontFamily: 'Helvetica-Bold' },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.darkGreen, marginBottom: 3 },
  companyDetail: { fontSize: 8, color: C.textMed, marginBottom: 1.5, lineHeight: 1.4 },
  headerVDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 12 },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.darkGreen, letterSpacing: 1.5 },
  subtitle: { fontSize: 8, color: C.accentGreen, letterSpacing: 1, marginTop: 1 },
  metaHDivider: { height: 1, backgroundColor: C.border, alignSelf: 'stretch', marginVertical: 7 },
  metaRow: { flexDirection: 'row', marginBottom: 2.5, justifyContent: 'flex-end' },
  metaLabel: { fontSize: 8, color: C.textLight, width: 80, textAlign: 'right' },
  metaColon: { fontSize: 8, color: C.textLight, width: 8, textAlign: 'center' },
  metaValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.text, width: 95, textAlign: 'right' },
  headerRule: { height: 2, backgroundColor: C.darkGreen, marginTop: 10, marginBottom: 12 },

  detailsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  detailBox: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 3 },
  detailBoxHeader: { backgroundColor: C.darkGreen, paddingVertical: 4, paddingHorizontal: 7 },
  detailBoxHeaderText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.white, letterSpacing: 0.6 },
  detailBoxContent: { padding: 7 },
  partyName: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.text, marginBottom: 3 },
  partyLine: { fontSize: 8, color: C.textMed, marginBottom: 1.5, lineHeight: 1.4 },
  partyGstin: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.darkGreen, marginTop: 3 },
  partyLabel: { fontSize: 7, color: C.textLight, marginTop: 5, letterSpacing: 0.4 },

  table: { borderWidth: 1, borderColor: C.border, borderRadius: 3, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: C.darkGreen, paddingVertical: 5, paddingHorizontal: 5 },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.white, letterSpacing: 0.3 },
  tableRow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: C.borderLight, alignItems: 'flex-start' },
  td: { fontSize: 8, color: C.text, lineHeight: 1.35 },
  colSr: { width: 20, textAlign: 'center' },
  colDesc: { flex: 1, paddingRight: 4 },
  colHsn: { width: 44, textAlign: 'center' },
  colQty: { width: 40, textAlign: 'right' },
  colUnit: { width: 36, textAlign: 'center' },
  colRate: { width: 56, textAlign: 'right' },
  colDisc: { width: 32, textAlign: 'right' },
  colTax: { width: 32, textAlign: 'right' },
  colAmt: { width: 64, textAlign: 'right' },

  totalsRow: { flexDirection: 'row', marginTop: 12, gap: 10 },
  totalsLeft: { flex: 1 },
  totalsRight: { width: 210 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 7, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  totalLabel: { fontSize: 8.5, color: C.textMed },
  totalValue: { fontSize: 8.5, color: C.text, fontFamily: 'Helvetica-Bold' },
  grandTotalLine: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.darkGreen, paddingVertical: 6, paddingHorizontal: 7, borderRadius: 3, marginTop: 3 },
  grandTotalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white },
  grandTotalValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.white },
  wordsBox: { borderWidth: 1, borderColor: C.borderLight, borderRadius: 3, padding: 7, backgroundColor: C.bgLight, marginBottom: 8 },
  wordsLabel: { fontSize: 7, color: C.textLight, letterSpacing: 0.4, marginBottom: 2 },
  wordsText: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.text, lineHeight: 1.35 },
  taxNote: { fontSize: 7.5, color: C.textLight, lineHeight: 1.4 },

  section: { marginTop: 12 },
  sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.darkGreen, letterSpacing: 0.6, marginBottom: 4 },
  noteText: { fontSize: 8, color: C.textMed, lineHeight: 1.45 },
  termRow: { flexDirection: 'row', marginBottom: 2 },
  termBullet: { fontSize: 8, color: C.accentGreen, width: 8 },
  termText: { fontSize: 8, color: C.textMed, flex: 1, lineHeight: 1.45 },

  footer: { marginTop: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  signatureBlock: { width: 170, alignItems: 'flex-end' },
  signatureLabel: { fontSize: 8, color: C.textMed, marginBottom: 26 },
  signatureLine: { width: 150, height: 1, backgroundColor: C.border },
  signatureCaption: { fontSize: 7, color: C.textLight, marginTop: 3 },
  pageNumber: { position: 'absolute', bottom: 22, left: 34, right: 34, textAlign: 'center', fontSize: 7, color: C.textLight },
})

function fmtDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d)
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PurchaseOrderPDF({ order: po }: { order: PurchaseOrder }) {
  const items = po.lineItems ?? []
  const terms = po.termsAndConditions ?? []
  const initials = (po.companyName ?? 'C').slice(0, 2).toUpperCase()
  const hasDiscount = items.some((i) => (i.discountPercent || 0) > 0)
  const { taxBreakup } = computeInvoiceTotals(items, po.supplierStateCode, po.placeOfSupplyCode)

  return (
    <Document title={`Purchase Order - ${po.poNumber}`} author={po.companyName ?? ''}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {po.companyLogoUrl
              ? <Image src={po.companyLogoUrl} style={styles.logo} />
              : <View style={styles.logoPlaceholder}><Text style={styles.logoPlaceholderText}>{initials}</Text></View>}
            <Text style={styles.companyName}>{po.companyName ?? 'Your Company'}</Text>
            {po.companyAddress && <Text style={styles.companyDetail}>{po.companyAddress}</Text>}
            {po.companyPhone && <Text style={styles.companyDetail}>{po.companyPhone}</Text>}
            {po.companyWebsite && <Text style={styles.companyDetail}>{po.companyWebsite}</Text>}
            {po.companyGstin && (
              <Text style={[styles.companyDetail, { fontFamily: 'Helvetica-Bold', color: C.darkGreen }]}>GSTIN: {po.companyGstin}</Text>
            )}
          </View>

          <View style={styles.headerVDivider} />

          <View style={styles.headerRight}>
            <Text style={styles.title}>PURCHASE ORDER</Text>
            <Text style={styles.subtitle}>{po.status === 'CANCELLED' ? 'CANCELLED' : 'ORIGINAL FOR SUPPLIER'}</Text>
            <View style={styles.metaHDivider} />
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>PO No.</Text><Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{po.poNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>PO Date</Text><Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{fmtDate(po.poDate)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Deliver By</Text><Text style={styles.metaColon}>:</Text>
              <Text style={styles.metaValue}>{fmtDate(po.expectedDelivery)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.headerRule} />

        <View style={styles.detailsRow}>
          <View style={styles.detailBox}>
            <View style={styles.detailBoxHeader}><Text style={styles.detailBoxHeaderText}>VENDOR</Text></View>
            <View style={styles.detailBoxContent}>
              <Text style={styles.partyName}>{po.vendorName}</Text>
              {po.vendorAddress && <Text style={styles.partyLine}>{po.vendorAddress}</Text>}
              {po.vendorPhone && <Text style={styles.partyLine}>Phone: {po.vendorPhone}</Text>}
              {po.vendorEmail && <Text style={styles.partyLine}>{po.vendorEmail}</Text>}
              {po.vendorGstin && <Text style={styles.partyGstin}>GSTIN: {po.vendorGstin}</Text>}
            </View>
          </View>
          <View style={styles.detailBox}>
            <View style={styles.detailBoxHeader}><Text style={styles.detailBoxHeaderText}>BILL TO / DELIVER TO</Text></View>
            <View style={styles.detailBoxContent}>
              <Text style={styles.partyName}>{po.companyName ?? 'Your Company'}</Text>
              {po.companyGstin && <Text style={styles.partyGstin}>GSTIN: {po.companyGstin}</Text>}
              <Text style={styles.partyLabel}>DELIVERY ADDRESS</Text>
              <Text style={styles.partyLine}>{po.deliveryAddress || po.companyAddress || '—'}</Text>
              {po.placeOfSupplyName && (
                <Text style={styles.partyLine}>Place of supply: {po.placeOfSupplyCode} - {po.placeOfSupplyName}</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.th, styles.colSr]}>#</Text>
            <Text style={[styles.th, styles.colDesc]}>DESCRIPTION</Text>
            <Text style={[styles.th, styles.colHsn]}>HSN</Text>
            <Text style={[styles.th, styles.colQty]}>QTY</Text>
            <Text style={[styles.th, styles.colUnit]}>UNIT</Text>
            <Text style={[styles.th, styles.colRate]}>RATE</Text>
            {hasDiscount && <Text style={[styles.th, styles.colDisc]}>DISC%</Text>}
            <Text style={[styles.th, styles.colTax]}>GST%</Text>
            <Text style={[styles.th, styles.colAmt]}>AMOUNT</Text>
          </View>
          {items.map((item, i) => {
            const gross = (item.quantity || 0) * (item.rate || 0)
            const taxable = gross - (gross * (item.discountPercent || 0)) / 100
            return (
              <View key={item.id ?? i} style={[styles.tableRow, i % 2 === 1 ? { backgroundColor: C.bgLight } : {}]} wrap={false}>
                <Text style={[styles.td, styles.colSr]}>{i + 1}</Text>
                <Text style={[styles.td, styles.colDesc]}>{item.description}</Text>
                <Text style={[styles.td, styles.colHsn]}>{item.hsnSac || '—'}</Text>
                <Text style={[styles.td, styles.colQty]}>{item.quantity}</Text>
                <Text style={[styles.td, styles.colUnit]}>{item.unit || '—'}</Text>
                <Text style={[styles.td, styles.colRate]}>{fmt(item.rate)}</Text>
                {hasDiscount && <Text style={[styles.td, styles.colDisc]}>{item.discountPercent || 0}</Text>}
                <Text style={[styles.td, styles.colTax]}>{item.taxRate || 0}</Text>
                <Text style={[styles.td, styles.colAmt, { fontFamily: 'Helvetica-Bold' }]}>{fmt(taxable)}</Text>
              </View>
            )
          })}
        </View>

        <View style={styles.totalsRow}>
          <View style={styles.totalsLeft}>
            {po.amountInWords && (
              <View style={styles.wordsBox}>
                <Text style={styles.wordsLabel}>AMOUNT IN WORDS</Text>
                <Text style={styles.wordsText}>{po.amountInWords}</Text>
              </View>
            )}
            {taxBreakup.length > 0 && (
              <Text style={styles.taxNote}>
                {po.isInterState ? 'IGST applies (inter-state supply).' : 'CGST + SGST apply (intra-state supply).'}
                {po.supplierStateName ? ` Supplier state: ${po.supplierStateName}.` : ''}
              </Text>
            )}
          </View>
          <View style={styles.totalsRight}>
            <View style={styles.totalLine}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalValue}>{fmt(po.subtotal)}</Text></View>
            {po.discountTotal > 0 && (
              <View style={styles.totalLine}><Text style={styles.totalLabel}>Discount</Text><Text style={styles.totalValue}>- {fmt(po.discountTotal)}</Text></View>
            )}
            <View style={styles.totalLine}><Text style={styles.totalLabel}>Taxable Value</Text><Text style={styles.totalValue}>{fmt(po.taxableAmount)}</Text></View>
            {po.isInterState ? (
              <View style={styles.totalLine}><Text style={styles.totalLabel}>IGST</Text><Text style={styles.totalValue}>{fmt(po.igstAmount)}</Text></View>
            ) : (
              <>
                <View style={styles.totalLine}><Text style={styles.totalLabel}>CGST</Text><Text style={styles.totalValue}>{fmt(po.cgstAmount)}</Text></View>
                <View style={styles.totalLine}><Text style={styles.totalLabel}>SGST</Text><Text style={styles.totalValue}>{fmt(po.sgstAmount)}</Text></View>
              </>
            )}
            {po.roundOff !== 0 && (
              <View style={styles.totalLine}><Text style={styles.totalLabel}>Round Off</Text><Text style={styles.totalValue}>{po.roundOff > 0 ? '+' : ''}{fmt(po.roundOff)}</Text></View>
            )}
            <View style={styles.grandTotalLine}>
              <Text style={styles.grandTotalLabel}>TOTAL</Text>
              <Text style={styles.grandTotalValue}>Rs. {fmt(po.totalAmount)}</Text>
            </View>
          </View>
        </View>

        {po.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>NOTES</Text>
            <Text style={styles.noteText}>{po.notes}</Text>
          </View>
        )}

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

        <View style={styles.footer}>
          <Text style={[styles.noteText, { flex: 1 }]}>
            Please quote the PO number on your invoice and delivery challan.
          </Text>
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureLabel}>For, {po.companyName ?? 'Company'}</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureCaption}>Authorized Signatory</Text>
          </View>
        </View>

        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>
    </Document>
  )
}
