import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { OptionEstimate } from '@/lib/visualizer/estimate'
import { SQFT_PER_SQM, formatQuantity } from '@/lib/visualizer/estimate'

const C = {
  text: '#1a1a1a',
  muted: '#666666',
  border: '#d9d9d9',
  bg: '#f5f5f5',
  accent: '#1a3c00',
  ok: '#1f7a35',
}

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: C.text, padding: 28 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  logo: { height: 30, objectFit: 'contain' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.accent },
  h2: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.accent },
  sub: { fontSize: 9, color: C.muted, marginTop: 2 },
  badge: { fontSize: 8, color: '#fff', backgroundColor: C.ok, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },
  image: { width: '100%', objectFit: 'contain', marginBottom: 10, maxHeight: 300 },
  coverImage: { width: '100%', objectFit: 'contain', marginVertical: 12, maxHeight: 360 },
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 2 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
  head: { backgroundColor: C.bg, fontFamily: 'Helvetica-Bold' },
  cell: { padding: 4 },
  foot: { marginTop: 10, fontSize: 7.5, color: C.muted, lineHeight: 1.4 },
  notes: { marginBottom: 8, fontSize: 9, lineHeight: 1.4 },
})

export interface PresentationOption {
  name: string
  notes: string
  approved: boolean
  imageDataUrl: string
  estimate: OptionEstimate
}

const money = (v: number) => `Rs. ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const sqft = (sqm: number) => (sqm * SQFT_PER_SQM).toLocaleString('en-IN', { maximumFractionDigits: 1 })

const COLS = [
  { label: 'Surfaces', w: '22%' },
  { label: 'Material', w: '26%' },
  { label: 'Brand / code', w: '16%' },
  { label: 'Area', w: '10%' },
  { label: 'Quantity', w: '14%' },
  { label: 'Amount', w: '12%' },
] as const

/** Client presentation: cover with the original render, one page per option, cost comparison. */
export function PresentationPDF({
  projectName,
  clientName,
  company,
  logoDataUrl,
  originalDataUrl,
  options,
  showPrices,
}: {
  projectName: string
  clientName: string | null
  company: string | null
  logoDataUrl: string | null
  originalDataUrl: string
  options: PresentationOption[]
  showPrices: boolean
}) {
  const date = new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' })
  const Header = ({ right }: { right?: string }) => (
    <View style={s.header}>
      {logoDataUrl ? <Image src={logoDataUrl} style={s.logo} /> : <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 11 }}>{company ?? ''}</Text>}
      <Text style={s.sub}>{right ?? date}</Text>
    </View>
  )
  return (
    <Document title={`${projectName} — design options`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header />
        <Text style={s.title}>{projectName}</Text>
        <Text style={s.sub}>
          {clientName ? `Prepared for ${clientName} · ` : ''}
          {options.length} design option{options.length === 1 ? '' : 's'} · {date}
        </Text>
        <Image src={originalDataUrl} style={s.coverImage} />
        <Text style={s.sub}>Current design (original render)</Text>
      </Page>

      {options.map((o, i) => (
        <Page key={i} size="A4" orientation="landscape" style={s.page}>
          <Header right={projectName} />
          <View style={[s.header, { marginBottom: 6 }]}>
            <Text style={s.h2}>{o.name}</Text>
            {o.approved && <Text style={s.badge}>APPROVED</Text>}
          </View>
          <Image src={o.imageDataUrl} style={s.image} />
          {o.notes ? <Text style={s.notes}>{o.notes}</Text> : null}
          {o.estimate.lines.length > 0 && (
            <View style={s.table}>
              <View style={[s.row, s.head]}>
                {COLS.filter((c) => showPrices || c.label !== 'Amount').map((c) => (
                  <Text key={c.label} style={[s.cell, { width: c.w }]}>{c.label}</Text>
                ))}
              </View>
              {o.estimate.lines.map((l, k) => (
                <View key={k} style={[s.row, k === o.estimate.lines.length - 1 && !showPrices ? { borderBottomWidth: 0 } : {}]} wrap={false}>
                  <Text style={[s.cell, { width: COLS[0].w }]}>{l.surfaces.join(', ')}</Text>
                  <Text style={[s.cell, { width: COLS[1].w }]}>{l.material.name}{l.material.kind === 'paint' && l.material.colorHex ? ` (${l.material.colorHex})` : ''}</Text>
                  <Text style={[s.cell, { width: COLS[2].w }]}>{[l.material.brand, l.material.code].filter(Boolean).join(' · ') || '—'}</Text>
                  <Text style={[s.cell, { width: COLS[3].w }]}>{sqft(l.areaSqm)} sq ft</Text>
                  <Text style={[s.cell, { width: COLS[4].w }]}>{formatQuantity(l)}</Text>
                  {showPrices && <Text style={[s.cell, { width: COLS[5].w }]}>{l.cost != null ? money(l.cost) : '—'}</Text>}
                </View>
              ))}
              {showPrices && (
                <View style={[s.row, s.head, { borderBottomWidth: 0 }]}>
                  <Text style={[s.cell, { width: '88%' }]}>Estimated material cost{o.estimate.unpriced ? ` (${o.estimate.unpriced} item(s) not priced)` : ''}</Text>
                  <Text style={[s.cell, { width: '12%' }]}>{money(o.estimate.total)}</Text>
                </View>
              )}
            </View>
          )}
        </Page>
      ))}

      {options.length > 1 && (
        <Page size="A4" orientation="landscape" style={s.page}>
          <Header right={projectName} />
          <Text style={[s.h2, { marginBottom: 8 }]}>Options at a glance</Text>
          <View style={s.table}>
            <View style={[s.row, s.head]}>
              <Text style={[s.cell, { width: '40%' }]}>Option</Text>
              <Text style={[s.cell, { width: '30%' }]}>Area covered</Text>
              {showPrices && <Text style={[s.cell, { width: '30%' }]}>Estimated material cost</Text>}
            </View>
            {options.map((o, i) => (
              <View key={i} style={[s.row, i === options.length - 1 ? { borderBottomWidth: 0 } : {}]}>
                <Text style={[s.cell, { width: '40%' }]}>{o.name}{o.approved ? ' (approved)' : ''}</Text>
                <Text style={[s.cell, { width: '30%' }]}>{sqft(o.estimate.areaSqm)} sq ft</Text>
                {showPrices && <Text style={[s.cell, { width: '30%' }]}>{money(o.estimate.total)}</Text>}
              </View>
            ))}
          </View>
          <Text style={s.foot}>
            Visualization only: materials are applied to a rendered image, lighting is estimated from the render and reflections are approximate. On-screen and
            printed colours vary; confirm finishes against physical samples. Quantities and costs are estimates from the image — confirm with site measurements.
          </Text>
        </Page>
      )}
    </Document>
  )
}
