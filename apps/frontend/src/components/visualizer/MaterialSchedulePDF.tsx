import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ExportDetails } from '@/api/visualizer'
import type { VerificationReport } from '@/lib/visualizer/types'

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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.accent },
  sub: { fontSize: 9, color: C.muted, marginTop: 2 },
  badge: { fontSize: 8, color: '#fff', backgroundColor: C.ok, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },
  image: { width: '100%', objectFit: 'contain', marginBottom: 10, maxHeight: 330 },
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 2 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
  head: { backgroundColor: C.bg, fontFamily: 'Helvetica-Bold' },
  cell: { padding: 4 },
  swatch: { width: 10, height: 10, borderWidth: 0.5, borderColor: C.border, marginRight: 4 },
  foot: { marginTop: 10, fontSize: 7.5, color: C.muted, lineHeight: 1.4 },
})

const COLS = [
  { key: 'surface', label: 'Surface', w: '16%' },
  { key: 'material', label: 'Material', w: '22%' },
  { key: 'brand', label: 'Brand / code', w: '16%' },
  { key: 'size', label: 'Sample / tile size', w: '12%' },
  { key: 'surfaceSize', label: 'Surface size', w: '12%' },
  { key: 'application', label: 'Application', w: '22%' },
] as const

function describeApplication(a: Record<string, string | number | boolean>): string {
  const parts: string[] = []
  if (a.pattern) parts.push(a.pattern === 'tiles' ? `Tiles (${a.layout}${a.groutMm ? `, ${a.groutMm}mm grout` : ''})` : 'Continuous')
  if (typeof a.rotationDeg === 'number') parts.push(a.rotationDeg === 0 ? 'Grain vertical' : a.rotationDeg === 90 || a.rotationDeg === -90 ? 'Grain horizontal' : `Grain ${a.rotationDeg}°`)
  if (typeof a.scale === 'number' && Math.abs(a.scale - 1) > 0.005) parts.push(`Scale ${a.scale.toFixed(2)}×`)
  if (a.finish) parts.push(String(a.finish)[0].toUpperCase() + String(a.finish).slice(1))
  return parts.join(' · ')
}

export function MaterialSchedulePDF({
  details,
  imageDataUrl,
  verification,
}: {
  details: ExportDetails
  imageDataUrl: string
  verification: VerificationReport
}) {
  const date = new Date(details.generatedAt)
  return (
    <Document title={`${details.project} — ${details.option}`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>{details.project}</Text>
            <Text style={s.sub}>
              {details.option} · Material schedule · {date.toLocaleDateString()} · {details.image.width}×{details.image.height}px
            </Text>
          </View>
          {details.approved && <Text style={s.badge}>APPROVED</Text>}
        </View>
        <Image src={imageDataUrl} style={s.image} />
        <View style={s.table}>
          <View style={[s.row, s.head]}>
            {COLS.map((c) => (
              <Text key={c.key} style={[s.cell, { width: c.w }]}>{c.label}</Text>
            ))}
          </View>
          {details.surfaces.map((x, i) => (
            <View key={i} style={[s.row, i === details.surfaces.length - 1 ? { borderBottomWidth: 0 } : {}]} wrap={false}>
              <Text style={[s.cell, { width: COLS[0].w }]}>{x.name} ({x.type})</Text>
              <View style={[s.cell, { width: COLS[1].w, flexDirection: 'row', alignItems: 'center' }]}>
                {x.material.colorHex && <View style={[s.swatch, { backgroundColor: x.material.colorHex }]} />}
                <Text>{x.material.name}{x.material.kind === 'paint' ? ` (${x.material.colorHex})` : ` — ${x.material.category}`}</Text>
              </View>
              <Text style={[s.cell, { width: COLS[2].w }]}>{[x.material.brand, x.material.code].filter(Boolean).join(' · ') || '—'}</Text>
              <Text style={[s.cell, { width: COLS[3].w }]}>{x.material.sizeMm ? `${x.material.sizeMm[0]}×${x.material.sizeMm[1]} mm` : '—'}</Text>
              <Text style={[s.cell, { width: COLS[4].w }]}>{x.widthMm}×{x.heightMm} mm</Text>
              <Text style={[s.cell, { width: COLS[5].w }]}>{describeApplication(x.application)}</Text>
            </View>
          ))}
        </View>
        {details.quantities && details.quantities.lines.length > 0 && (
          <View style={[s.table, { marginTop: 8 }]} wrap={false}>
            <View style={[s.row, s.head]}>
              <Text style={[s.cell, { width: '24%' }]}>Material</Text>
              <Text style={[s.cell, { width: '26%' }]}>Surfaces</Text>
              <Text style={[s.cell, { width: '10%' }]}>Area</Text>
              <Text style={[s.cell, { width: '28%' }]}>Order quantity</Text>
              <Text style={[s.cell, { width: '12%' }]}>Amount</Text>
            </View>
            {details.quantities.lines.map((q, i) => (
              <View key={i} style={s.row}>
                <Text style={[s.cell, { width: '24%' }]}>{q.material}{q.code ? ` (${q.code})` : ''}</Text>
                <Text style={[s.cell, { width: '26%' }]}>{q.surfaces.join(', ')}</Text>
                <Text style={[s.cell, { width: '10%' }]}>{q.areaSqft.toLocaleString('en-IN')} sq ft</Text>
                <Text style={[s.cell, { width: '28%' }]}>{q.quantity} — {q.basis}</Text>
                <Text style={[s.cell, { width: '12%' }]}>{q.amount != null ? `Rs. ${q.amount.toLocaleString('en-IN')}` : '—'}</Text>
              </View>
            ))}
            <View style={[s.row, s.head, { borderBottomWidth: 0 }]}>
              <Text style={[s.cell, { width: '88%' }]}>Estimated material cost{details.quantities.unpriced ? ` (${details.quantities.unpriced} not priced)` : ''}</Text>
              <Text style={[s.cell, { width: '12%' }]}>Rs. {details.quantities.total.toLocaleString('en-IN')}</Text>
            </View>
          </View>
        )}
        {details.notes ? <Text style={[s.foot, { color: C.text }]}>Notes: {details.notes}</Text> : null}
        <Text style={s.foot}>
          Integrity check ({verification.verifiedBy}): {verification.ok ? 'PASSED' : 'FAILED'} — {verification.protectedPixels.toLocaleString()} pixels outside the edited
          surfaces are byte-identical to the original render; {verification.editablePixels.toLocaleString()} pixels were eligible for editing.
          Visualization only: lighting on new materials is estimated from the original render, glossy reflections are approximate, and on-screen
          colours depend on the sample photo and display calibration. Confirm finishes against physical samples before ordering.
        </Text>
      </Page>
    </Document>
  )
}
