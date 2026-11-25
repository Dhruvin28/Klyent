import { dot, pointInPolygon, projectToSegment, wallLeftNormal, wallLength, type Vec2 } from '../designer/geometry'
import type { Anchor, Check, Constraint, Issue, Question, SceneDoc, Severity, ValidationResult } from './contracts'
import { roomFace } from './build/roomFace'

// Validation and fidelity gates (plan §15). Dimensional fidelity, completeness and
// visual quality are reported separately; there is no single "accuracy %".

export interface ValidationPolicy {
  mode: 'strict' | 'draft'
}

const r1 = (v: number) => Math.round(v * 10) / 10

function anchorCoord(scene: SceneDoc, a: Anchor, dir: Vec2): number | null {
  const plan = scene.plan
  if (a.kind === 'wall_face') {
    const w = plan.walls.find((x) => x.id === a.wallId)
    if (!w) return null
    const n = wallLeftNormal(w)
    return dot({ x: w.a.x + n.x * a.offset, y: w.a.y + n.y * a.offset }, dir)
  }
  const o = plan.openings.find((x) => x.id === a.openingId)
  const w = o && plan.walls.find((x) => x.id === o.wallId)
  if (!o || !w) return null
  const L = wallLength(w)
  const t = a.edge === 'start' ? o.offset - o.width / 2 : o.offset + o.width / 2
  return dot({ x: w.a.x + ((w.b.x - w.a.x) / L) * t, y: w.a.y + ((w.b.y - w.a.y) / L) * t }, dir)
}

/** Current model value for a constraint, or null when its objects no longer exist. */
export function measureConstraint(scene: SceneDoc, c: Constraint): number | null {
  const plan = scene.plan
  const r = c.refs
  switch (r.kind) {
    case 'distance': {
      const a = anchorCoord(scene, r.a, r.dir)
      const b = anchorCoord(scene, r.b, r.dir)
      return a === null || b === null ? null : Math.abs(b - a)
    }
    case 'opening_width':
      return plan.openings.find((o) => o.id === r.openingId)?.width ?? null
    case 'item_size': {
      const it = plan.items.find((i) => i.id === r.itemId)
      return it ? it[r.dim] : null
    }
    case 'ceiling_height':
      return plan.wallHeight
    case 'ceiling_level':
      return plan.ceilings?.find((z) => z.id === r.ceilingId)?.level ?? null
    case 'fixture_count':
      return (plan.fixtures ?? []).filter((f) => scene.objectSources[f.id]?.some((s) => s.pageId === r.pageId)).length
    case 'elevation_width': {
      const room = plan.rooms.find((x) => x.id === r.roomId)
      const face = room ? roomFace(room, plan.walls, r.side) : null
      return face ? face.length : null
    }
  }
}

function objectIdsOf(c: Constraint): string[] {
  const r = c.refs
  switch (r.kind) {
    case 'distance':
      return [r.a, r.b].map((a) => (a.kind === 'wall_face' ? a.wallId : a.openingId))
    case 'opening_width':
      return [r.openingId]
    case 'item_size':
      return [r.itemId]
    case 'ceiling_level':
      return [r.ceilingId]
    case 'elevation_width':
      return [r.roomId]
    default:
      return []
  }
}

function fixQuestion(c: Constraint): Question | undefined {
  const r = c.refs
  const options = [{ value: 'accept', label: 'Keep the model as drawn and record the deviation' }]
  if (r.kind === 'item_size') {
    return { kind: 'choice', label: `Use the written ${r.dim} (${r1(c.expected)} mm)?`, options: [{ value: 'apply', label: `Set ${r.dim} to ${r1(c.expected)} mm` }, ...options], command: { type: 'set_items', itemIds: [r.itemId], [r.dim]: c.expected } }
  }
  if (r.kind === 'opening_width') {
    return { kind: 'choice', label: `Use the dimensioned width (${r1(c.expected)} mm)?`, options: [{ value: 'apply', label: `Set width to ${r1(c.expected)} mm` }, ...options], command: { type: 'set_openings', openingIds: [r.openingId], width: c.expected } }
  }
  if (r.kind === 'ceiling_height') {
    return { kind: 'choice', label: `Use ${r1(c.expected)} mm as the ceiling height?`, options: [{ value: 'apply', label: `Set ceiling height to ${r1(c.expected)} mm` }, ...options], command: { type: 'set_wall_height', value: c.expected } }
  }
  if (r.kind === 'ceiling_level') {
    return { kind: 'choice', label: `Use level ${r1(c.expected)} mm?`, options: [{ value: 'apply', label: `Set level to ${r1(c.expected)} mm` }, ...options], command: { type: 'set_ceiling_level', ceilingId: r.ceilingId, level: c.expected } }
  }
  return { kind: 'choice', label: 'Correct the wall positions in the designer and sync, or record the deviation.', options, command: { type: 'accept' } }
}

const ASSUMPTION_COMMAND: Record<string, (ids: string[], v: number) => Record<string, unknown>> = {
  door_height: (ids) => ({ type: 'set_openings', openingIds: ids, height: 0 }),
  window_height: (ids) => ({ type: 'set_openings', openingIds: ids, height: 0 }),
  opening_height: (ids) => ({ type: 'set_openings', openingIds: ids, height: 0 }),
  window_sill: (ids) => ({ type: 'set_openings', openingIds: ids, sill: 0 }),
  joinery_height: (ids) => ({ type: 'set_items', itemIds: ids, height: 0 }),
  furniture_height: (ids) => ({ type: 'set_items', itemIds: ids, height: 0 }),
  joinery_depth: (ids) => ({ type: 'set_items', itemIds: ids, depth: 0 }),
  ceiling_height: () => ({ type: 'set_wall_height', value: 0 }),
  ceiling_level: (ids) => ({ type: 'set_ceiling_level', ceilingId: ids[0], level: 0 }),
  panel_depth: (ids) => ({ type: 'set_panels', panelIds: ids, depth: 0 }),
  wall_light_height: (ids) => ({ type: 'set_fixtures', fixtureIds: ids, mount: 0 }),
  light_cct: (ids) => ({ type: 'set_fixtures', fixtureIds: ids, kelvin: 0 }),
}

export function validateScene(scene: SceneDoc, policy: ValidationPolicy): ValidationResult {
  const strict = policy.mode === 'strict'
  const issues: Issue[] = []
  const checks: Check[] = []
  const plan = scene.plan
  const accepted = new Set(scene.acceptances.map((a) => a.key))
  const sev = (blockingInStrict: boolean): Severity => (strict && blockingInStrict ? 'blocking' : 'warning')
  const add = (i: Issue) => {
    if (i.acceptKey && accepted.has(i.acceptKey)) i.severity = 'info'
    issues.push(i)
  }

  // ── Units and scale per source sheet ──
  for (const src of scene.sources) {
    if (!src.interpretation) continue
    const c = src.calibration
    const relevant = src.role !== 'schedule' && src.role !== 'other' && src.role !== 'detail'
    if (!relevant) continue
    const label = `${src.documentName} p${src.pageIndex + 1}`
    if (!c.mmPerPx) {
      add({ id: `MISSING_SCALE:${src.pageId}`, code: 'MISSING_SCALE', severity: src.pageId === scene.referencePageId || strict ? 'blocking' : 'warning', message: `${label}: no scale could be established. Calibrate it with a known dimension.`, objectIds: [], pageId: src.pageId })
      checks.push({ id: `units:${src.pageId}`, category: 'units', label: `Scale — ${label}`, expected: 'calibrated', observed: 'missing', outcome: 'missing', objectIds: [] })
      continue
    }
    checks.push({
      id: `units:${src.pageId}`,
      category: 'units',
      label: `Scale — ${label}`,
      expected: 'verified',
      observed: `${c.method}, ${c.status}${c.spread !== null ? `, spread ${(c.spread * 100).toFixed(2)}%` : ''}`,
      outcome: c.status === 'verified' ? 'pass' : 'warning',
      objectIds: [],
    })
    if (c.unitsSource === 'inferred' && !accepted.has(`units:${src.pageId}`)) {
      add({
        id: `UNITS_UNCONFIRMED:${src.pageId}`,
        code: 'UNITS_UNCONFIRMED',
        severity: sev(true),
        message: `${label}: drawing units were inferred as ${c.units}. Confirm them.`,
        objectIds: [],
        pageId: src.pageId,
        question: { kind: 'choice', label: 'Drawing units for unitless dimensions', options: ['mm', 'cm', 'm', 'ft_in'].map((u) => ({ value: u, label: u === 'ft_in' ? 'feet / inches' : u })), defaultValue: c.units, command: { type: 'set_page_units', pageId: src.pageId, units: '' } },
      })
    }
    if (c.status === 'provisional') {
      add({ id: `SCALE_PROVISIONAL:${src.pageId}`, code: 'SCALE_PROVISIONAL', severity: c.method === 'scale_note' ? sev(true) : 'warning', message: `${label}: scale is provisional (${c.notes.join(' ') || 'too few consistent dimensions'}).`, objectIds: [], pageId: src.pageId, acceptKey: c.method === 'scale_note' ? undefined : `scale:${src.pageId}` })
    }
    for (const s of c.samples.filter((x) => !x.inlier)) {
      add({ id: `SCALE_OUTLIER:${src.pageId}:${s.textId ?? s.text}`, code: 'SCALE_OUTLIER', severity: 'info', message: `${label}: “${s.text}” does not match its drawn length (${r1(s.px * c.mmPerPx)} mm drawn). It may be not-to-scale or overridden.`, objectIds: [], pageId: src.pageId, expected: r1(s.mm), observed: r1(s.px * c.mmPerPx) })
    }
  }
  if (!plan.walls.length) {
    add({ id: 'NO_GEOMETRY', code: 'NO_GEOMETRY', severity: 'blocking', message: 'No walls were reconstructed. Check that a floor plan is uploaded, classified and calibrated.', objectIds: [] })
  }

  // ── Registration ──
  for (const r of scene.registrations) {
    if (r.method === 'reference') continue
    const src = scene.sources.find((s) => s.pageId === r.pageId)
    const label = src ? `${src.documentName} p${src.pageIndex + 1}` : r.pageId
    const outcome: Check['outcome'] = r.status === 'verified' ? 'pass' : r.status === 'failed' ? 'fail' : 'warning'
    checks.push({ id: `reg:${r.pageId}`, category: 'registration', label: `Alignment — ${label}`, expected: '≤ 50 mm residual', observed: r.residualMm === null ? r.method : `${r1(r.residualMm)} mm (${r.method}, ${r.anchors} anchors)`, outcome, objectIds: [] })
    if (r.status === 'failed') add({ id: `REGISTRATION_FAILED:${r.pageId}`, code: 'REGISTRATION_FAILED', severity: sev(true), message: `${label} could not be aligned to the reference plan; its ceilings/lights/furniture are excluded. Set its offset manually.`, objectIds: [], pageId: r.pageId })
    else if (r.status === 'unverified') add({ id: `REGISTRATION_UNVERIFIED:${r.pageId}`, code: 'REGISTRATION_UNVERIFIED', severity: r.residualMm !== null && r.residualMm > 100 ? sev(true) : 'warning', message: `${label} alignment is unverified${r.residualMm !== null ? ` (residual ${r1(r.residualMm)} mm)` : ''}. Review the overlay.`, objectIds: [], pageId: r.pageId, acceptKey: `reg:${r.pageId}` })
  }

  // ── Dimensional constraints ──
  for (const c of scene.constraints) {
    const observed = measureConstraint(scene, c)
    const ids = objectIdsOf(c)
    const cat: Check['category'] =
      c.refs.kind === 'distance' ? 'walls' : c.refs.kind === 'opening_width' ? 'openings' : c.refs.kind === 'item_size' ? 'furniture' : c.refs.kind === 'fixture_count' ? 'lighting' : c.refs.kind === 'elevation_width' ? 'walls' : 'ceiling'
    const key = `constraint:${c.id}`
    if (observed === null) {
      checks.push({ id: c.id, category: cat, label: c.label, expected: c.expected, observed: null, outcome: accepted.has(key) ? 'accepted' : 'missing', objectIds: ids })
      add({ id: `CONSTRAINT_ORPHANED:${c.id}`, code: 'CONSTRAINT_ORPHANED', severity: sev(true), message: `${c.label}: the object it applies to was removed.`, objectIds: ids, pageId: c.source.pageId, region: c.source.region ?? null, acceptKey: key, question: { kind: 'confirm', label: 'Confirm the removal is intended', command: { type: 'accept' } } })
      continue
    }
    const dev = observed - c.expected
    const ok = Math.abs(dev) <= c.tolerance
    const unit = c.unit === 'count' ? '' : ' mm'
    checks.push({ id: c.id, category: cat, label: c.label, expected: c.unit === 'count' ? c.expected : r1(c.expected), observed: c.unit === 'count' ? observed : r1(observed), outcome: ok ? 'pass' : accepted.has(key) ? 'accepted' : 'fail', objectIds: ids })
    if (ok) continue
    const code = c.refs.kind === 'fixture_count' ? (dev < 0 ? 'FIXTURE_OMITTED' : 'FIXTURE_EXTRA') : 'DIMENSION_CONFLICT'
    add({
      id: `${code}:${c.id}`,
      code,
      severity: sev(true),
      message: `${c.label}: drawing says ${c.unit === 'count' ? c.expected : r1(c.expected)}${unit}, model has ${c.unit === 'count' ? observed : r1(observed)}${unit} (Δ ${dev > 0 ? '+' : ''}${c.unit === 'count' ? dev : r1(dev)}${unit}, tolerance ±${r1(c.tolerance)}${unit}).`,
      objectIds: ids,
      pageId: c.source.pageId,
      region: c.source.region ?? null,
      expected: c.expected,
      observed,
      deviation: dev,
      acceptKey: key,
      question: fixQuestion(c),
    })
  }

  // ── Completeness: assumptions instead of evidence ──
  for (const a of scene.assumptions) {
    const key = `assumption:${a.id}`
    const make = ASSUMPTION_COMMAND[a.group]
    checks.push({ id: key, category: 'completeness', label: `${a.reason} (${a.objectIds.length} object${a.objectIds.length === 1 ? '' : 's'})`, expected: 'from drawings or designer', observed: `assumed ${a.value} ${a.unit}`, outcome: accepted.has(key) ? 'accepted' : 'missing', objectIds: a.objectIds })
    add({
      id: `ASSUMED_VALUE:${a.id}`,
      code: 'ASSUMED_VALUE',
      severity: a.blockingInStrict ? sev(true) : 'warning',
      message: `${a.reason}. A provisional ${a.property} of ${a.value} ${a.unit} is used for ${a.objectIds.length} object${a.objectIds.length === 1 ? '' : 's'}.`,
      objectIds: a.objectIds,
      acceptKey: key,
      question: make ? { kind: 'number', label: `${a.reason} — enter the ${a.property}`, unit: a.unit === 'mm' ? 'mm' : undefined, defaultValue: a.value, command: make(a.objectIds, a.value) } : undefined,
    })
  }

  // ── Unsupported / omitted content is always disclosed ──
  for (const u of scene.unsupported) {
    const blocking = u.kind === 'elevation_unassigned' || u.kind === 'opening_without_wall'
    add({ id: `UNSUPPORTED:${u.id}`, code: u.kind.toUpperCase(), severity: blocking ? sev(true) : 'warning', message: u.message, objectIds: [], pageId: u.pageId, region: u.region ?? null, acceptKey: `issue:${u.id}` })
  }

  // ── Geometry sanity ──
  for (const w of plan.walls) {
    if (wallLength(w) < 10) add({ id: `WALL_DEGENERATE:${w.id}`, code: 'WALL_DEGENERATE', severity: 'blocking', message: 'A wall is shorter than 10 mm.', objectIds: [w.id] })
    if (w.thickness < 30 || w.thickness > 1000) add({ id: `WALL_THICKNESS:${w.id}`, code: 'WALL_THICKNESS', severity: 'warning', message: `Wall thickness ${r1(w.thickness)} mm is unusual.`, objectIds: [w.id], acceptKey: `issue:WALL_THICKNESS:${w.id}` })
  }
  for (let i = 0; i < plan.walls.length; i++) {
    for (let j = i + 1; j < plan.walls.length; j++) {
      const a = plan.walls[i]
      const b = plan.walls[j]
      const da = { x: (a.b.x - a.a.x) / (wallLength(a) || 1), y: (a.b.y - a.a.y) / (wallLength(a) || 1) }
      const db = { x: (b.b.x - b.a.x) / (wallLength(b) || 1), y: (b.b.y - b.a.y) / (wallLength(b) || 1) }
      if (Math.abs(dot(da, db)) < 0.999) continue
      const mid = { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 }
      const pr = projectToSegment(mid, a.a, a.b)
      if (pr.distance < Math.max(a.thickness, b.thickness) / 2 && pr.t > 0.02 && pr.t < 0.98) {
        add({ id: `WALL_OVERLAP:${a.id}:${b.id}`, code: 'WALL_OVERLAP', severity: 'warning', message: 'Two walls overlap; one may be a duplicate detection.', objectIds: [a.id, b.id], acceptKey: `issue:WALL_OVERLAP:${a.id}:${b.id}` })
      }
    }
  }
  const byWall = new Map<string, typeof plan.openings>()
  for (const o of plan.openings) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o])
  for (const [wallId, ops] of byWall) {
    const w = plan.walls.find((x) => x.id === wallId)
    if (!w) {
      ops.forEach((o) => add({ id: `OPENING_ORPHAN:${o.id}`, code: 'OPENING_ORPHAN', severity: 'blocking', message: 'An opening refers to a wall that no longer exists.', objectIds: [o.id] }))
      continue
    }
    const L = wallLength(w)
    for (const o of ops) {
      if (o.width > L - 20 + 0.5) add({ id: `OPENING_TOO_WIDE:${o.id}`, code: 'OPENING_TOO_WIDE', severity: 'blocking', message: `${o.type} (${r1(o.width)} mm) does not fit its wall (${r1(L)} mm).`, objectIds: [o.id] })
      if (o.sill + o.height > plan.wallHeight + 0.5) add({ id: `OPENING_TOO_TALL:${o.id}`, code: 'OPENING_TOO_TALL', severity: sev(true), message: `${o.type} head (${r1(o.sill + o.height)} mm) is above the ceiling (${plan.wallHeight} mm).`, objectIds: [o.id], acceptKey: `issue:OPENING_TOO_TALL:${o.id}` })
    }
    const sorted = [...ops].sort((a, b) => a.offset - b.offset)
    for (let k = 1; k < sorted.length; k++) {
      if (sorted[k].offset - sorted[k].width / 2 < sorted[k - 1].offset + sorted[k - 1].width / 2 - 1) {
        add({ id: `OPENING_OVERLAP:${sorted[k - 1].id}:${sorted[k].id}`, code: 'OPENING_OVERLAP', severity: 'warning', message: 'Two openings overlap on the same wall.', objectIds: [sorted[k - 1].id, sorted[k].id], acceptKey: `issue:OPENING_OVERLAP:${sorted[k - 1].id}:${sorted[k].id}` })
      }
    }
  }
  for (const it of plan.items) {
    if (plan.rooms.length && !plan.rooms.some((r) => pointInPolygon(it, r.points))) {
      add({ id: `ITEM_OUTSIDE:${it.id}`, code: 'ITEM_OUTSIDE', severity: 'warning', message: `“${it.name}” is outside every room.`, objectIds: [it.id], acceptKey: `issue:ITEM_OUTSIDE:${it.id}` })
    }
    // Footprint corners inside a wall body → clash.
    const rad = (it.rotation * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sy]) => ({ x: it.x + ((sx * it.width) / 2) * c - ((sy * it.depth) / 2) * s, y: it.y + ((sx * it.width) / 2) * s + ((sy * it.depth) / 2) * c }))
    const clash = plan.walls.find((w) => corners.some((p) => projectToSegment(p, w.a, w.b).distance < w.thickness / 2 - 15))
    if (clash && it.elevation < (clash.height ?? plan.wallHeight)) {
      add({ id: `ITEM_WALL_CLASH:${it.id}`, code: 'ITEM_WALL_CLASH', severity: 'warning', message: `“${it.name}” intersects a wall by more than 15 mm.`, objectIds: [it.id, clash.id], acceptKey: `issue:ITEM_WALL_CLASH:${it.id}` })
    }
  }
  for (const z of plan.ceilings ?? []) {
    if (z.level > plan.wallHeight) add({ id: `CEILING_ABOVE:${z.id}`, code: 'CEILING_LEVEL_INVALID', severity: 'blocking', message: `${z.name} level ${z.level} mm is above the ceiling height ${plan.wallHeight} mm.`, objectIds: [z.id] })
    for (const o of plan.openings) {
      const w = plan.walls.find((x) => x.id === o.wallId)
      if (!w) continue
      const L = wallLength(w)
      const p = { x: w.a.x + ((w.b.x - w.a.x) / L) * o.offset, y: w.a.y + ((w.b.y - w.a.y) / L) * o.offset }
      const near = z.outer.some((q, i) => projectToSegment(p, q, z.outer[(i + 1) % z.outer.length]).distance < w.thickness)
      if (near && o.sill + o.height > z.level + 0.5) {
        add({ id: `CEILING_OPENING_CLASH:${z.id}:${o.id}`, code: 'CEILING_OPENING_CLASH', severity: sev(true), message: `${z.name} (level ${z.level} mm) cuts through a ${o.type} head at ${r1(o.sill + o.height)} mm.`, objectIds: [z.id, o.id], acceptKey: `issue:CEILING_OPENING_CLASH:${z.id}:${o.id}` })
      }
    }
  }

  // ── Model review prompts ──
  if (scene.review.length) {
    add({ id: 'LOW_CONFIDENCE', code: 'LOW_CONFIDENCE', severity: 'warning', message: `${scene.review.length} detection(s) are uncertain. Review them against the source before approval.`, objectIds: scene.review.map((r) => r.objectId), acceptKey: 'issue:LOW_CONFIDENCE' })
  }
  for (const [k, ai] of scene.aiIssues.entries()) {
    add({ id: `AI_NOTE:${ai.pageId}:${k}`, code: `SOURCE_${ai.kind.toUpperCase()}`, severity: ai.kind === 'conflict' ? sev(true) : 'warning', message: ai.message, objectIds: [], pageId: ai.pageId, region: ai.region, acceptKey: `issue:AI_NOTE:${ai.pageId}:${k}` })
  }

  checks.push({ id: 'count:walls', category: 'geometry', label: 'Walls reconstructed', expected: null, observed: plan.walls.length, outcome: plan.walls.length ? 'pass' : 'fail', objectIds: [] })
  checks.push({ id: 'count:rooms', category: 'geometry', label: 'Enclosed rooms', expected: null, observed: plan.rooms.length, outcome: plan.rooms.length ? 'pass' : 'warning', objectIds: [] })
  if (plan.panels?.length) checks.push({ id: 'count:panels', category: 'paneling', label: 'Panel runs from elevations', expected: null, observed: plan.panels.length, outcome: 'pass', objectIds: plan.panels.map((p) => p.id) })

  const blocking = issues.filter((i) => i.severity === 'blocking').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  return {
    status: blocking ? 'blocked' : warnings ? 'passed_with_warnings' : 'passed',
    checks,
    issues: issues.sort((a, b) => rank(a.severity) - rank(b.severity)),
    summary: { blocking, warnings, info: issues.length - blocking - warnings, checksPassed: checks.filter((c) => c.outcome === 'pass' || c.outcome === 'accepted').length, checksTotal: checks.length },
  }
}

function rank(s: Severity) {
  return s === 'blocking' ? 0 : s === 'warning' ? 1 : 2
}

