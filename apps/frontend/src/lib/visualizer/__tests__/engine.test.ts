import { describe, expect, it } from 'vitest'
import { SRGB_TO_LINEAR, hexToRgb, linearToSrgb8, linearToSrgbExact } from '../color'
import { PROTECT_KEY, VisualizerEngine, type SpecSurface } from '../engine'
import { featherU8 } from '../filters'
import { applyHomography, estimateAspectRatio, invert3, isConvexQuad, planeToImage, solveHomography } from '../homography'
import { brushStroke, closeMask, createMask, fillPolygon, maskArea, smartSelect } from '../mask'
import { createImage, makeSeamless, prepareMaterial } from '../material'
import { verifyComposite } from '../render'
import type { Point, Quad, RGBAImage, VizAssignment } from '../types'

// ── helpers ────────────────────────────────────────────────────────────────

function solid(w: number, h: number, rgb: [number, number, number]): RGBAImage {
  const img = createImage(w, h)
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = rgb[0]
    img.data[i * 4 + 1] = rgb[1]
    img.data[i * 4 + 2] = rgb[2]
    img.data[i * 4 + 3] = 255
  }
  return img
}

function px(img: RGBAImage | { width: number; data: Uint8ClampedArray }, x: number, y: number) {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

/** Simple pinhole camera: world point → image (principal point at centre). */
function project(P: number[], f: number, w: number, h: number): Point {
  return { x: (f * P[0]) / P[2] + w / 2, y: (f * P[1]) / P[2] + h / 2 }
}

function rotY(a: number) {
  const c = Math.cos(a), s = Math.sin(a)
  return (p: number[]) => [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]
}
function rotX(a: number) {
  const c = Math.cos(a), s = Math.sin(a)
  return (p: number[]) => [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]
}

function rectQuadInCamera(wMm: number, hMm: number, yaw: number, pitch: number, dist: number, f: number, W: number, H: number): Quad {
  const corners = [[-wMm / 2, -hMm / 2, 0], [wMm / 2, -hMm / 2, 0], [wMm / 2, hMm / 2, 0], [-wMm / 2, hMm / 2, 0]]
  return corners.map((c) => {
    const r = rotX(pitch)(rotY(yaw)(c))
    return project([r[0] + 150, r[1] - 80, r[2] + dist], f, W, H)
  }) as Quad
}

const baseAssignment = (materialId: string): VizAssignment => ({
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
})

// ── colour ─────────────────────────────────────────────────────────────────

describe('color', () => {
  it('sRGB ↔ linear round-trips every 8-bit value', () => {
    for (let v = 0; v < 256; v++) {
      expect(linearToSrgbExact(SRGB_TO_LINEAR[v])).toBe(v)
      expect(Math.abs(linearToSrgb8(SRGB_TO_LINEAR[v]) - v)).toBeLessThanOrEqual(1)
    }
  })
})

// ── homography ─────────────────────────────────────────────────────────────

describe('homography', () => {
  const quad: Quad = [{ x: 100, y: 120 }, { x: 900, y: 60 }, { x: 960, y: 700 }, { x: 80, y: 640 }]

  it('maps plane corners exactly onto the quad and inverts', () => {
    const H = planeToImage(quad, 2400, 1800)
    const corners = [[0, 0], [2400, 0], [2400, 1800], [0, 1800]]
    corners.forEach(([u, v], i) => {
      const p = applyHomography(H, u, v)
      expect(p.x).toBeCloseTo(quad[i].x, 6)
      expect(p.y).toBeCloseTo(quad[i].y, 6)
    })
    const Hi = invert3(H)
    const back = applyHomography(Hi, 500, 400)
    const fwd = applyHomography(H, back.x, back.y)
    expect(fwd.x).toBeCloseTo(500, 6)
    expect(fwd.y).toBeCloseTo(400, 6)
  })

  it('rejects degenerate quads', () => {
    expect(() => solveHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }], quad)).toThrow()
    expect(isConvexQuad(quad)).toBe(true)
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false)
  })

  it('recovers the real aspect ratio of a rectangle under two-point perspective', () => {
    const W = 1920, H = 1080, f = 1100
    for (const [wMm, hMm, yaw, pitch] of [[2400, 2100, 0.6, 0.25], [1200, 2700, -0.5, 0.15], [3000, 900, 0.35, -0.3]]) {
      const quad = rectQuadInCamera(wMm, hMm, yaw, pitch, 4000, f, W, H)
      const est = estimateAspectRatio(quad, W, H)
      expect(Math.abs(est / (wMm / hMm) - 1)).toBeLessThan(0.01)
    }
  })

  it('is exact for frontal rectangles and close for one-point perspective', () => {
    const W = 1600, H = 1000
    const frontal: Quad = [{ x: 200, y: 100 }, { x: 1000, y: 100 }, { x: 1000, y: 500 }, { x: 200, y: 500 }]
    expect(estimateAspectRatio(frontal, W, H)).toBeCloseTo(2, 6)
    // Floor seen with a level camera rotated about X only (one vanishing point) using the assumed 60° FOV.
    const f = W / (2 * Math.tan(Math.PI / 6))
    const quad = rectQuadInCamera(3000, 4000, 0, 1.1, 5000, f, W, H)
    expect(Math.abs(estimateAspectRatio(quad, W, H) / 0.75 - 1)).toBeLessThan(0.02)
  })
})

// ── masks ──────────────────────────────────────────────────────────────────

describe('mask tools', () => {
  it('rasterises polygons with exact area and seamless shared edges', () => {
    const m = createMask(200, 200)
    fillPolygon(m, [{ x: 10.25, y: 20.5 }, { x: 110.75, y: 20.5 }, { x: 110.75, y: 120.3 }, { x: 10.25, y: 120.3 }], 'add')
    expect(maskArea(m)).toBeCloseTo(100.5 * 99.8, -1)

    const two = createMask(100, 50)
    fillPolygon(two, [{ x: 5, y: 5 }, { x: 50.4, y: 5 }, { x: 50.4, y: 45 }, { x: 5, y: 45 }], 'add')
    fillPolygon(two, [{ x: 50.4, y: 5 }, { x: 95, y: 5 }, { x: 95, y: 45 }, { x: 50.4, y: 45 }], 'add')
    for (let y = 6; y < 44; y++) expect(two.data[y * 100 + 50]).toBe(255)

    fillPolygon(two, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], 'subtract')
    expect(maskArea(two)).toBe(0)
  })

  it('paints and erases with the brush', () => {
    const m = createMask(100, 100)
    brushStroke(m, { x: 20, y: 50 }, { x: 80, y: 50 }, 10, 1, 'add')
    expect(m.data[50 * 100 + 50]).toBe(255)
    expect(m.data[30 * 100 + 50]).toBe(0)
    brushStroke(m, { x: 50, y: 30 }, { x: 50, y: 70 }, 5, 1, 'subtract')
    expect(m.data[50 * 100 + 50]).toBe(0)
    expect(m.data[50 * 100 + 30]).toBe(255)
  })

  it('smart-selects a shaded, grained surface accurately', () => {
    const W = 400, H = 300
    const img = createImage(W, H)
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)
    const inRect = (x: number, y: number) => x >= 100 && x < 300 && y >= 60 && y < 260
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const shade = 0.75 + 0.35 * (x / W) // lighting gradient
      const grain = 1 + 0.06 * Math.sin(x * 0.9 + y * 0.05) + 0.03 * (rnd() - 0.5)
      const c = inRect(x, y) ? [150, 100, 60] : [215, 215, 210]
      img.data[i] = Math.min(255, c[0] * shade * grain)
      img.data[i + 1] = Math.min(255, c[1] * shade * grain)
      img.data[i + 2] = Math.min(255, c[2] * shade * grain)
      img.data[i + 3] = 255
    }
    const m = smartSelect(img, { x: 200, y: 160 }, { tolerance: 22, contiguous: true, lightnessWeight: 0.3 })
    let inter = 0, uni = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = m.data[y * W + x] ? 1 : 0
      const b = inRect(x, y) ? 1 : 0
      inter += a & b
      uni += a | b
    }
    expect(inter / uni).toBeGreaterThan(0.99)
  })

  it('closing fills pin-holes; feathering keeps image borders opaque', () => {
    const m = createMask(50, 50)
    m.data.fill(255)
    m.data[25 * 50 + 25] = 0
    expect(closeMask(m, 1).data[25 * 50 + 25]).toBe(255)

    const edge = createMask(60, 60)
    for (let y = 30; y < 60; y++) for (let x = 0; x < 60; x++) edge.data[y * 60 + x] = 255
    const f = featherU8(edge.data, 60, 60, 3)
    expect(f[59 * 60 + 0]).toBe(255)
    expect(f[59 * 60 + 59]).toBe(255)
    expect(f[30 * 60 + 30]).toBeGreaterThan(80)
    expect(f[30 * 60 + 30]).toBeLessThan(200)
    expect(f[10 * 60 + 30]).toBe(0)
  })
})

// ── materials ──────────────────────────────────────────────────────────────

describe('material preparation', () => {
  it('straightens a perspective-distorted sample', () => {
    // A sample photo containing a 4×4 checkerboard viewed in perspective.
    const W = 600, H = 500
    const quad: Quad = [{ x: 120, y: 80 }, { x: 500, y: 110 }, { x: 470, y: 420 }, { x: 90, y: 380 }]
    const Hm = invert3(planeToImage(quad, 400, 400)) // image → plane mm
    const photo = createImage(W, H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = applyHomography(Hm, x + 0.5, y + 0.5)
      const inside = p.x >= 0 && p.x < 400 && p.y >= 0 && p.y < 400
      const v = inside ? ((Math.floor(p.x / 100) + Math.floor(p.y / 100)) % 2 ? 230 : 30) : 128
      const i = (y * W + x) * 4
      photo.data[i] = photo.data[i + 1] = photo.data[i + 2] = v
      photo.data[i + 3] = 255
    }
    const { texture, widthMm, heightMm } = prepareMaterial(photo, { corners: quad, widthMm: 400, heightMm: 400, delight: 0, seamless: 0, maxSide: 1024 })
    expect(widthMm).toBe(400)
    expect(heightMm).toBe(400)
    expect(texture.width).toBe(texture.height)
    // Sample the centre of each checker cell: must alternate dark/light.
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
      const x = Math.floor(((cx + 0.5) / 4) * texture.width)
      const y = Math.floor(((cy + 0.5) / 4) * texture.height)
      const v = px(texture, x, y)[0]
      if ((cx + cy) % 2) expect(v).toBeGreaterThan(200)
      else expect(v).toBeLessThan(60)
    }
  })

  it('produces a seamlessly wrapping texture', () => {
    const W = 200, H = 100
    const img = createImage(W, H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      img.data[i] = (x / W) * 255 // strong horizontal ramp → hard seam when tiled
      img.data[i + 1] = (y / H) * 255
      img.data[i + 2] = 100
      img.data[i + 3] = 255
    }
    const s = makeSeamless(img, 0.2)
    let maxSeam = 0
    for (let y = 0; y < s.height; y++) {
      const a = px(s, s.width - 1, y)[0]
      const b = px(s, 0, y)[0]
      maxSeam = Math.max(maxSeam, Math.abs(a - b))
    }
    expect(maxSeam).toBeLessThanOrEqual(3)
    let maxSeamV = 0
    for (let x = 0; x < s.width; x++) maxSeamV = Math.max(maxSeamV, Math.abs(px(s, x, s.height - 1)[1] - px(s, x, 0)[1]))
    expect(maxSeamV).toBeLessThanOrEqual(3)
  })

  it('removes a photographed lighting gradient', () => {
    const W = 256, H = 256
    const img = createImage(W, H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const lit = 0.5 + 0.5 * (x / W)
      const i = (y * W + x) * 4
      img.data[i] = linearToSrgbExact(0.4 * lit)
      img.data[i + 1] = linearToSrgbExact(0.3 * lit)
      img.data[i + 2] = linearToSrgbExact(0.2 * lit)
      img.data[i + 3] = 255
    }
    const { texture } = prepareMaterial(img, { corners: null, widthMm: 600, heightMm: 600, delight: 1, seamless: 0, maxSide: 512 })
    const left = px(texture, Math.floor(texture.width * 0.25), 128)[0]
    const right = px(texture, Math.floor(texture.width * 0.75), 128)[0]
    expect(Math.abs(left - right)).toBeLessThanOrEqual(6) // was ~40 levels apart
  })
})

// ── full render pipeline ───────────────────────────────────────────────────

describe('render pipeline', () => {
  const W = 320, H = 240
  // Room: grey walls, a "wardrobe" rectangle lit with a horizontal gradient and a hard shadow.
  function room(): RGBAImage {
    const img = createImage(W, H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const inWardrobe = x >= 80 && x < 240 && y >= 40 && y < 200
      let lin: [number, number, number]
      if (inWardrobe) {
        const light = (x < 190 ? 1 : 0.5) // hard shadow on the right ~30%
        lin = [0.3 * light, 0.2 * light, 0.12 * light]
      } else lin = [0.5, 0.5, 0.48]
      img.data[i] = linearToSrgbExact(lin[0])
      img.data[i + 1] = linearToSrgbExact(lin[1])
      img.data[i + 2] = linearToSrgbExact(lin[2])
      img.data[i + 3] = 255
    }
    return img
  }
  function wardrobeMask() {
    const m = createMask(W, H)
    fillPolygon(m, [{ x: 80, y: 40 }, { x: 240, y: 40 }, { x: 240, y: 200 }, { x: 80, y: 200 }], 'add')
    return m
  }
  const quad: SpecSurface['quad'] = [[80, 40], [240, 40], [240, 200], [80, 200]]

  it('paints a surface, preserves its shadow and leaves every other pixel untouched', () => {
    const original = room()
    const engine = new VisualizerEngine(original)
    engine.setMask('s1', 1, wardrobeMask().data)
    const out = engine.render({
      surfaces: [{
        id: 's1', quad: null, widthMm: 1600, heightMm: 1600, feather: 0,
        assignment: baseAssignment('paint'), material: { kind: 'paint', colorHex: '#4a7a5c' },
      }],
    })
    expect(out.report.ok).toBe(true)
    expect(out.report.changedOutsideMask).toBe(0)
    expect(out.skipped).toEqual([])
    // Outside: byte-identical
    for (let i = 0; i < W * H; i++) {
      if (!out.editMask[i]) for (let c = 0; c < 4; c++) expect(out.result[i * 4 + c]).toBe(original.data[i * 4 + c])
    }
    // Lit side (reference = median ⇒ one of the two halves) keeps the exact paint colour on one half
    const target = hexToRgb('#4a7a5c')
    const lit = px({ width: W, data: out.result }, 120, 120)
    const shade = px({ width: W, data: out.result }, 220, 120)
    const litLin = SRGB_TO_LINEAR[lit[1]]
    const shadeLin = SRGB_TO_LINEAR[shade[1]]
    // The 2:1 lighting ratio of the original is preserved in the new material.
    expect(litLin / shadeLin).toBeGreaterThan(1.85)
    expect(litLin / shadeLin).toBeLessThan(2.15)
    // Hue is the paint's: channel ratios match the target.
    const ratioTarget = SRGB_TO_LINEAR[target[0]] / SRGB_TO_LINEAR[target[1]]
    expect(SRGB_TO_LINEAR[lit[0]] / litLin).toBeCloseTo(ratioTarget, 1)
    // The majority (lit) area defines reference lighting → exact paint colour there (±1 level).
    lit.forEach((v, k) => expect(Math.abs(v - target[k])).toBeLessThanOrEqual(1))
  })

  it('honours protect masks inside the surface', () => {
    const original = room()
    const engine = new VisualizerEngine(original)
    engine.setMask('s1', 1, wardrobeMask().data)
    const protect = createMask(W, H)
    fillPolygon(protect, [{ x: 150, y: 100 }, { x: 170, y: 100 }, { x: 170, y: 140 }, { x: 150, y: 140 }], 'add') // a "handle"
    engine.setMask(PROTECT_KEY, 1, protect.data)
    const out = engine.render({
      surfaces: [{ id: 's1', quad: null, widthMm: 1600, heightMm: 1600, feather: 1, assignment: baseAssignment('p'), material: { kind: 'paint', colorHex: '#ff0000' } }],
    })
    for (let y = 100; y < 140; y++) for (let x = 150; x < 170; x++) {
      expect(px({ width: W, data: out.result }, x, y)).toEqual(px(original, x, y))
      expect(out.editMask[y * W + x]).toBe(0)
    }
    expect(out.report.ok).toBe(true)
  })

  it('maps a texture at true physical scale, with grain rotation and tiles', () => {
    const original = room()
    const engine = new VisualizerEngine(original)
    engine.setMask('s1', 1, wardrobeMask().data)
    // 100mm-wide stripe texture: left half black, right half white.
    const tex = createImage(64, 64)
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = x < 32 ? 0 : 255
      const i = (y * 64 + x) * 4
      tex.data[i] = tex.data[i + 1] = tex.data[i + 2] = v
      tex.data[i + 3] = 255
    }
    engine.setTexture('stripe', 'v1', tex)
    const spec = (a: Partial<VizAssignment>): SpecSurface => ({
      id: 's1', quad, widthMm: 1600, heightMm: 1600, feather: 0,
      assignment: { ...baseAssignment('stripe'), shading: 0, ...a },
      material: { kind: 'texture', materialId: 'stripe', widthMm: 100, heightMm: 100 },
    })
    // 1600mm over 160px ⇒ 10px per 100mm stripe period ⇒ 5px dark, 5px light.
    const out = engine.render({ surfaces: [spec({})] })
    const row = Array.from({ length: 20 }, (_, k) => px({ width: W, data: out.result }, 80 + k, 60)[0])
    // (pixels 0, 4, 5, 9… straddle a black/white edge and are correctly filtered)
    expect(row.slice(1, 4).every((v) => v < 10)).toBe(true)
    expect(row.slice(6, 9).every((v) => v > 245)).toBe(true)
    expect(row.slice(11, 14).every((v) => v < 10)).toBe(true)
    expect(row.slice(16, 19).every((v) => v > 245)).toBe(true)
    // Vertical stripes ⇒ constant down a column
    expect(px({ width: W, data: out.result }, 82, 60)[0]).toBe(px({ width: W, data: out.result }, 82, 180)[0])
    expect(out.report.ok).toBe(true)

    // Rotate grain 90° ⇒ stripes become horizontal
    const rot = engine.render({ surfaces: [spec({ rotationDeg: 90 })] })
    expect(Math.abs(px({ width: W, data: rot.result }, 82, 61)[0] - px({ width: W, data: rot.result }, 230, 61)[0])).toBeLessThan(8)

    // Tiles 100×100mm with 20mm grout: grout colour shows between tiles
    const tiled = engine.render({
      surfaces: [spec({ pattern: 'tiles', tile: { layout: 'grid', groutMm: 20, groutColor: '#ff0000', variation: false } })],
    })
    // pitch 120mm = 12px; grout occupies mm 100..120 ⇒ px 10..12 of each 12px cycle
    const g = px({ width: W, data: tiled.result }, 80 + 11, 40 + 5)
    expect(g[0]).toBeGreaterThan(200)
    expect(g[1]).toBeLessThan(40)
    expect(tiled.report.ok).toBe(true)
  })

  it('anti-aliases high-frequency textures (mipmapping) instead of producing moiré', () => {
    const original = room()
    const engine = new VisualizerEngine(original)
    engine.setMask('s1', 1, wardrobeMask().data)
    // 1-texel checkerboard, 10mm texture ⇒ ~16 texels per screen pixel
    const tex = createImage(64, 64)
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = (x + y) % 2 ? 255 : 0
      const i = (y * 64 + x) * 4
      tex.data[i] = tex.data[i + 1] = tex.data[i + 2] = v
      tex.data[i + 3] = 255
    }
    engine.setTexture('fine', 'v1', tex)
    const out = engine.render({
      surfaces: [{
        id: 's1', quad, widthMm: 1600, heightMm: 1600, feather: 0,
        assignment: { ...baseAssignment('fine'), shading: 0 },
        material: { kind: 'texture', materialId: 'fine', widthMm: 6.4, heightMm: 6.4 },
      }],
    })
    // Every pixel should be the average grey (linear 0.5 ⇒ sRGB ≈ 188), not black/white noise.
    let maxDev = 0
    for (let y = 50; y < 190; y += 7) for (let x = 90; x < 230; x += 7) maxDev = Math.max(maxDev, Math.abs(px({ width: W, data: out.result }, x, y)[0] - 188))
    expect(maxDev).toBeLessThanOrEqual(4)
  })

  it('verification catches any modified pixel outside the mask', () => {
    const original = room()
    const engine = new VisualizerEngine(original)
    engine.setMask('s1', 1, wardrobeMask().data)
    const out = engine.render({
      surfaces: [{ id: 's1', quad: null, widthMm: 1, heightMm: 1, feather: 0, assignment: baseAssignment('p'), material: { kind: 'paint', colorHex: '#123456' } }],
    })
    expect(out.report.ok).toBe(true)
    out.result[(5 * W + 5) * 4] ^= 1
    const report = verifyComposite(original, out.result, out.editMask)
    expect(report.ok).toBe(false)
    expect(report.changedOutsideMask).toBe(1)
    expect(report.firstViolation).toEqual({ x: 5, y: 5 })
  })

  it('composites multiple surfaces in order and reports surfaces without masks', () => {
    const original = room()
    const engine = new VisualizerEngine(original)
    engine.setMask('s1', 1, wardrobeMask().data)
    const wall = createMask(W, H)
    fillPolygon(wall, [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 240 }, { x: 0, y: 240 }], 'add')
    engine.setMask('wall', 1, wall.data)
    const out = engine.render({
      surfaces: [
        { id: 's1', quad: null, widthMm: 1, heightMm: 1, feather: 0, assignment: baseAssignment('p'), material: { kind: 'paint', colorHex: '#ff0000' } },
        { id: 'wall', quad: null, widthMm: 1, heightMm: 1, feather: 0, assignment: baseAssignment('p'), material: { kind: 'paint', colorHex: '#0000ff' } },
        { id: 'ghost', quad: null, widthMm: 1, heightMm: 1, feather: 0, assignment: baseAssignment('p'), material: { kind: 'paint', colorHex: '#00ff00' } },
      ],
    })
    expect(out.skipped.map((s) => s.id)).toEqual(['ghost'])
    expect(px({ width: W, data: out.result }, 40, 120)).toEqual(hexToRgb('#0000ff'))
    expect(out.report.ok).toBe(true)
    expect(out.report.editablePixels).toBe(160 * 160 + 80 * 240)
  })
})
