import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'
import type { Report } from '@/lib/interior/types'

// Validation report (plan §2.2): checked dimensions, unresolved issues, assumptions,
// designer decisions, approvals and source revisions for one exact scene revision.

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#1f2937' },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  muted: { color: '#6b7280' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 2 },
  th: { fontFamily: 'Helvetica-Bold' },
  banner: { padding: 6, marginTop: 6, borderRadius: 3 },
})

const OUT: Record<string, string> = { pass: '#047857', fail: '#b91c1c', missing: '#b45309', accepted: '#6d28d9', warning: '#b45309' }

function ReportDoc({ r }: { r: Report }) {
  const v = r.validation
  const final = r.approvals.find((a) => a.mode === 'final' && a.sceneHash === r.revision.sceneHash)
  const draftAppr = r.approvals.find((a) => a.mode === 'draft' && a.sceneHash === r.revision.sceneHash)
  const label = final ? 'APPROVED — FINAL' : draftAppr ? 'DRAFT — provisional values present' : 'NOT APPROVED'
  return (
    <Document title={`${r.workspace.name} R${r.revision.revisionNo} validation`}>
      <Page size="A4" style={s.page} wrap>
        <Text style={s.h1}>{r.workspace.name} — Validation report</Text>
        <Text style={s.muted}>
          Revision R{r.revision.revisionNo} · scene {r.revision.sceneHash ?? 'not frozen'} · {r.revision.status} · schema {r.revision.schemaVersion}
        </Text>
        <Text style={s.muted}>
          Policy: {r.workspace.mode} · interpretation model {r.model.name} ({r.model.reasoningEffort}) · generated {new Date().toISOString()}
        </Text>
        <View style={[s.banner, { backgroundColor: final ? '#d1fae5' : '#fef3c7' }]}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{label}</Text>
          {final && <Text>Approved {new Date(final.approvedAt).toLocaleString()} · validation run {final.validationRunId}{final.note ? ` · ${final.note}` : ''}</Text>}
        </View>
        <Text style={{ marginTop: 6 }}>
          Dimensional fidelity, design completeness and visual quality are reported separately. A pass means the model matches the approved source evidence within the stated tolerance; it is
          not a construction tolerance.
        </Text>

        {v && (
          <>
            <Text style={s.h2}>
              Checks ({v.summary.checksPassed}/{v.summary.checksTotal} passed · {v.summary.blocking} blocking · {v.summary.warnings} warnings)
            </Text>
            <View style={[s.row, s.th]}>
              <Text style={{ width: '46%' }}>Check</Text>
              <Text style={{ width: '18%' }}>Expected</Text>
              <Text style={{ width: '18%' }}>Observed</Text>
              <Text style={{ width: '18%' }}>Outcome</Text>
            </View>
            {v.checks.map((c) => (
              <View key={c.id} style={s.row} wrap={false}>
                <Text style={{ width: '46%' }}>
                  [{c.category}] {c.label}
                </Text>
                <Text style={{ width: '18%' }}>{String(c.expected ?? '—')}</Text>
                <Text style={{ width: '18%' }}>{String(c.observed ?? '—')}</Text>
                <Text style={{ width: '18%', color: OUT[c.outcome] }}>{c.outcome}</Text>
              </View>
            ))}
            <Text style={s.h2}>Open issues</Text>
            {v.issues.filter((i) => i.severity !== 'info').length === 0 && <Text style={s.muted}>None.</Text>}
            {v.issues
              .filter((i) => i.severity !== 'info')
              .map((i) => (
                <Text key={i.id} style={{ marginBottom: 2 }}>
                  [{i.severity.toUpperCase()}] {i.code}: {i.message}
                </Text>
              ))}
          </>
        )}

        <Text style={s.h2}>Provisional assumptions (not from drawings)</Text>
        {r.assumptions.length === 0 && <Text style={s.muted}>None.</Text>}
        {r.assumptions.map((a) => (
          <Text key={a.id}>
            {a.property} = {a.value} {a.unit} for {a.objectIds.length} object(s) — {a.reason}
            {a.blockingInStrict ? ' (blocks final)' : ''}
          </Text>
        ))}

        <Text style={s.h2}>Unsupported or omitted content</Text>
        {r.unsupported.length === 0 && <Text style={s.muted}>None.</Text>}
        {r.unsupported.map((u) => (
          <Text key={u.id}>• {u.message}</Text>
        ))}

        <Text style={s.h2}>Source drawings and scale</Text>
        {r.sources.map((src) => (
          <Text key={src.pageId}>
            {src.documentName} p{src.pageIndex + 1} · {src.role} · {src.calibration.mmPerPx ? `${src.calibration.mmPerPx.toFixed(4)} mm/px` : 'no scale'} ({src.calibration.method}, {src.calibration.status}, units{' '}
            {src.calibration.units}/{src.calibration.unitsSource})
          </Text>
        ))}
        {r.registrations
          .filter((g) => g.method !== 'reference')
          .map((g) => (
            <Text key={g.pageId} style={s.muted}>
              Alignment {r.sources.find((x) => x.pageId === g.pageId)?.documentName ?? g.pageId}: {g.method}, offset ({Math.round(g.offsetMm.x)}, {Math.round(g.offsetMm.y)}) mm, residual{' '}
              {g.residualMm === null ? 'unknown' : `${Math.round(g.residualMm)} mm`}, {g.status}
            </Text>
          ))}

        <Text style={s.h2}>Designer decisions</Text>
        {r.decisions.length === 0 && <Text style={s.muted}>None.</Text>}
        {r.decisions.map((d) => (
          <Text key={d.id}>
            {new Date(d.createdAt).toLocaleString()} · {d.kind}
            {d.rationale ? ` · ${d.rationale}` : ''}
          </Text>
        ))}
        {r.acceptances.length > 0 && (
          <>
            <Text style={s.h2}>Accepted deviations / acknowledgements</Text>
            {r.acceptances.map((a) => (
              <Text key={a.key}>
                {a.key} — {a.rationale}
              </Text>
            ))}
          </>
        )}
        <Text style={s.h2}>Build log</Text>
        {r.buildLog.map((l, i) => (
          <Text key={i} style={s.muted}>
            {l}
          </Text>
        ))}
      </Page>
    </Document>
  )
}

export async function renderReportPdf(r: Report): Promise<Blob> {
  return pdf(<ReportDoc r={r} />).toBlob()
}
