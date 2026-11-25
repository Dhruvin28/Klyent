import { describe, expect, it } from 'vitest'
import { SRGB_TO_LINEAR, linearToSrgbExact } from '../color'
import { EDGE_SNAP_RADIUS, snapAlphaToEdges } from '../edges'
import { VisualizerEngine, calibrationGain, type SpecSurface } from '../engine'
import { defaultEstimate, estimateOption, quantityFor, SQFT_PER_SQM } from '../estimate'
import { applyHomography, invert3, planeToImage } from '../homography'
import { createMask, fillPolygon } from '../mask'
import { createImage, expandTexture, makeSeamless, makeSeamlessCut, prepareMaterial, samplePatch, whiteBalance } from '../material'
import { labelPanels } from '../panels'
import { fitQuadToMask } from '../quadfit'
import type { Quad, RGBAImage, VizAssignment, VizMaterial } from '../types'

// ── helpers ────────────────────────────────────────────────────────────────

function fill(w: number, h: number, f: (x: number, y: number) => [number, number, number]): RGBAImage {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const [r, g, b] = f(x, y)
    img.data[i] = r
    img.data[i + 1] = g
    img.data[i + 2] = b
    img.data[i + 3] = 255
  }
  return img
}

const lin = (r: number, g: number, b: number): [number, number, number] => [linearToSrgbExact(r), linearToSrgbExact(g), linearToSrgbExact(b)]

function px(img: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

function rectMask(w: number, h: number, rects: [number, number, number, number][]) {
  const m = createMask(w, h)
  for (const [x0, y0, x1, y1] of rects) fillPolygon(m, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], 'add')
  return m
}

const assignment = (materialId: string, a: Partial<VizAssignment> = {}): VizAssignment => ({
  materialId,
  pattern: 'continuous',
  rotationDeg: 0,
  offsetXMm: 0,
  offsetYMm: 0,
  scale: 1,
  finish: 'satin',
  shading: 1,
  detail: 0,
  smoothing: 0.5,
  exposure: 1,
  tile: { layout: 'grid', groutMm: 0, groutColor: '#d0d0d0', variation: false },
  ...a,
})

const material = (m: Partial<VizMaterial>): VizMaterial => ({
  id: 'm',
  name: 'M',
  kind: 'texture',
  category: 'laminate',
  colorHex: null,
  sourceAssetId: null,
  textureAssetId: null,
  textureWidth: null,
  textureHeight: null,
  widthMm: null,
  heightMm: null,
  brand: null,
  code: null,
  notes: null,
  settings: null,
  createdAt: '',
  updatedAt: '',
  ...m,
})

// ── edge snapping ──────────────────────────────────────────────────────────

describe('edge snapping', () => {
  // Dark wardrobe (x < 60) against a light wall; the selection overshoots by 3px.
  const W = 120, H = 60
  const img = fill(W, H, (x) => (x < 60 ? [70, 50, 40] : [225, 222, 215]))
  const raw = rectMask(W, H, [[10, 10, 63, 50]]).data

  it('pulls a misplaced outline onto the true edge in the render', () => {
    const out = snapAlphaToEdges(img, raw, raw)
    for (let y = 15; y < 45; y++) {
      expect(out[y * W + 55]).toBe(255) // well inside stays selected
      expect(out[y * W + 58]).toBeGreaterThan(200) // up to the edge
      expect(out[y * W + 61]).toBeLessThan(50) // overshoot onto the wall is removed
      expect(out[y * W + 62]).toBeLessThan(50)
    }
  })

  it('never reaches further than the server allowance beyond the selection', () => {
    // A selection that stops 3px short of the edge may grow at most EDGE_SNAP_RADIUS px.
    const short = rectMask(W, H, [[10, 10, 57, 50]]).data
    const out = snapAlphaToEdges(img, short, short)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!out[y * W + x]) continue
      let near = false
      for (let dy = -EDGE_SNAP_RADIUS; dy <= EDGE_SNAP_RADIUS && !near; dy++) {
        for (let dx = -EDGE_SNAP_RADIUS; dx <= EDGE_SNAP_RADIUS; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && short[yy * W + xx]) { near = true; break }
        }
      }
      expect(near).toBe(true)
    }
    // and it does grow towards the true edge
    expect(out[30 * W + 58]).toBeGreaterThan(128)
  })

  it('renders with edgeSnap and still verifies byte-identical outside the edit mask', () => {
    const engine = new VisualizerEngine(img)
    engine.setMask('s', 1, raw)
    const out = engine.render({
      surfaces: [{ id: 's', quad: null, widthMm: 1000, heightMm: 1000, feather: 1, edgeSnap: true, assignment: assignment('p'), material: { kind: 'paint', colorHex: '#3366aa' } }],
    })
    expect(out.report.ok).toBe(true)
    // the wall next to the wardrobe keeps its original colour despite the overshooting selection
    expect(px({ width: W, data: out.result }, 62, 30)).toEqual(px(img, 62, 30))
  })
})

// ── lighting colour and calibration ─────────────────────────────────────────

describe('lighting colour', () => {
  // A beige wall under a warm lamp on the left and cool daylight on the right.
  const W = 200, H = 100
  const albedo = [0.6, 0.55, 0.5]
  const light = (x: number): [number, number, number] => {
    const t = x / (W - 1)
    return [1.15 - 0.3 * t, 1, 0.85 + 0.3 * t]
  }
  const img = fill(W, H, (x) => {
    const l = light(x)
    return lin(albedo[0] * l[0] * 0.8, albedo[1] * l[1] * 0.8, albedo[2] * l[2] * 0.8)
  })
  const mask = rectMask(W, H, [[0, 0, W, H]]).data
  const grey = '#808080'
  const render = (a: Partial<VizAssignment>, calibration: Parameters<typeof calibrationGain>[0] = null) => {
    const engine = new VisualizerEngine(img)
    engine.setMask('s', 1, mask)
    return engine.render({
      surfaces: [{ id: 's', quad: null, widthMm: 4000, heightMm: 2000, feather: 0, assignment: assignment('p', { shading: 1, ...a }), material: { kind: 'paint', colorHex: grey } }],
      calibration,
    }).result
  }
  const redBlue = (out: Uint8ClampedArray, x: number) => {
    const [r, , b] = px({ width: W, data: out }, x, 50)
    return SRGB_TO_LINEAR[r] / SRGB_TO_LINEAR[b]
  }

  it('carries warm and cool light onto a neutral paint', () => {
    const neutral = render({ lightColor: 0 })
    expect(redBlue(neutral, 20)).toBeCloseTo(redBlue(neutral, 180), 2) // luminance-only shading: no colour
    const tinted = render({ lightColor: 1 })
    expect(redBlue(tinted, 20)).toBeGreaterThan(1.15) // warm side
    expect(redBlue(tinted, 180)).toBeLessThan(0.9) // cool side
  })

  it('scene calibration applies the measured exposure and white balance', () => {
    expect(calibrationGain(null)).toBeNull()
    expect(calibrationGain({ enabled: false, white: [0.5, 0.5, 0.5], albedo: 0.85, point: [0, 0] })).toBeNull()
    const g = calibrationGain({ enabled: true, white: [0.425, 0.34, 0.255], albedo: 0.85, point: [0, 0] })!
    expect(g[0]).toBeCloseTo(0.5, 6)
    expect(g[1]).toBeCloseTo(0.4, 6)
    expect(g[2]).toBeCloseTo(0.3, 6)
    const plain = render({})
    const cal = render({}, { enabled: true, white: [0.425, 0.34, 0.255], albedo: 0.85, point: [0, 0] })
    const p = px({ width: W, data: plain }, 100, 50).map((v) => SRGB_TO_LINEAR[v])
    const c = px({ width: W, data: cal }, 100, 50).map((v) => SRGB_TO_LINEAR[v])
    expect(c[0] / p[0]).toBeCloseTo(0.5, 1)
    expect(c[2] / p[2]).toBeCloseTo(0.3, 1)
  })
})

// ── recolour ───────────────────────────────────────────────────────────────

describe('recolour', () => {
  it('keeps the original weave/grain while changing the colour', () => {
    const W = 120, H = 40
    // Fabric with a strong fine weave (alternating columns)
    const img = fill(W, H, (x) => (x % 2 ? lin(0.25, 0.25, 0.3) : lin(0.12, 0.12, 0.15)))
    const engine = new VisualizerEngine(img)
    engine.setMask('s', 1, rectMask(W, H, [[0, 0, W, H]]).data)
    const run = (mode: 'replace' | 'recolor') =>
      engine.render({
        surfaces: [{ id: 's', quad: null, widthMm: 1000, heightMm: 300, feather: 0, assignment: assignment('p', { mode, detail: 0, smoothing: 1 }), material: { kind: 'paint', colorHex: '#b04020' } }],
      }).result
    const contrast = (out: Uint8ClampedArray) => SRGB_TO_LINEAR[px({ width: W, data: out }, 61, 20)[0]] / SRGB_TO_LINEAR[px({ width: W, data: out }, 60, 20)[0]]
    const replaced = contrast(run('replace'))
    const recoloured = contrast(run('recolor'))
    expect(recoloured).toBeGreaterThan(1.85) // recolour keeps the weave (2:1 in the original)
    expect(recoloured).toBeGreaterThan(replaced + 0.3) // replace (detail 0) flattens much of it
    const [r, g, b] = px({ width: W, data: run('recolor') }, 61, 20)
    expect(r).toBeGreaterThan(g) // and takes the new hue
    expect(r).toBeGreaterThan(b)
  })
})

// ── panels ─────────────────────────────────────────────────────────────────

describe('per-panel grain', () => {
  const W = 220, H = 100
  const img = fill(W, H, () => lin(0.3, 0.2, 0.1))
  // Two shutters 100px wide with a 10px gap (plus a stray speck that must not count as a panel).
  const raw = rectMask(W, H, [[5, 10, 105, 90], [115, 10, 215, 90], [2, 2, 4, 4]]).data
  // Texture: horizontal ramp (asymmetric), 1000mm wide → mirroring is visible.
  const tex = fill(256, 16, (x) => [x, x, x])
  const quad: SpecSurface['quad'] = [[5, 10], [215, 10], [215, 90], [5, 90]]
  const render = (panelMode: 'continuous' | 'random' | 'bookmatch') => {
    const engine = new VisualizerEngine(img)
    engine.setMask('s', 1, raw)
    engine.setTexture('t', 'v1', tex)
    return engine.render({
      surfaces: [{
        id: 's', quad, widthMm: 2100, heightMm: 800, feather: 0,
        assignment: assignment('t', { shading: 0, panelMode, panelSeed: 3 }),
        material: { kind: 'texture', materialId: 't', widthMm: 4000, heightMm: 4000 },
      }],
    })
  }
  const lum = (out: Uint8ClampedArray, x: number) => px({ width: W, data: out }, x, 50)[0]

  it('finds the separate panels', () => {
    const map = labelPanels(raw, raw, W, { x0: 0, y0: 0, x1: W, y1: H })
    expect(map.count).toBe(2)
    expect(map.rank).toEqual(map.centroids[0].x < map.centroids[1].x ? [0, 1] : [1, 0])
  })

  it('book-matches neighbouring panels as mirror images across the gap', () => {
    const out = render('bookmatch')
    expect(out.report.ok).toBe(true)
    // Left panel ramps up to the gap; the right panel mirrors it: symmetric about x = 110.
    for (const d of [8, 20, 40, 80]) expect(Math.abs(lum(out.result, 110 - d) - lum(out.result, 110 + d))).toBeLessThanOrEqual(3)
    const cont = render('continuous')
    expect(Math.abs(lum(cont.result, 110 - 40) - lum(cont.result, 110 + 40))).toBeGreaterThan(20)
  })

  it('random placement starts each panel at a different place on the sheet, deterministically', () => {
    const a = render('random')
    const b = render('random')
    expect(Array.from(a.result)).toEqual(Array.from(b.result))
    expect(a.report.ok).toBe(true)
    // Continuous: the right panel continues the left one's ramp. Random: the step across the
    // gap is broken (the panels no longer read as one sheet).
    const step = (o: Uint8ClampedArray) => lum(o, 120) - lum(o, 100)
    const cont = render('continuous')
    expect(Math.abs(step(a.result) - step(cont.result))).toBeGreaterThan(10)
  })
})

// ── reflections ────────────────────────────────────────────────────────────

describe('floor reflections', () => {
  it('reflects what stands on the floor and fades with distance', () => {
    const W = 120, H = 120
    // Dark room; a bright white cabinet stands on the floor at columns 40..80; floor from y = 60.
    const img = fill(W, H, (x, y) => (y < 60 ? (x >= 40 && x < 80 && y >= 30 ? lin(0.9, 0.9, 0.9) : lin(0.05, 0.05, 0.05)) : lin(0.2, 0.2, 0.2)))
    const engine = new VisualizerEngine(img)
    engine.setMask('floor', 1, rectMask(W, H, [[0, 60, W, H]]).data)
    const run = (reflection: number) =>
      engine.render({
        surfaces: [{ id: 'floor', quad: null, widthMm: 4000, heightMm: 4000, feather: 0, assignment: assignment('p', { finish: 'gloss', reflection, shading: 0 }), material: { kind: 'paint', colorHex: '#404040' } }],
      })
    const base = run(0)
    const refl = run(0.8)
    expect(refl.report.ok).toBe(true)
    const at = (o: Uint8ClampedArray, x: number, y: number) => px({ width: W, data: o }, x, y)[0]
    expect(at(refl.result, 60, 62)).toBeGreaterThan(at(base.result, 60, 62) + 40) // under the cabinet
    expect(at(refl.result, 10, 62)).toBeLessThanOrEqual(at(base.result, 10, 62)) // under the dark wall: no bright reflection
    expect(at(refl.result, 60, 62) - at(base.result, 60, 62)).toBeGreaterThan(at(refl.result, 60, 75) - at(base.result, 60, 75)) // fades
  })
})

// ── measurement ────────────────────────────────────────────────────────────

describe('area measurement', () => {
  it('integrates real area through perspective, excluding protected details', () => {
    const W = 800, H = 600
    const img = fill(W, H, () => [128, 128, 128])
    // A 2400 × 1800 mm wall seen in perspective.
    const quad: Quad = [{ x: 120, y: 90 }, { x: 640, y: 150 }, { x: 650, y: 520 }, { x: 110, y: 560 }]
    const m = createMask(W, H)
    fillPolygon(m, quad, 'add')
    const engine = new VisualizerEngine(img)
    engine.setMask('wall', 1, m.data)
    const tuples = quad.map((p) => [p.x, p.y]) as SpecSurface['quad']
    const [r] = engine.measure([{ id: 'wall', quad: tuples, widthMm: 2400, heightMm: 1800, feather: 0 }])
    expect(r.areaSqm).toBeGreaterThan(4.32 * 0.99)
    expect(r.areaSqm).toBeLessThan(4.32 * 1.01)

    // Protect a 600 × 600 mm window in the middle of the wall (mapped from the plane).
    const Hm = planeToImage(quad, 2400, 1800)
    const win = [[900, 600], [1500, 600], [1500, 1200], [900, 1200]].map(([u, v]) => applyHomography(Hm, u, v))
    const p = createMask(W, H)
    fillPolygon(p, win, 'add')
    engine.setMask('__protect__', 1, p.data)
    const [r2] = engine.measure([{ id: 'wall', quad: tuples, widthMm: 2400, heightMm: 1800, feather: 0 }])
    expect(r2.areaSqm).toBeGreaterThan((4.32 - 0.36) * 0.99)
    expect(r2.areaSqm).toBeLessThan((4.32 - 0.36) * 1.01)
    expect(invert3).toBeDefined()
  })
})

// ── quad fitting ───────────────────────────────────────────────────────────

describe('auto-fit corners', () => {
  it('recovers the corners of a perspective rectangle from its selection', () => {
    const W = 800, H = 600
    const quad: Quad = [{ x: 140.3, y: 80.7 }, { x: 610.2, y: 140.1 }, { x: 640.8, y: 530.4 }, { x: 100.6, y: 470.9 }]
    const m = createMask(W, H)
    fillPolygon(m, quad, 'add')
    // A notch for a handle and a rounded-off corner must not pull the fit.
    fillPolygon(m, [{ x: 400, y: 300 }, { x: 420, y: 300 }, { x: 420, y: 340 }, { x: 400, y: 340 }], 'subtract')
    const fit = fitQuadToMask(m)!
    expect(fit).not.toBeNull()
    fit.forEach((p, i) => expect(Math.hypot(p.x - quad[i].x, p.y - quad[i].y)).toBeLessThan(1.5))
  })

  it('returns null for an empty selection', () => {
    expect(fitQuadToMask(createMask(50, 50))).toBeNull()
  })
})

// ── material preparation ───────────────────────────────────────────────────

describe('material preparation extras', () => {
  it('white-balances a sample from a neutral patch', () => {
    // Warm cast: a grey card photographed as (200, 170, 130).
    const img = fill(40, 40, (x) => (x < 20 ? [200, 170, 130] : [160, 120, 90]))
    const patch = samplePatch(img, 5, 20, 3)
    const wb = whiteBalance(img, patch)
    const [r, g, b] = px(wb, 5, 20)
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2)
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2)
  })

  it('seam-cut tiling wraps seamlessly at the same size as the cross-fade', () => {
    const W = 200, H = 120
    const img = fill(W, H, (x, y) => [Math.round((x / W) * 255), Math.round((y / H) * 255), Math.round(127 + 100 * Math.sin(x / 7))])
    const cut = makeSeamlessCut(img, 0.2)
    const blend = makeSeamless(img, 0.2)
    expect([cut.width, cut.height]).toEqual([blend.width, blend.height])
    let worst = 0
    for (let y = 0; y < cut.height; y++) worst = Math.max(worst, Math.abs(px(cut, cut.width - 1, y)[0] - px(cut, 0, y)[0]))
    for (let x = 0; x < cut.width; x++) worst = Math.max(worst, Math.abs(px(cut, x, cut.height - 1)[1] - px(cut, x, 0)[1]))
    expect(worst).toBeLessThanOrEqual(6)
  })

  it('seam-cut does not ghost fine grain the way a cross-fade does', () => {
    // Fine vertical grain with a phase that drifts: a cross-fade averages two out-of-phase copies (low contrast).
    const W = 240, H = 60
    const img = fill(W, H, (x, y) => {
      const v = 128 + 110 * Math.sin((x + y * 0.4) * 0.9)
      return [v, v, v]
    })
    const contrast = (t: RGBAImage) => {
      let lo = 255, hi = 0
      for (let x = 0; x < 30; x++) { const v = px(t, x, 30)[0]; lo = Math.min(lo, v); hi = Math.max(hi, v) }
      return hi - lo
    }
    expect(contrast(makeSeamlessCut(img, 0.25))).toBeGreaterThan(contrast(makeSeamless(img, 0.25)))
    expect(contrast(makeSeamlessCut(img, 0.25))).toBeGreaterThan(180)
  })

  it('expands a swatch into a larger, tileable, non-repeating texture', () => {
    let s = 7
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
    const base = fill(64, 64, () => { const v = Math.round(90 + rnd() * 80); return [v, v - 10, v - 30] })
    const tile = makeSeamlessCut(base, 0.15)
    const big = expandTexture(tile, 2)
    expect(big.width).toBe(tile.width * 2)
    expect(big.height).toBe(tile.height * 2)
    // not just two copies side by side
    let same = 0
    for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) if (px(big, x, y)[0] === px(big, x + tile.width, y)[0]) same++
    expect(same / (tile.width * tile.height)).toBeLessThan(0.5)
    // tileable: wrap difference comparable to neighbouring-pixel difference
    let wrap = 0, inner = 0
    for (let y = 0; y < big.height; y++) {
      wrap += Math.abs(px(big, big.width - 1, y)[0] - px(big, 0, y)[0])
      inner += Math.abs(px(big, 10, y)[0] - px(big, 11, y)[0])
    }
    expect(wrap).toBeLessThan(inner * 1.6)
  })

  it('reports doubled physical size for expanded textures', () => {
    const photo = fill(300, 300, (x, y) => [100 + ((x * 7 + y * 3) % 50), 90, 80])
    const r = prepareMaterial(photo, { corners: null, widthMm: 300, heightMm: 300, delight: 0, seamless: 0.1, maxSide: 256, expand: 2, seamlessMode: 'cut' })
    expect(r.widthMm).toBeCloseTo(300 * 0.9 * 2, 0)
    expect(r.texture.width).toBeGreaterThan(256)
    // expansion needs a seamless swatch: ignored otherwise
    const r2 = prepareMaterial(photo, { corners: null, widthMm: 300, heightMm: 300, delight: 0, seamless: 0, maxSide: 256, expand: 2 })
    expect(r2.widthMm).toBe(300)
  })
})

// ── quantities ─────────────────────────────────────────────────────────────

describe('quantity estimate', () => {
  it('orders laminate sheets with wastage', () => {
    const lam = material({ category: 'laminate', settings: { estimate: { unit: 'sheet', sheetWidthMm: 2440, sheetHeightMm: 1220, wastagePct: 15, rate: 2400 } } })
    // 2 sheets' worth of area exactly → 2 × 1.15 = 2.3 → 3 sheets
    const q = quantityFor(2 * 2.4400 * 1.2200, lam)
    expect(q.quantity).toBe(3)
    expect(q.cost).toBe(7200)
  })

  it('orders tiles in whole boxes', () => {
    const tile = material({ category: 'tile', widthMm: 600, heightMm: 600 })
    expect(defaultEstimate(tile).piecesPerBox).toBe(4)
    const q = quantityFor(10, tile) // 10 m² + 10% = 11 m² → 31 tiles → 8 boxes
    expect(q.pieces).toBe(31)
    expect(q.quantity).toBe(8)
    expect(q.cost).toBeNull()
  })

  it('computes paint litres by coats and coverage', () => {
    const paint = material({ kind: 'paint', category: 'paint', colorHex: '#ffffff' })
    const q = quantityFor(30, paint) // 30 m² ×1.05 × 2 coats / 10 m²/L = 6.3 → 7 L
    expect(q.quantity).toBe(7)
  })

  it('groups surfaces sharing a material into one order', () => {
    const lam = material({ id: 'lam', category: 'laminate', settings: { estimate: { unit: 'sheet', wastagePct: 0, rate: 1000 } } })
    const sheet = 2.44 * 1.22
    const est = estimateOption(
      [
        { surfaceId: 'a', surfaceName: 'Shutter L', materialId: 'lam', areaSqm: sheet * 0.6 },
        { surfaceId: 'b', surfaceName: 'Shutter R', materialId: 'lam', areaSqm: sheet * 0.3 },
      ],
      new Map([['lam', lam]])
    )
    expect(est.lines).toHaveLength(1)
    expect(est.lines[0].quantity).toBe(1) // 0.9 sheet → 1, not 2
    expect(est.total).toBe(1000)
    expect(est.areaSqm * SQFT_PER_SQM).toBeCloseTo(sheet * 0.9 * SQFT_PER_SQM, 6)
  })
})
