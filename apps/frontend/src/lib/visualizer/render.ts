import { SRGB_TO_LINEAR, hexToRgb, linearToSrgb8 } from './color'
import { sampleTrilinear } from './material'
import { LOG_EPS, type ShadingField } from './shading'
import type { BBox, Finish, Mat3, RGBAImage, TileSettings, VerificationReport } from './types'

export type RenderMaterial =
  | { kind: 'paint'; colorHex: string }
  | { kind: 'texture'; levels: RGBAImage[]; widthMm: number; heightMm: number }

export interface RenderParams {
  pattern: 'continuous' | 'tiles'
  rotationDeg: number
  offsetXMm: number
  offsetYMm: number
  scale: number
  finish: Finish
  shading: number
  detail: number
  exposure: number
  tile: TileSettings
}

export interface SurfaceRenderInput {
  /** Effective alpha (feathered, protect-subtracted), full image size. */
  alpha: Uint8Array
  bbox: BBox
  shading: ShadingField
  /** Image pixel → plane millimetres. Required for textures; ignored for paint. */
  imageToPlane: Mat3 | null
  material: RenderMaterial
  params: RenderParams
}

/** Deterministic per-tile hash → [0, 1). */
function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Renders one surface and composites it into `out` (which starts as a copy of the
 * original). Pixels with alpha 0 are never written, which is what makes the
 * "unselected areas stay byte-identical" guarantee hold by construction.
 *
 * Hot loop: the image→plane homography is evaluated incrementally along each row
 * (numerator and denominator are linear in x) and lighting is read from
 * precomputed grids, so the per-pixel cost is a few divides plus texture reads.
 */
export function renderSurface(original: RGBAImage, out: Uint8ClampedArray, s: SurfaceRenderInput): void {
  const { width: w, data: src } = original
  const { alpha, bbox, shading: f, params: p, material } = s

  const ks = p.shading
  const kd = p.detail
  const exposure = p.exposure
  const finish = p.finish
  const col = new Float32Array(3)

  // Lighting grids: S = lighting relative to reference, Sk = S^ks (pre-exponentiated).
  const n = f.gw * f.gh
  const Sg = new Float32Array(n)
  const Skg = new Float32Array(n)
  for (let c = 0; c < n; c++) {
    Sg[c] = Math.exp(f.logS[c])
    Skg[c] = Math.exp(ks * f.logS[c])
  }
  const invRef = 1 / Math.exp(f.logRef)
  const gw = f.gw
  const gh = f.gh
  const gs = f.scale

  let paint: [number, number, number] | null = null
  if (material.kind === 'paint') {
    const [r, g, b] = hexToRgb(material.colorHex)
    paint = [SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b]]
  }

  const tex = material.kind === 'texture' ? material : null
  if (tex && !s.imageToPlane) throw new Error('Texture surfaces need a perspective quad')
  const theta = (p.rotationDeg * Math.PI) / 180
  const cr = Math.cos(theta) / p.scale
  const sr = Math.sin(theta) / p.scale
  const ox = p.offsetXMm
  const oy = p.offsetYMm
  const tiles = tex !== null && p.pattern === 'tiles'
  const tileW = tex ? tex.widthMm : 1
  const tileH = tex ? tex.heightMm : 1
  const grout = tiles ? Math.max(0, p.tile.groutMm) : 0
  const pitchX = tileW + grout
  const pitchY = tileH + grout
  const layout = p.tile.layout
  const variation = p.tile.variation
  const [gr8, gg8, gb8] = hexToRgb(p.tile.groutColor)
  const groutR = SRGB_TO_LINEAR[gr8]
  const groutG = SRGB_TO_LINEAR[gg8]
  const groutB = SRGB_TO_LINEAR[gb8]
  const texW = tex ? tex.levels[0].width : 1
  const texH = tex ? tex.levels[0].height : 1
  const hm = s.imageToPlane ?? new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
  const h0 = hm[0], h1 = hm[1], h2 = hm[2], h3 = hm[3], h4 = hm[4], h5 = hm[5], h6 = hm[6], h7 = hm[7], h8 = hm[8]

  for (let y = bbox.y0; y < bbox.y1; y++) {
    // Shading-grid row weights
    const gyf = (y + 0.5 - bbox.y0) * gs - 0.5
    const gy0 = gyf <= 0 ? 0 : Math.min(gh - 1, Math.floor(gyf))
    const gy1 = Math.min(gh - 1, gy0 + 1)
    const ty = Math.max(0, Math.min(1, gyf - gy0))
    const r0 = gy0 * gw
    const r1 = gy1 * gw

    // Homogeneous plane coordinates at (x0 + ½, y + ½) and one row below.
    const cx = bbox.x0 + 0.5
    const cy = y + 0.5
    let nx = h0 * cx + h1 * cy + h2
    let ny = h3 * cx + h4 * cy + h5
    let nw = h6 * cx + h7 * cy + h8
    let dx = nx + h1
    let dy = ny + h4
    let dw = nw + h7

    for (let x = bbox.x0; x < bbox.x1; x++, nx += h0, ny += h3, nw += h6, dx += h0, dy += h3, dw += h6) {
      const pi = y * w + x
      const a = alpha[pi]
      if (a === 0) continue
      const i = pi * 4

      // ── albedo (linear RGB) ──
      if (paint) {
        col[0] = paint[0]
        col[1] = paint[1]
        col[2] = paint[2]
      } else if (tex) {
        const u0 = nx / nw
        const v0 = ny / nw
        const wn = nw + h6
        const du1 = (nx + h0) / wn - u0
        const dv1 = (ny + h3) / wn - v0
        const du2 = dx / dw - u0
        const dv2 = dy / dw - v0
        // plane mm → material mm (rotation, offset and scale are linear)
        const ea = u0 - ox
        const eb = v0 - oy
        const ms = ea * cr + eb * sr
        const mt = -ea * sr + eb * cr
        // Screen-pixel footprint in material mm, for mip selection and grout AA.
        const fs = Math.max(Math.abs(du1 * cr + dv1 * sr), Math.abs(du2 * cr + dv2 * sr), 1e-9)
        const ft = Math.max(Math.abs(-du1 * sr + dv1 * cr), Math.abs(-du2 * sr + dv2 * cr), 1e-9)
        const tpp = Math.max((fs / tileW) * texW, (ft / tileH) * texH)

        if (!tiles) {
          sampleTrilinear(tex.levels, ms / tileW, mt / tileH, tpp, true, col)
        } else {
          let sx = ms
          let sy = mt
          let row: number
          let column: number
          if (layout === 'stack90') {
            column = Math.floor(sx / pitchX)
            sy -= (((column % 2) + 2) % 2) * 0.5 * pitchY
            row = Math.floor(sy / pitchY)
          } else {
            row = Math.floor(sy / pitchY)
            if (layout === 'brick50') sx -= (((row % 2) + 2) % 2) * 0.5 * pitchX
            else if (layout === 'brick33') sx -= ((((row % 3) + 3) % 3) / 3) * pitchX
            column = Math.floor(sx / pitchX)
          }
          let lx = sx - column * pitchX
          let ly = sy - row * pitchY
          // Box-filtered coverage of tile vs. grout (anti-aliased grout lines).
          const dX = lx < tileW ? Math.min(lx, tileW - lx) : -Math.min(lx - tileW, pitchX - lx)
          const dY = ly < tileH ? Math.min(ly, tileH - ly) : -Math.min(ly - tileH, pitchY - ly)
          const cov = grout > 0 ? clamp01(0.5 + dX / fs) * clamp01(0.5 + dY / ft) : 1
          if (cov > 0) {
            lx = lx < 0 ? 0 : lx > tileW ? tileW : lx
            ly = ly < 0 ? 0 : ly > tileH ? tileH : ly
            let u = lx / tileW
            let v = ly / tileH
            if (variation) {
              const hsh = hash2(row, column)
              if (hsh < 0.5) {
                // 180° rotation keeps a tile's print intact
                u = 1 - u
                v = 1 - v
              }
              if (hsh >= 0.25 && hsh < 0.75) u = 1 - u // mirror
            }
            sampleTrilinear(tex.levels, u, v, tpp, false, col)
            if (cov < 1) {
              col[0] = groutR + (col[0] - groutR) * cov
              col[1] = groutG + (col[1] - groutG) * cov
              col[2] = groutB + (col[2] - groutB) * cov
            }
          } else {
            col[0] = groutR
            col[1] = groutG
            col[2] = groutB
          }
        }
      }

      // ── lighting from the original render ──
      const gxf = (x + 0.5 - bbox.x0) * gs - 0.5
      const gx0 = gxf <= 0 ? 0 : Math.min(gw - 1, Math.floor(gxf))
      const gx1 = Math.min(gw - 1, gx0 + 1)
      const tx = Math.max(0, Math.min(1, gxf - gx0))
      const w00 = (1 - tx) * (1 - ty)
      const w10 = tx * (1 - ty)
      const w01 = (1 - tx) * ty
      const w11 = tx * ty
      let light = Skg[r0 + gx0] * w00 + Skg[r0 + gx1] * w10 + Skg[r1 + gx0] * w01 + Skg[r1 + gx1] * w11
      // Original luminance relative to the reference level = S × fine detail.
      const rel =
        (0.2126 * SRGB_TO_LINEAR[src[i]] + 0.7152 * SRGB_TO_LINEAR[src[i + 1]] + 0.0722 * SRGB_TO_LINEAR[src[i + 2]] + LOG_EPS) * invRef
      if (kd > 0) {
        const S = Sg[r0 + gx0] * w00 + Sg[r0 + gx1] * w10 + Sg[r1 + gx0] * w01 + Sg[r1 + gx1] * w11
        let D = rel / S
        D = D < 0.02 ? 0.02 : D > 7 ? 7 : D
        light *= Math.pow(D, kd)
      }
      light *= exposure
      // Highlights: where the original is brighter than the reference level.
      const hl = rel > 1 ? rel - 1 : 0
      let spec = 0
      if (finish === 'matte') light /= 1 + 0.6 * hl * ks
      else if (finish === 'gloss') spec = 0.35 * hl * ks * exposure

      const nr = linearToSrgb8(col[0] * light + spec)
      const ng = linearToSrgb8(col[1] * light + spec)
      const nb = linearToSrgb8(col[2] * light + spec)

      // ── protected compositing ──
      if (a === 255) {
        out[i] = nr
        out[i + 1] = ng
        out[i + 2] = nb
      } else {
        const t = a / 255
        out[i] = Math.round(out[i] + (nr - out[i]) * t)
        out[i + 1] = Math.round(out[i + 1] + (ng - out[i + 1]) * t)
        out[i + 2] = Math.round(out[i + 2] + (nb - out[i + 2]) * t)
      }
    }
  }
}

/**
 * Compares the composite against the original: every pixel where `editMask` is 0
 * must be byte-identical (all four channels).
 */
export function verifyComposite(original: RGBAImage, result: Uint8ClampedArray, editMask: Uint8Array): VerificationReport {
  const a = original.data
  const total = original.width * original.height
  let editable = 0
  let changedOutside = 0
  let changedInside = 0
  let first: { x: number; y: number } | null = null
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    const differs = a[i] !== result[i] || a[i + 1] !== result[i + 1] || a[i + 2] !== result[i + 2] || a[i + 3] !== result[i + 3]
    if (editMask[p]) {
      editable++
      if (differs) changedInside++
    } else if (differs) {
      changedOutside++
      if (!first) first = { x: p % original.width, y: Math.floor(p / original.width) }
    }
  }
  return {
    ok: changedOutside === 0,
    width: original.width,
    height: original.height,
    totalPixels: total,
    editablePixels: editable,
    protectedPixels: total - editable,
    changedOutsideMask: changedOutside,
    changedInsideMask: changedInside,
    firstViolation: first,
    verifiedBy: 'client',
  }
}
