import { PNG } from 'pngjs'

// Small PNG toolbox for the render worker: exposure safety net, mirror (reflected ceiling
// plans) and downscaling for the AI reference. Pure JS so the worker needs nothing but Blender.

const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const toSrgb = (l: number) => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

export function decodePng(buf: Buffer): PNG {
  return PNG.sync.read(buf)
}
export function encodePng(png: PNG): Buffer {
  return PNG.sync.write(png, { colorType: 2, inputHasAlpha: false, deflateLevel: 6 })
}

export function mirrorX(png: PNG) {
  const { width: w, height: h, data } = png
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w >> 1; x++) {
      const a = (y * w + x) * 4
      const b = (y * w + (w - 1 - x)) * 4
      for (let k = 0; k < 4; k++) {
        const t = data[a + k]
        data[a + k] = data[b + k]
        data[b + k] = t
      }
    }
  }
}

/** Median sRGB luma (0..255), ignoring blown-out pixels such as sky through windows. */
export function medianLuma(png: PNG): number {
  const hist = new Uint32Array(256)
  let n = 0
  const step = Math.max(1, Math.floor((png.width * png.height) / 400_000))
  for (let i = 0; i < png.width * png.height; i += step) {
    const o = i * 4
    const y = Math.round(0.2126 * png.data[o] + 0.7152 * png.data[o + 1] + 0.0722 * png.data[o + 2])
    if (y >= 247) continue
    hist[y]++
    n++
  }
  if (!n) return 128
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= n / 2) return v
  }
  return 128
}

/**
 * Gentle auto-exposure: if the render's median tone is far from `target` (0..255 sRGB),
 * scale it in linear light. Bounded so it can only correct, never invent, brightness.
 */
export function autoExpose(png: PNG, target: number): { gain: number } {
  const med = Math.max(8, medianLuma(png))
  const ratio = toLinear(target) / toLinear(med)
  if (ratio > 0.88 && ratio < 1.14) return { gain: 1 }
  const gain = Math.max(0.5, Math.min(3, ratio))
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) lut[v] = toSrgb(Math.min(1, toLinear(v) * gain))
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = lut[png.data[i]]
    png.data[i + 1] = lut[png.data[i + 1]]
    png.data[i + 2] = lut[png.data[i + 2]]
  }
  return { gain }
}

/** Box-filter downscale so the long side is at most `maxSide`. */
export function downscale(png: PNG, maxSide: number): PNG {
  const long = Math.max(png.width, png.height)
  if (long <= maxSide) return png
  const f = maxSide / long
  const w = Math.max(1, Math.round(png.width * f))
  const h = Math.max(1, Math.round(png.height * f))
  const out = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / f), y1 = Math.min(png.height, Math.max(y0 + 1, Math.floor((y + 1) / f)))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / f), x1 = Math.min(png.width, Math.max(x0 + 1, Math.floor((x + 1) / f)))
      let r = 0, g = 0, b = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * png.width + xx) * 4
          r += png.data[o]
          g += png.data[o + 1]
          b += png.data[o + 2]
          n++
        }
      }
      const o = (y * w + x) * 4
      out.data[o] = r / n
      out.data[o + 1] = g / n
      out.data[o + 2] = b / n
      out.data[o + 3] = 255
    }
  }
  return out
}
