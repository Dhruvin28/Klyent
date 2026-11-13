import { PNG } from 'pngjs'
import { createWorker, PSM } from 'tesseract.js'
import type { TextToken } from '../contracts'

type RawToken = Omit<TextToken, 'id'>

/** Rotates an RGBA PNG 90° clockwise (so vertical dimension text reads horizontally). */
function rotateCw(png: Buffer): { data: Buffer; width: number; height: number } {
  const src = PNG.sync.read(png)
  const { width: w, height: h } = src
  const out = new PNG({ width: h, height: w })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4
      // (x, y) → (h - 1 - y, x)
      const di = (x * h + (h - 1 - y)) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = 255
    }
  }
  return { data: PNG.sync.write(out), width: h, height: w }
}

interface OcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

async function recognizeWords(worker: Awaited<ReturnType<typeof createWorker>>, image: Buffer): Promise<OcrWord[][]> {
  const { data } = await worker.recognize(image, {}, { blocks: true })
  const lines: OcrWord[][] = []
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        lines.push((l.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })))
      }
    }
  }
  return lines
}

const UNIT_WORD = /^(mm|cm|m|mtr|ft|in|"|')\.?$/i

/** Joins words on a line when they belong together ("3600 mm", "9' 6\""). */
function mergeLine(words: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = []
  for (const w of words) {
    const prev = out[out.length - 1]
    const h = w.bbox.y1 - w.bbox.y0
    if (prev && w.bbox.x0 - prev.bbox.x1 < h * 0.8 && (UNIT_WORD.test(w.text) || (/['"]$/.test(prev.text) && /^\d/.test(w.text)))) {
      prev.text = `${prev.text} ${w.text}`
      prev.confidence = Math.min(prev.confidence, w.confidence)
      prev.bbox = { x0: prev.bbox.x0, y0: Math.min(prev.bbox.y0, w.bbox.y0), x1: w.bbox.x1, y1: Math.max(prev.bbox.y1, w.bbox.y1) }
    } else {
      out.push({ ...w, bbox: { ...w.bbox } })
    }
  }
  return out
}

/**
 * OCR for raster drawings (plan §7.3). Runs sparse-text segmentation on the page and on
 * the page rotated 90° so vertical dimension strings are read too. Tokens carry OCR
 * confidence; downstream calibration treats them as lower-authority evidence.
 */
export async function ocrImage(png: Buffer, width: number, height: number): Promise<{ tokens: RawToken[]; warnings: string[] }> {
  const warnings: string[] = []
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null
  try {
    worker = await createWorker('eng')
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' })
    const tokens: RawToken[] = []
    const accept = (w: OcrWord) => w.text.trim().length > 0 && w.confidence >= 45 && /[A-Za-z0-9]/.test(w.text)

    for (const line of await recognizeWords(worker, png)) {
      for (const w of mergeLine(line)) {
        if (!accept(w)) continue
        tokens.push({ text: w.text.trim(), bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1], source: 'ocr', confidence: w.confidence / 100, vertical: false })
      }
    }

    // Rotated pass: only keep numeric tokens (vertical dimension strings).
    if (width * height <= 16_000_000) {
      const rot = rotateCw(png)
      for (const line of await recognizeWords(worker, rot.data)) {
        for (const w of mergeLine(line)) {
          if (!accept(w) || !/\d/.test(w.text)) continue
          // Rotated (rx, ry) → original: x = ry, y = height - 1 - rx
          const xs = [w.bbox.y0, w.bbox.y1]
          const ys = [height - 1 - w.bbox.x0, height - 1 - w.bbox.x1]
          const bbox: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
          // Skip duplicates of tokens already read horizontally.
          const dup = tokens.some((t) => t.text === w.text.trim() && Math.abs(t.bbox[0] - bbox[0]) < 20 && Math.abs(t.bbox[1] - bbox[1]) < 20)
          if (!dup) tokens.push({ text: w.text.trim(), bbox, source: 'ocr', confidence: w.confidence / 100, vertical: true })
        }
      }
    }
    if (!tokens.length) warnings.push('OCR found no readable text on this page.')
    return { tokens, warnings }
  } catch (err) {
    warnings.push(`OCR failed: ${(err as Error)?.message ?? 'unknown error'}. Text-based dimensions are unavailable for this page.`)
    return { tokens: [], warnings }
  } finally {
    await worker?.terminate().catch(() => undefined)
  }
}
