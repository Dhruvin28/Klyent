import type { RGBAImage } from './types'

export const MAX_SIDE = 8192
export const MAX_PIXELS = 25_000_000

function canvas2d(w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' } as CanvasRenderingContext2DSettings)
  if (!ctx) throw new Error('Your browser does not support the canvas features this tool needs.')
  return { canvas, ctx: ctx as OffscreenCanvasRenderingContext2D }
}

/**
 * Decodes an uploaded image the way it is displayed: EXIF orientation applied and
 * any embedded colour profile converted to sRGB. Transparent areas are flattened
 * onto white so the result is fully opaque.
 */
export async function decodeForDisplay(file: Blob): Promise<RGBAImage> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'default', colorSpaceConversion: 'default' })
  } catch {
    throw new Error('This file could not be read as an image. Use JPG, PNG or WebP.')
  }
  const { width, height } = bmp
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    bmp.close()
    throw new Error(`Image is ${width}×${height}. The maximum is ${MAX_SIDE}px per side and ${MAX_PIXELS / 1e6} megapixels.`)
  }
  if (width < 16 || height < 16) {
    bmp.close()
    throw new Error('Image is too small.')
  }
  const { ctx } = canvas2d(width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const data = ctx.getImageData(0, 0, width, height).data
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  return { width, height, data }
}

/** Decodes a PNG produced by encodePng bit-exactly (no colour conversion, no premultiply). */
export async function decodePngExact(blob: Blob): Promise<RGBAImage> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none' } as ImageBitmapOptions)
  const { width, height } = bmp
  const { ctx } = canvas2d(width, height)
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return { width, height, data: ctx.getImageData(0, 0, width, height).data }
}

export async function encodePng(img: RGBAImage): Promise<Blob> {
  const { canvas, ctx } = canvas2d(img.width, img.height)
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

export async function encodeJpegThumbnail(img: RGBAImage, maxSide = 480): Promise<Blob> {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height))
  const { canvas: full, ctx } = canvas2d(img.width, img.height)
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  const w = Math.max(1, Math.round(img.width * s))
  const h = Math.max(1, Math.round(img.height * s))
  const thumb = new OffscreenCanvas(w, h)
  const tctx = thumb.getContext('2d')!
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(full, 0, 0, w, h)
  return thumb.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Builds the lossless reference for a new project: the decoded, orientation-
 * corrected, opaque pixel grid, encoded as PNG — then decoded again and compared
 * to guarantee the stored reference is bit-identical to what we edit against.
 */
export async function createReference(file: File): Promise<{ pixels: RGBAImage; reference: Blob; thumbnail: Blob }> {
  const pixels = await decodeForDisplay(file)
  const reference = await encodePng(pixels)
  const check = await decodePngExact(reference)
  if (check.width !== pixels.width || check.height !== pixels.height || !samePixels(check.data, pixels.data)) {
    throw new Error('This browser altered pixels while encoding the reference image. Please use a current Chrome, Edge or Firefox.')
  }
  const thumbnail = await encodeJpegThumbnail(pixels)
  return { pixels, reference, thumbnail }
}
