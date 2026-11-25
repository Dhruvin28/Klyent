import { config } from '../../config'
import { unitsFromNotes } from '../dimensions'
import { ExtractionError, loadMupdf, numberTokens, pickScale, renderPage, type ExtractedPage } from './common'
import { ocrImage } from './ocr'

/**
 * Raster drawing (JPEG/PNG/WebP photo or scan) → one page (plan §7.3). Decoded through
 * MuPDF so every format follows the same path as scanned PDFs; text comes from OCR and
 * line work is recovered later from the pixels (raster wall refinement).
 */
export async function extractImage(buffer: Buffer, mime: string): Promise<ExtractedPage[]> {
  const mupdf = await loadMupdf()
  let doc: any
  try {
    doc = mupdf.Document.openDocument(buffer, mime)
  } catch {
    throw new ExtractionError('UNSUPPORTED_IMAGE', 'This image could not be decoded. Upload a PNG or JPEG.')
  }
  try {
    const page = doc.loadPage(0)
    try {
      const [x0, y0, x1, y1] = page.getBounds() as number[]
      const w = x1 - x0
      const h = y1 - y0
      const ic = config.interior
      // Never upscale beyond ~2× the source; never exceed the decoded-pixel budget.
      const s = Math.min(pickScale(w, h, ic.pageLongSide, Math.min(ic.maxDecodedPixels, 12_000_000)), 2)
      const full = renderPage(mupdf, page, s, 'png')
      if (full.width < 300 || full.height < 300) {
        throw new ExtractionError('LOW_RESOLUTION', 'The image is too small to read dimensions from (minimum 300×300 px).')
      }
      const ps = Math.min(1, ic.previewLongSide / Math.max(full.width, full.height))
      const prev = renderPage(mupdf, page, s * ps, 'jpeg')
      const ocr = await ocrImage(full.data, full.width, full.height)
      const texts = numberTokens(ocr.tokens)
      const warnings = [...ocr.warnings]
      if (Math.max(full.width, full.height) < 1600) warnings.push('Low resolution image: dimensions and wall positions will be less certain.')
      return [
        {
          pageIndex: 0,
          width: full.width,
          height: full.height,
          image: full.data,
          preview: prev.data,
          previewWidth: prev.width,
          previewHeight: prev.height,
          vectors: null,
          extraction: {
            version: 1,
            source: 'image',
            width: full.width,
            height: full.height,
            previewScale: prev.width / full.width,
            pdf: null,
            dxf: null,
            texts,
            cadDimensions: [],
            vectorCount: 0,
            unitsFromNotes: unitsFromNotes(texts.map((t) => t.text)),
            warnings,
          },
        },
      ]
    } finally {
      page.destroy?.()
    }
  } finally {
    doc.destroy?.()
  }
}
