import crypto from 'crypto'
import { PNG } from 'pngjs'
import { config } from '../config'

export class VizImageError extends Error {
  statusCode = 422
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export function isPng(buf: Buffer): boolean {
  return buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIG)
}

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

export function isWebp(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
}

/** Sniffs the real image type from magic bytes — never trust the client-declared mimetype. */
export function sniffImageMime(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (isPng(buf)) return 'image/png'
  if (isJpeg(buf)) return 'image/jpeg'
  if (isWebp(buf)) return 'image/webp'
  return null
}

/** Reads width/height from the IHDR chunk without decoding pixel data. */
export function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (!isPng(buf) || buf.toString('ascii', 12, 16) !== 'IHDR') throw new VizImageError('Not a valid PNG file.')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

export function assertWorkingSize(width: number, height: number) {
  const { maxSide, maxPixels } = config.visualizer
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
    throw new VizImageError('Image is too small (minimum 16×16 pixels).')
  }
  if (width > maxSide || height > maxSide || width * height > maxPixels) {
    throw new VizImageError(
      `Image is too large (${width}×${height}). Maximum is ${maxSide}px per side and ${(maxPixels / 1e6).toFixed(0)} megapixels.`
    )
  }
}

/** Fully decodes a PNG (validates CRCs and structure). Returns 8-bit RGBA. */
export function decodePng(buf: Buffer, label: string): { width: number; height: number; data: Buffer } {
  const { width, height } = pngDimensions(buf)
  assertWorkingSize(width, height)
  try {
    const png = PNG.sync.read(buf, { checkCRC: true })
    return { width: png.width, height: png.height, data: png.data }
  } catch (err) {
    throw new VizImageError(`${label} could not be decoded as PNG: ${(err as Error).message}`)
  }
}

export interface VerificationReport {
  ok: boolean
  width: number
  height: number
  totalPixels: number
  editablePixels: number
  protectedPixels: number
  changedOutsideMask: number
  changedInsideMask: number
  firstViolation: { x: number; y: number } | null
  /** Edit-mask pixels outside the saved surface selections (should be 0). */
  maskOutsideSurfaces: number
  /** Edit-mask pixels on fully protected areas (should be 0). */
  maskOnProtected: number
  referenceSha256: string
  resultSha256: string
  verifiedAt: string
  verifiedBy: 'server'
}

export interface MaskConstraints {
  /** Saved surface masks (PNG) of every surface the option assigns a material to. */
  surfaceMasks: Buffer[]
  /** Saved protect mask (PNG), if any. */
  protectMask: Buffer | null
  /** How far feathering may spread a selection, in pixels. */
  spread: number
}

/**
 * Binary dilation by a (2r+1)² square, O(N) via running counts. Returns 1 where any
 * set pixel lies within r (Chebyshev distance).
 */
function dilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return bin
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let count = 0
    for (let x = 0; x <= Math.min(r, w - 1); x++) count += bin[row + x]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = count > 0 ? 1 : 0
      if (x + r + 1 < w) count += bin[row + x + r + 1]
      if (x - r >= 0) count -= bin[row + x - r]
    }
  }
  const out = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) {
    let count = 0
    for (let y = 0; y <= Math.min(r, h - 1); y++) count += tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = count > 0 ? 1 : 0
      if (y + r + 1 < h) count += tmp[(y + r + 1) * w + x]
      if (y - r >= 0) count -= tmp[(y - r) * w + x]
    }
  }
  return out
}

/**
 * Independent server-side check of the core guarantee: every pixel outside the
 * editing mask must be byte-identical (RGB and alpha) to the reference render.
 * The mask is the union of all surfaces' effective (feathered, protect-subtracted)
 * alpha — any non-zero mask value marks a pixel the compositor was allowed to touch.
 *
 * Because that mask comes from the client, it is itself checked against the
 * project's saved selections: it may not extend beyond the saved surface masks
 * (plus feathering spread) and may not touch fully protected pixels.
 */
export function verifyComposite(reference: Buffer, result: Buffer, mask: Buffer, constraints?: MaskConstraints): VerificationReport {
  const ref = decodePng(reference, 'Reference render')
  const res = decodePng(result, 'Exported image')
  if (res.width !== ref.width || res.height !== ref.height) {
    throw new VizImageError(`Exported image is ${res.width}×${res.height} but the reference is ${ref.width}×${ref.height}.`)
  }
  const msk = decodePng(mask, 'Edit mask')
  if (msk.width !== ref.width || msk.height !== ref.height) {
    throw new VizImageError('Edit mask dimensions do not match the reference render.')
  }

  const W = ref.width
  const H = ref.height
  const total = W * H
  let allowed: Uint8Array | null = null
  let forbidden: Uint8Array | null = null
  if (constraints) {
    const union = new Uint8Array(total)
    for (const buf of constraints.surfaceMasks) {
      const sm = decodePng(buf, 'Saved surface mask')
      if (sm.width !== W || sm.height !== H) throw new VizImageError('Saved surface mask size mismatch.')
      for (let p = 0; p < total; p++) if (sm.data[p * 4]) union[p] = 1
    }
    allowed = dilate(union, W, H, Math.ceil(constraints.spread))
    if (constraints.protectMask) {
      const pm = decodePng(constraints.protectMask, 'Saved protect mask')
      if (pm.width !== W || pm.height !== H) throw new VizImageError('Saved protect mask size mismatch.')
      forbidden = new Uint8Array(total)
      for (let p = 0; p < total; p++) if (pm.data[p * 4] === 255) forbidden[p] = 1
    }
  }

  const a = ref.data
  const b = res.data
  const m = msk.data
  let maskOutsideSurfaces = 0
  let maskOnProtected = 0
  let editable = 0
  let changedOutside = 0
  let changedInside = 0
  let first: { x: number; y: number } | null = null
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    const differs = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]
    if (m[i] !== 0) {
      editable++
      if (differs) changedInside++
      if (allowed && !allowed[p]) maskOutsideSurfaces++
      if (forbidden && forbidden[p]) maskOnProtected++
    } else if (differs) {
      changedOutside++
      if (!first) first = { x: p % ref.width, y: Math.floor(p / ref.width) }
    }
  }

  return {
    ok: changedOutside === 0 && maskOutsideSurfaces === 0 && maskOnProtected === 0,
    width: ref.width,
    height: ref.height,
    totalPixels: total,
    editablePixels: editable,
    protectedPixels: total - editable,
    changedOutsideMask: changedOutside,
    changedInsideMask: changedInside,
    firstViolation: first,
    maskOutsideSurfaces,
    maskOnProtected,
    referenceSha256: sha256(reference),
    resultSha256: sha256(result),
    verifiedAt: new Date().toISOString(),
    verifiedBy: 'server',
  }
}

/**
 * Decoding a 25MP PNG costs ~100MB per image; serialise the heavy decode work so
 * concurrent exports cannot multiply peak memory on a small App Service plan.
 */
let chain: Promise<unknown> = Promise.resolve()
export function runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}
