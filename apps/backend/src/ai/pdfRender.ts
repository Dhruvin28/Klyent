// mupdf is ESM-only; the backend compiles to CommonJS, so load it with a real dynamic import.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importEsm = new Function('s', 'return import(s)') as (s: string) => Promise<any>

let mupdfPromise: Promise<any> | null = null
const loadMupdf = () => (mupdfPromise ??= importEsm('mupdf'))

/**
 * Rasterise PDF pages to PNG so the image model can actually *see* the drawing.
 * (The image API cannot read PDFs; without this the plan never reaches the renderer.)
 */
export async function renderPdfPages(buffer: Buffer, opts: { maxPages?: number; longSide?: number } = {}): Promise<Buffer[]> {
  const { maxPages = 6, longSide = 2048 } = opts
  const mupdf = await loadMupdf()
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  const out: Buffer[] = []
  try {
    const count = Math.min(doc.countPages(), maxPages)
    for (let i = 0; i < count; i++) {
      const page = doc.loadPage(i)
      try {
        const [x0, y0, x1, y1] = page.getBounds()
        const scale = longSide / Math.max(x1 - x0, y1 - y0, 1)
        const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
        out.push(Buffer.from(pix.asPNG()))
        pix.destroy?.()
      } finally {
        page.destroy?.()
      }
    }
  } finally {
    doc.destroy?.()
  }
  return out
}
