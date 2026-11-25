import { config } from '../../config'
import { unitsFromNotes } from '../dimensions'
import type { PageExtraction, TextToken } from '../contracts'
import { ExtractionError, SegmentSink, loadMupdf, numberTokens, pickScale, renderPage, type ExtractedPage } from './common'
import { ocrImage } from './ocr'

type Mat = [number, number, number, number, number, number]

const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

function isNearWhite(color: number[] | null | undefined) {
  return !!color && color.length > 0 && color.length <= 3 && color.every((c) => c > 0.95)
}

/**
 * PDF → pages (plan §7.2): renders each page, extracts positioned text with exact
 * coordinates, and walks every stroked/filled path through a MuPDF device so walls can
 * later be snapped to the real CAD line work. Scanned pages fall back to OCR.
 */
export async function extractPdf(buffer: Buffer, onPage?: (i: number, total: number) => Promise<void>): Promise<ExtractedPage[]> {
  const mupdf = await loadMupdf()
  let doc: any
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  } catch {
    throw new ExtractionError('CORRUPT_INPUT', 'The PDF could not be opened. It may be corrupted.')
  }
  try {
    if (doc.needsPassword?.()) throw new ExtractionError('PASSWORD_PROTECTED', 'The PDF is password protected. Upload an unprotected copy.')
    const total = doc.countPages()
    if (total < 1) throw new ExtractionError('EMPTY_INPUT', 'The PDF has no pages.')
    if (total > config.interior.maxPdfPages) {
      throw new ExtractionError('TOO_MANY_PAGES', `The PDF has ${total} pages; the limit is ${config.interior.maxPdfPages}. Split the set or upload only the relevant sheets.`)
    }
    const pages: ExtractedPage[] = []
    for (let i = 0; i < total; i++) {
      await onPage?.(i, total)
      const page = doc.loadPage(i)
      try {
        pages.push(await extractPdfPage(mupdf, page, i))
      } finally {
        page.destroy?.()
      }
    }
    return pages
  } finally {
    doc.destroy?.()
  }
}

async function extractPdfPage(mupdf: any, page: any, pageIndex: number): Promise<ExtractedPage> {
  const [bx0, by0, bx1, by1] = page.getBounds() as number[]
  const widthPt = bx1 - bx0
  const heightPt = by1 - by0
  const ic = config.interior
  const s = pickScale(widthPt, heightPt, ic.pageLongSide, Math.min(ic.maxDecodedPixels, 12_000_000))
  const full = renderPage(mupdf, page, s, 'png')
  const ps = Math.min(1, ic.previewLongSide / Math.max(full.width, full.height))
  const prev = renderPage(mupdf, page, s * ps, 'jpeg')
  const toPx = (x: number, y: number): [number, number] => [x * s - full.originX, y * s - full.originY]

  // ── Vector line work ──
  const sink = new SegmentSink(ic.maxVectorSegments)
  let imageCover = 0
  const walk = (path: any, ctm: Mat, lineWidth: number) => {
    let start: [number, number] | null = null
    let cur: [number, number] | null = null
    const lineTo = (p: [number, number]) => {
      if (cur) {
        const a = toPx(cur[0], cur[1])
        const b = toPx(p[0], p[1])
        sink.push(a[0], a[1], b[0], b[1], lineWidth)
      }
      cur = p
    }
    path.walk({
      moveTo(x: number, y: number) {
        cur = apply(ctm, x, y)
        start = cur
      },
      lineTo(x: number, y: number) {
        lineTo(apply(ctm, x, y))
      },
      curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
        if (!cur) return
        const p0 = cur
        const c1 = apply(ctm, x1, y1)
        const c2 = apply(ctm, x2, y2)
        const p3 = apply(ctm, x3, y3)
        for (let k = 1; k <= 4; k++) {
          const t = k / 4
          const u = 1 - t
          lineTo([
            u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
          ])
        }
      },
      closePath() {
        if (start && cur && (start[0] !== cur[0] || start[1] !== cur[1])) lineTo(start)
        cur = start
      },
    })
  }
  const scaleOf = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * s
  const device = new mupdf.Device({
    strokePath(path: any, stroke: any, ctm: Mat, _cs: any, color: number[], alpha: number) {
      if (alpha <= 0.05 || isNearWhite(color)) return
      walk(path, ctm, (stroke?.getLineWidth?.() ?? 1) * scaleOf(ctm))
    },
    fillPath(path: any, _evenOdd: boolean, ctm: Mat, _cs: any, color: number[], alpha: number) {
      if (alpha <= 0.05 || isNearWhite(color)) return
      walk(path, ctm, 0)
    },
    fillImage(_image: any, ctm: Mat) {
      // Image unit square mapped by ctm: area in pt².
      const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])
      imageCover = Math.max(imageCover, area / Math.max(1, widthPt * heightPt))
    },
  })
  try {
    page.run(device, mupdf.Matrix.identity)
  } finally {
    device.close?.()
    device.destroy?.()
  }

  // ── Positioned text ──
  const raw: Omit<TextToken, 'id'>[] = []
  try {
    const st = page.toStructuredText('preserve-whitespace')
    const json = JSON.parse(st.asJSON()) as { blocks: { type: string; lines?: { bbox: { x: number; y: number; w: number; h: number }; text: string }[] }[] }
    st.destroy?.()
    for (const b of json.blocks ?? []) {
      if (b.type !== 'text') continue
      for (const l of b.lines ?? []) {
        const text = (l.text ?? '').replace(/\s+/g, ' ').trim()
        if (!text) continue
        const [x0, y0] = toPx(l.bbox.x, l.bbox.y)
        const [x1, y1] = toPx(l.bbox.x + l.bbox.w, l.bbox.y + l.bbox.h)
        raw.push({ text: text.slice(0, 300), bbox: [x0, y0, x1, y1], source: 'pdf', confidence: 1, vertical: l.bbox.h > l.bbox.w * 1.4 && text.length > 1 })
      }
    }
  } catch {
    // Text extraction failure is not fatal; OCR below may still recover text.
  }

  const warnings: string[] = []
  const scanned = sink.count < 150 && imageCover > 0.5
  let source: PageExtraction['source'] = scanned ? 'pdf_raster' : 'pdf_vector'
  if (!scanned && sink.count < 30 && imageCover <= 0.5) warnings.push('Very little vector line work was found on this page.')
  if (sink.truncated) warnings.push(`Line work was capped at ${config.interior.maxVectorSegments.toLocaleString()} segments; dense hatching may be incomplete.`)
  let tokens = raw
  if (scanned || raw.length === 0) {
    const ocr = await ocrImage(full.data, full.width, full.height)
    tokens = [...raw, ...ocr.tokens]
    warnings.push(...ocr.warnings)
    if (scanned) source = 'pdf_raster'
  }
  const texts = numberTokens(tokens)
  return {
    pageIndex,
    width: full.width,
    height: full.height,
    image: full.data,
    preview: prev.data,
    previewWidth: prev.width,
    previewHeight: prev.height,
    vectors: source === 'pdf_vector' ? sink.toBuffer() : null,
    extraction: {
      version: 1,
      source,
      width: full.width,
      height: full.height,
      previewScale: prev.width / full.width,
      pdf: { widthPt, heightPt, pxPerPt: s },
      dxf: null,
      texts,
      cadDimensions: [],
      vectorCount: source === 'pdf_vector' ? sink.count : 0,
      unitsFromNotes: unitsFromNotes(texts.map((t) => t.text)),
      warnings,
    },
  }
}
