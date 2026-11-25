// sRGB <-> linear light conversions. All lighting maths happens in linear light;
// lookup tables keep the per-pixel cost to an array read.

/** 8-bit sRGB code value → linear [0, 1]. */
export const SRGB_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const LIN_STEPS = 16384
const LINEAR_TO_SRGB = new Uint8Array(LIN_STEPS + 1)
for (let i = 0; i <= LIN_STEPS; i++) {
  const l = i / LIN_STEPS
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055
  LINEAR_TO_SRGB[i] = Math.max(0, Math.min(255, Math.round(c * 255)))
}

/** Linear [0, 1] → 8-bit sRGB (clamped). */
export function linearToSrgb8(l: number): number {
  if (!(l > 0)) return 0
  if (l >= 1) return 255
  return LINEAR_TO_SRGB[(l * LIN_STEPS + 0.5) | 0]
}

export function linearToSrgbExact(l: number): number {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Invalid colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** Relative luminance (linear) of an 8-bit sRGB triple. */
export function luminance8(r: number, g: number, b: number): number {
  return 0.2126 * SRGB_TO_LINEAR[r] + 0.7152 * SRGB_TO_LINEAR[g] + 0.0722 * SRGB_TO_LINEAR[b]
}

/** CIE L*a*b* (D65) of an 8-bit sRGB triple, written into out[0..2]. */
export function srgbToLab(r: number, g: number, b: number, out: Float32Array | number[]): void {
  const lr = SRGB_TO_LINEAR[r]
  const lg = SRGB_TO_LINEAR[g]
  const lb = SRGB_TO_LINEAR[b]
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883
  const fx = labF(x)
  const fy = labF(y)
  const fz = labF(z)
  out[0] = 116 * fy - 16
  out[1] = 500 * (fx - fy)
  out[2] = 200 * (fy - fz)
}

function labF(t: number): number {
  return t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 0.137931034
}
