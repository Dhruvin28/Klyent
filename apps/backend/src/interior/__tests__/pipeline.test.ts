import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadMupdf, readSegments } from '../extract/common'
import { extractPdf } from '../extract/pdf'
import { compileScene, type CompilePage } from '../build/compile'
import { prepareInterpretation } from '../geometry/prepare'
import { validateScene } from '../validate'
import { buildCameras } from '../build/views'
import { roomInnerPolygon } from '../../designer/geometry'
import type { PageInterpretation } from '../contracts'

// A 1:50 vector "CAD export" of one bedroom: 4000 × 3000 clear, 115 mm walls.
const K = (1 / 50) * (72 / 25.4) // pt per mm at 1:50
const O = { x: 60, y: 60 } // page offset, pt (top-down)
const PAGE = { w: 400, h: 340 }
const pt = (x: number, y: number) => ({ x: O.x + x * K, y: O.y + y * K })

async function makePdf(): Promise<Buffer> {
  const mupdf = await loadMupdf()
  const doc = new mupdf.PDFDocument()
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'))
  const res = doc.addObject({ Font: { F1: font } })
  const ops: string[] = ['0 0 0 RG 0.35 w']
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const a = pt(x1, y1)
    const b = pt(x2, y2)
    ops.push(`${a.x.toFixed(3)} ${(PAGE.h - a.y).toFixed(3)} m ${b.x.toFixed(3)} ${(PAGE.h - b.y).toFixed(3)} l S`)
  }
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    line(x0, y0, x1, y0)
    line(x1, y0, x1, y1)
    line(x1, y1, x0, y1)
    line(x0, y1, x0, y0)
  }
  rect(-57.5, -57.5, 4172.5, 3172.5) // outer faces
  rect(57.5, 57.5, 4057.5, 3057.5) // inner faces
  rect(2100, 57.5, 3900, 657.5) // wardrobe 1800 x 600 against the top wall
  line(1550, 3115 - 57.5, 1550, 3115 + 57.5) // door jambs (900 clear)
  line(2450, 3115 - 57.5, 2450, 3115 + 57.5)
  // Dimension chains: extension lines + dimension lines.
  const hdim = (x0: number, x1: number, y: number) => {
    line(x0, y - 100, x0, y + 100)
    line(x1, y - 100, x1, y + 100)
    line(x0, y, x1, y)
  }
  const vdim = (y0: number, y1: number, x: number) => {
    line(x - 100, y0, x + 100, y0)
    line(x - 100, y1, x + 100, y1)
    line(x, y0, x, y1)
  }
  hdim(57.5, 4057.5, -300)
  hdim(-57.5, 4172.5, -600)
  vdim(57.5, 3057.5, -300)
  const text = (s: string, x: number, y: number, size = 7) => {
    const p = pt(x, y)
    ops.push(`BT /F1 ${size} Tf ${p.x.toFixed(2)} ${(PAGE.h - p.y).toFixed(2)} Td (${s}) Tj ET`)
  }
  text('4000', 1900, -360)
  text('4230', 1900, -660)
  text('3000', -900, 1500)
  text('BEDROOM', 1700, 1500, 9)
  text('ALL DIMENSIONS ARE IN MM', 0, 3700, 6)
  const page = doc.addPage([0, 0, PAGE.w, PAGE.h], 0, res, ops.join('\n'))
  doc.insertPage(-1, page)
  return Buffer.from(doc.saveToBuffer('').asUint8Array())
}

test('vector PDF → snapped walls, verified scale, passing dimension constraints', async () => {
  const [page] = await extractPdf(await makePdf())
  assert.equal(page.extraction.source, 'pdf_vector')
  assert.equal(page.extraction.unitsFromNotes, 'mm')
  const s = page.extraction.pdf!.pxPerPt
  const px = (x: number, y: number) => {
    const p = pt(x, y)
    return { x: p.x * s, y: p.y * s }
  }
  const tok = (t: string) => page.extraction.texts.find((x) => x.text === t)?.id ?? null
  assert.ok(tok('4000') && tok('3000') && tok('4230') && tok('BEDROOM'), 'dimension text extracted with ids')

  // Simulated model output: centrelines/dimension ends off by a few px, thickness rough.
  const jitter = (p: { x: number; y: number }, dx: number, dy: number) => ({ x: p.x + dx, y: p.y + dy })
  const tPx = 115 * K * s
  const it: PageInterpretation = {
    sheet: { kind: 'floor_plan', title: 'Bedroom plan', scaleNote: '1:50', unitsHint: 'unknown', notes: [] },
    walls: [
      { id: 'w1', a: jitter(px(0, 0), 2, -3), b: jitter(px(4115, 0), -2, 2), thicknessPx: tPx * 1.3, kind: 'exterior', confidence: 0.9 },
      { id: 'w2', a: jitter(px(4115, 0), 3, 1), b: jitter(px(4115, 3115), 2, -2), thicknessPx: tPx * 0.8, kind: 'exterior', confidence: 0.9 },
      { id: 'w3', a: jitter(px(4115, 3115), -1, 3), b: jitter(px(0, 3115), 2, 2), thicknessPx: tPx, kind: 'exterior', confidence: 0.9 },
      { id: 'w4', a: jitter(px(0, 3115), -3, 0), b: jitter(px(0, 0), -2, 2), thicknessPx: tPx, kind: 'exterior', confidence: 0.9 },
    ],
    openings: [{ wallRef: 'w3', type: 'door', center: jitter(px(2000, 3115), 3, 1), widthPx: 900 * K * s + 4, swing: 'left', labelTextId: null, confidence: 0.9 }],
    rooms: [{ label: 'BEDROOM', polygon: [px(0, 0), px(4115, 0), px(4115, 3115), px(0, 3115)], labelTextId: tok('BEDROOM'), ceilingHeightTextId: null }],
    furniture: [{ label: 'Wardrobe', category: 'wardrobe', center: jitter(px(3000, 357.5), -3, 2), widthPx: 1800 * K * s * 1.004, depthPx: 600 * K * s * 0.99, rotationDeg: 180, sizeTextId: null, confidence: 0.8 }],
    dimensions: [
      { textId: tok('4000'), readText: '4000', p1: jitter(px(57.5, -300), 3, 0), p2: jitter(px(4057.5, -300), -3, 0), confidence: 0.9 },
      { textId: tok('4230'), readText: '4230', p1: jitter(px(-57.5, -600), -2, 0), p2: jitter(px(4172.5, -600), 3, 0), confidence: 0.9 },
      { textId: tok('3000'), readText: '3000', p1: jitter(px(-300, 57.5), 0, 3), p2: jitter(px(-300, 3057.5), 0, -2), confidence: 0.9 },
    ],
    ceilingZones: [],
    lights: [],
    elevation: null,
    sectionLevels: [],
    issues: [],
    rejectedRefs: [],
  }
  const vectors = page.vectors ? readSegments(page.vectors) : null
  const cp: CompilePage = {
    pageId: 'page-1',
    documentId: 'doc-1',
    documentName: 'bedroom.pdf',
    pageIndex: 0,
    role: 'floor_plan',
    title: 'Bedroom plan',
    extraction: page.extraction,
    interpretation: prepareInterpretation(it, vectors),
    interpretationMeta: { model: 'test', promptVersion: 'test' },
    calibrationOverride: null,
    assignment: null,
    registrationOverride: null,
    vectors,
    loadImage: async () => page.image,
  }
  const scene = await compileScene({ referencePageId: 'page-1', pages: [cp] })
  const cal = scene.sources[0].calibration
  assert.equal(cal.method, 'dimensions')
  assert.equal(cal.status, 'verified', `scale status ${cal.status}: ${cal.notes.join(' ')}`)
  assert.ok(Math.abs(cal.mmPerPx! - 1 / (K * s)) / (1 / (K * s)) < 0.0005, `scale ${cal.mmPerPx} vs ${1 / (K * s)}`)

  const plan = scene.plan
  assert.equal(plan.walls.length, 4)
  assert.equal(plan.rooms.length, 1)
  assert.equal(plan.rooms[0].name, 'BEDROOM')
  // Walls snapped onto the true centrelines and thickness.
  for (const w of plan.walls) assert.ok(Math.abs(w.thickness - 115) < 1, `thickness ${w.thickness}`)
  const inner = roomInnerPolygon(plan.rooms[0], plan.walls)
  const xs = inner.map((p) => p.x)
  const ys = inner.map((p) => p.y)
  const clearW = Math.max(...xs) - Math.min(...xs)
  const clearH = Math.max(...ys) - Math.min(...ys)
  assert.ok(Math.abs(clearW - 4000) <= 1.5, `clear width ${clearW}`)
  assert.ok(Math.abs(clearH - 3000) <= 1.5, `clear depth ${clearH}`)
  assert.equal(plan.openings.length, 1)
  assert.equal(plan.items.length, 1)
  // Door and wardrobe snapped onto their drawn jambs / outline despite jittered model output.
  assert.ok(Math.abs(plan.openings[0].width - 900) <= 0.5, `door width ${plan.openings[0].width}`)
  assert.ok(Math.abs(plan.items[0].width - 1800) <= 0.5 && Math.abs(plan.items[0].depth - 600) <= 0.5, `wardrobe ${plan.items[0].width}x${plan.items[0].depth}`)

  // All three dimensions became wall-face constraints and pass.
  const dist = scene.constraints.filter((c) => c.refs.kind === 'distance')
  assert.equal(dist.length, 3, `constraints: ${scene.constraints.map((c) => c.label).join(', ')}`)
  const v = validateScene(scene, { mode: 'strict' })
  const conflicts = v.issues.filter((i) => i.code === 'DIMENSION_CONFLICT')
  assert.equal(conflicts.length, 0, conflicts.map((c) => c.message).join('\n'))
  // Heights were not on the drawing: strict mode must block, never silently assume.
  assert.ok(v.issues.some((i) => i.code === 'ASSUMED_VALUE' && i.severity === 'blocking'))
  assert.equal(v.status, 'blocked')

  // A deliberately wrong wall position is caught.
  const moved = structuredClone(scene)
  const east = moved.plan.walls.find((w) => Math.abs(w.a.x - w.b.x) < 1 && w.a.x > 2000)!
  east.a.x += 40
  east.b.x += 40
  const v2 = validateScene(moved, { mode: 'strict' })
  assert.ok(v2.issues.some((i) => i.code === 'DIMENSION_CONFLICT'), 'moved wall must fail the 4000 / 4230 dimensions')

  // View package: 4 perspectives + 4 elevations + top + ceiling for the room, plus iso and plan top.
  const views = buildCameras(plan)
  assert.equal(views.filter((x) => x.group === 'perspective').length, 4)
  assert.equal(views.filter((x) => x.group === 'elevation').length, 4)
  assert.ok(views.some((x) => x.group === 'isometric'))
  assert.ok(views.some((x) => x.group === 'ceiling' && x.mirrorX))
})

test('raster scan of the same plan → walls refined from pixels', async () => {
  const [page] = await extractPdf(await makePdf())
  const s = page.extraction.pdf!.pxPerPt
  const px = (x: number, y: number) => {
    const p = pt(x, y)
    return { x: p.x * s, y: p.y * s }
  }
  const tPx = 115 * K * s
  const walls = [
    { id: 'w1', a: px(0, 0), b: px(4115, 0) },
    { id: 'w2', a: px(4115, 0), b: px(4115, 3115) },
    { id: 'w3', a: px(4115, 3115), b: px(0, 3115) },
    { id: 'w4', a: px(0, 3115), b: px(0, 0) },
  ].map((w, i) => ({ ...w, a: { x: w.a.x + (i % 2 ? 3 : -2), y: w.a.y + (i % 2 ? -2 : 3) }, b: { x: w.b.x + (i % 2 ? 3 : -2), y: w.b.y + (i % 2 ? -2 : 3) }, thicknessPx: tPx, kind: 'exterior' as const, confidence: 0.9 }))
  const { refineWalls, decodeGray } = await import('../geometry/refine')
  const out = refineWalls(walls, { index: null, gray: decodeGray(page.image) })
  assert.equal(out.length, 4)
  assert.ok(out.every((w) => w.method === 'raster'), out.map((w) => w.method).join(','))
  const mmPerPx = 1 / (K * s)
  // Raster precision is bounded by line rendering: within ~1 px (≈ 2.2 mm here).
  const top = out[0]
  assert.ok(Math.abs(top.a.y - px(0, 0).y) * mmPerPx < 2.5, `top wall off by ${(top.a.y - px(0, 0).y) * mmPerPx} mm`)
  assert.ok(Math.abs(top.thicknessPx * mmPerPx - 115) < 5, `thickness ${top.thicknessPx * mmPerPx}`)
})

test('DXF: units, blocks, mirrored inserts and CAD dimensions', async () => {
  const { parseDxf, extractDxf } = await import('../extract/dxf')
  const pairs = (...kv: (string | number)[]) => kv.map(String).join('\n')
  const dxf = [
    pairs(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC'),
    pairs(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 0, 'LAYER', 2, 'A-WALL', 70, 0, 62, 7, 0, 'LAYER', 2, 'HIDDEN', 70, 1, 62, 7, 0, 'ENDTAB', 0, 'ENDSEC'),
    pairs(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'CHAIR', 70, 0, 10, 0, 20, 0, 0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 500, 21, 0, 0, 'ENDBLK', 0, 'ENDSEC'),
    pairs(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LWPOLYLINE', 8, 'A-WALL', 90, 4, 70, 1, 10, 0, 20, 0, 10, 4000, 20, 0, 10, 4000, 20, 3000, 10, 0, 20, 3000,
      0, 'LINE', 8, 'HIDDEN', 10, 0, 20, 0, 11, 9999, 21, 9999,
      0, 'INSERT', 8, 'FURN', 2, 'CHAIR', 10, 1000, 20, 1000, 41, 1, 42, 1, 50, 90,
      0, 'INSERT', 8, 'FURN', 2, 'CHAIR', 10, 2000, 20, 1000, 230, -1,
      0, 'DIMENSION', 8, 'DIM', 2, '*D1', 70, 0, 10, 0, 20, -500, 13, 0, 23, 0, 14, 4000, 24, 0, 50, 0, 42, 4000, 1, '',
      0, 'TEXT', 8, 'TEXT', 10, 1800, 20, 1500, 40, 150, 1, 'LIVING',
      0, 'ENDSEC'
    ),
    pairs(0, 'EOF'),
  ].join('\n')
  const parsed = parseDxf(dxf)
  assert.equal(parsed.insUnits, 4)
  // Hidden layer skipped; rotated insert runs along +y; mirrored insert runs along −x.
  const segs: number[][] = []
  for (let i = 0; i < parsed.segs.length; i += 5) segs.push(parsed.segs.slice(i, i + 4))
  assert.ok(!segs.some((s) => s[2] === 9999), 'frozen layer excluded')
  assert.ok(segs.some((s) => Math.abs(s[0] - 1000) < 1e-6 && Math.abs(s[1] - 1000) < 1e-6 && Math.abs(s[2] - 1000) < 1e-6 && Math.abs(s[3] - 1500) < 1e-6), 'rotated block')
  assert.ok(segs.some((s) => Math.abs(s[0] + 2000) < 1e-6 && Math.abs(s[2] + 2500) < 1e-6), 'OCS-mirrored block (x → −x)')
  assert.equal(parsed.dims.length, 1)
  assert.equal(parsed.dims[0].measured, 4000)

  const [page] = await extractDxf(Buffer.from(dxf))
  const ex = page.extraction
  assert.equal(ex.dxf!.mmPerUnit, 1)
  const d = ex.cadDimensions[0]
  const lenPx = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y)
  assert.ok(Math.abs(lenPx * ex.dxf!.mmPerPx! - 4000) < 1e-6, 'CAD dimension length is exact in mm')
  assert.ok(ex.texts.some((t) => t.text === 'LIVING'))
})
