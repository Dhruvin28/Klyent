import { config } from '../../config'
import { ExtractionError, type ExtractedPage } from './common'
import { extractDxf } from './dxf'
import { extractImage } from './image'
import { extractPdf } from './pdf'

export type DocumentKind = 'pdf' | 'image' | 'dxf'

/** Signature-based preflight (plan §6.3): never trust the browser's MIME type. */
export function sniffDocument(buf: Buffer, filename: string): { kind: DocumentKind; mime: string } | { error: string; code: string } {
  if (buf.length < 16) return { code: 'EMPTY_INPUT', error: 'The file is empty.' }
  const head = buf.subarray(0, 16)
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') {
    if (buf.length > config.interior.maxUploadBytes) return { code: 'TOO_LARGE', error: `PDFs are limited to ${config.interior.maxUploadBytes / 1024 / 1024} MB.` }
    return { kind: 'pdf', mime: 'application/pdf' }
  }
  const img =
    head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG'
      ? 'image/png'
      : head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
        ? 'image/jpeg'
        : head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
          ? 'image/webp'
          : head.subarray(0, 2).toString('latin1') === 'II' || head.subarray(0, 2).toString('latin1') === 'MM'
            ? 'image/tiff'
            : null
  if (img) {
    if (buf.length > config.interior.maxRasterBytes) return { code: 'TOO_LARGE', error: `Images are limited to ${config.interior.maxRasterBytes / 1024 / 1024} MB.` }
    return { kind: 'image', mime: img }
  }
  if (head.subarray(0, 6).toString('latin1') === 'AC1015' || /^AC10\d\d/.test(head.subarray(0, 6).toString('latin1'))) {
    return {
      code: 'DWG_NOT_SUPPORTED',
      error: 'DWG files need the licensed CAD adapter, which is not installed. Export the drawing as DXF (ASCII) or a vector PDF from your CAD tool and upload that.',
    }
  }
  if (/\.dxf$/i.test(filename)) {
    const text = buf.subarray(0, 2048).toString('latin1')
    if (text.startsWith('AutoCAD Binary DXF')) return { code: 'UNSUPPORTED_FORMAT', error: 'Binary DXF is not supported. Save as ASCII DXF.' }
    if (/^\s*0\s*\r?\n\s*SECTION/m.test(text) || /^\s*999\s*\r?\n/.test(text)) {
      if (buf.length > config.interior.maxUploadBytes) return { code: 'TOO_LARGE', error: 'The DXF is too large.' }
      return { kind: 'dxf', mime: 'image/vnd.dxf' }
    }
  }
  return { code: 'UNSUPPORTED_FORMAT', error: 'Unsupported file. Upload PDF drawings, DXF (ASCII) files, or JPG/PNG images of drawings.' }
}

export async function extractDocument(buf: Buffer, kind: DocumentKind, mime: string, onPage?: (i: number, total: number) => Promise<void>): Promise<ExtractedPage[]> {
  if (kind === 'pdf') return extractPdf(buf, onPage)
  if (kind === 'dxf') return extractDxf(buf)
  if (kind === 'image') return extractImage(buf, mime)
  throw new ExtractionError('UNSUPPORTED_FORMAT', 'Unsupported document type.')
}

export { ExtractionError, type ExtractedPage }
