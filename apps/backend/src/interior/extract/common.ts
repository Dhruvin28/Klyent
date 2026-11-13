import type { PageExtraction, TextToken } from '../contracts'

// mupdf is ESM-only; the backend compiles to CommonJS, so load it with a real dynamic import.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importEsm = new Function('s', 'return import(s)') as (s: string) => Promise<any>
let mupdfPromise: Promise<any> | null = null
export const loadMupdf = () => (mupdfPromise ??= importEsm('mupdf'))

export interface ExtractedPage {
  pageIndex: number
  width: number
  height: number
  image: Buffer // PNG, page px
  preview: Buffer // JPEG, preview px
  previewWidth: number
  previewHeight: number
  extraction: PageExtraction
  /** Float32 [x1, y1, x2, y2, lineWidth] per segment, page px. */
  vectors: Buffer | null
}

export class ExtractionError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false
  ) {
    super(message)
  }
}

/** Collects line segments with a hard cap; drops degenerate ones. */
export class SegmentSink {
  private data: number[] = []
  count = 0
  truncated = false
  constructor(
    private max: number,
    private minLength = 1.5
  ) {}
  push(x1: number, y1: number, x2: number, y2: number, w: number) {
    if (!Number.isFinite(x1 + y1 + x2 + y2)) return
    if (Math.hypot(x2 - x1, y2 - y1) < this.minLength) return
    if (this.count >= this.max) {
      this.truncated = true
      return
    }
    this.data.push(x1, y1, x2, y2, Number.isFinite(w) ? w : 1)
    this.count++
  }
  toBuffer(): Buffer | null {
    if (!this.count) return null
    return Buffer.from(new Float32Array(this.data).buffer)
  }
}

export function readSegments(buf: Buffer | null | undefined): Float32Array {
  if (!buf || !buf.length) return new Float32Array(0)
  const copy = new Uint8Array(buf.length)
  copy.set(buf)
  return new Float32Array(copy.buffer, 0, Math.floor(buf.length / 4))
}

/** Renders a mupdf page at a scale; returns PNG/JPEG and the pixmap origin. */
export function renderPage(mupdf: any, page: any, scale: number, format: 'png' | 'jpeg') {
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
  try {
    const out = format === 'png' ? pix.asPNG() : pix.asJPEG(85, false)
    return { data: Buffer.from(out), width: pix.getWidth() as number, height: pix.getHeight() as number, originX: pix.getX() as number, originY: pix.getY() as number }
  } finally {
    pix.destroy?.()
  }
}

export function pickScale(widthPt: number, heightPt: number, longSide: number, maxPixels: number) {
  let s = longSide / Math.max(widthPt, heightPt, 1)
  if (widthPt * s * heightPt * s > maxPixels) s = Math.sqrt(maxPixels / (widthPt * heightPt))
  return s
}

/** Gives tokens stable per-page ids in reading order (top-to-bottom, left-to-right). */
export function numberTokens(tokens: Omit<TextToken, 'id'>[]): TextToken[] {
  return [...tokens]
    .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
    .map((t, i) => ({ ...t, id: `T${i + 1}` }))
}

/** Text tokens that are worth sending to the model (dimension-like or labels). */
export function rankTokens(tokens: TextToken[], max: number): TextToken[] {
  if (tokens.length <= max) return tokens
  const score = (t: TextToken) => (/\d/.test(t.text) ? 2 : 1) + Math.min(1, t.confidence)
  return [...tokens].sort((a, b) => score(b) - score(a)).slice(0, max)
}
