import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
// pdf-parse has no types with default export typing issues under strict mode; require() avoids that.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse')
import { createWorker } from 'tesseract.js'

export interface ExtractionResult {
  text: string
  ocrUsed: boolean
}

export async function extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<ExtractionResult> {
  const lower = fileName.toLowerCase()

  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    return extractFromPdf(buffer)
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    const result = await mammoth.extractRawText({ buffer })
    return { text: result.value, ocrUsed: false }
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.csv')
  ) {
    return { text: extractFromSpreadsheet(buffer), ocrUsed: false }
  }

  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(lower)) {
    return extractFromImage(buffer)
  }

  if (mimeType === 'text/plain' || lower.endsWith('.txt')) {
    return { text: buffer.toString('utf-8'), ocrUsed: false }
  }

  // Unknown type: try utf-8 as a last resort rather than failing outright.
  return { text: buffer.toString('utf-8'), ocrUsed: false }
}

async function extractFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const data = await pdfParse(buffer)
    const text = (data.text || '').trim()
    // Likely a scanned PDF with no text layer if this is short -- OCR-for-
    // scanned-PDFs (PDF -> image -> OCR) is a later-phase item, not MVP.
    return { text, ocrUsed: false }
  } catch (err) {
    console.error('PDF extraction failed:', err)
    return { text: '', ocrUsed: false }
  }
}

function extractFromSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    parts.push(`--- Sheet: ${sheetName} ---\n${csv}`)
  }
  return parts.join('\n\n')
}

async function extractFromImage(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const worker = await createWorker('eng')
    const {
      data: { text },
    } = await worker.recognize(buffer)
    await worker.terminate()
    return { text: text.trim(), ocrUsed: true }
  } catch (err) {
    console.error('Image OCR failed:', err)
    return { text: '', ocrUsed: true }
  }
}
