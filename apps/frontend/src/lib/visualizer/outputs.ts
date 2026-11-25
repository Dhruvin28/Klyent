// Shareable image outputs (JPEG for WhatsApp / email, optional watermark). The verified
// lossless PNG export stays the record; these are convenience copies for sending.

export interface Watermark {
  /** Company logo as a data URL (same-origin safe for canvas). */
  logo: string | null
  text: string | null
}

export interface JpegOptions {
  /** Longest side in px; 0 = full resolution. */
  maxSide: number
  quality: number
  watermark?: Watermark | null
}

async function loadImage(src: string): Promise<ImageBitmap | null> {
  try {
    const blob = await (await fetch(src)).blob()
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

/** Draws a discreet logo + name badge in the bottom-right corner. */
async function drawWatermark(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, wm: Watermark) {
  const unit = Math.max(12, Math.round(Math.min(w, h) * 0.035))
  const pad = Math.round(unit * 0.6)
  const logo = wm.logo ? await loadImage(wm.logo) : null
  const logoH = logo ? Math.round(unit * 1.6) : 0
  const logoW = logo ? Math.round((logo.width / logo.height) * logoH) : 0
  ctx.font = `600 ${unit}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
  const text = wm.text?.trim() ?? ''
  const textW = text ? Math.ceil(ctx.measureText(text).width) : 0
  const gap = logo && text ? Math.round(unit * 0.5) : 0
  const boxW = pad * 2 + logoW + gap + textW
  const boxH = pad * 2 + Math.max(logoH, text ? unit * 1.25 : 0)
  if (!logo && !text) return
  const x = w - boxW - pad
  const y = h - boxH - pad
  ctx.save()
  ctx.globalAlpha = 0.78
  ctx.fillStyle = '#ffffff'
  const r = Math.round(unit * 0.4)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r)
  ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r)
  ctx.arcTo(x, y + boxH, x, y, r)
  ctx.arcTo(x, y, x + boxW, y, r)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
  if (logo) ctx.drawImage(logo, x + pad, y + (boxH - logoH) / 2, logoW, logoH)
  if (text) {
    ctx.fillStyle = '#1a1a1a'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + pad + logoW + gap, y + boxH / 2)
  }
  ctx.restore()
  logo?.close()
}

/** Encodes RGBA pixels (or an image blob) as a JPEG, downscaled and optionally watermarked. */
export async function toJpeg(source: { pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } | Blob, o: JpegOptions): Promise<Blob> {
  let bmp: ImageBitmap
  if (source instanceof Blob) bmp = await createImageBitmap(source)
  else bmp = await createImageBitmap(new ImageData(source.pixels, source.width, source.height))
  const s = o.maxSide > 0 ? Math.min(1, o.maxSide / Math.max(bmp.width, bmp.height)) : 1
  const w = Math.max(1, Math.round(bmp.width * s))
  const h = Math.max(1, Math.round(bmp.height * s))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  if (o.watermark) await drawWatermark(ctx, w, h, o.watermark)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: o.quality })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'export'
}
