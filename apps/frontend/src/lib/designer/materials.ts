import * as THREE from 'three'
import type { VizMaterial } from '@/lib/visualizer/types'
import type { MatRef, SurfacePattern } from './types'

/** Library texture size assumed when a sample has no physical dimensions. */
const FALLBACK_TILE_MM = 600

/**
 * Turns plan finishes into three.js materials. Surfaces carry UVs in metres, so a
 * library texture repeats at its real-world sample size. Materials and textures are
 * cached for the resolver's lifetime and shared between rebuilds.
 */
export class MaterialResolver {
  private materials = new Map<string, THREE.Material>()
  private textures = new Map<string, Promise<THREE.Texture | null>>()
  private pending = new Set<Promise<unknown>>()
  private patternCache = new Map<string, THREE.Texture>()

  constructor(
    private library: Map<string, VizMaterial>,
    private loadAsset: (id: string) => Promise<Blob>,
    private anisotropy = 4
  ) {}

  setLibrary(library: Map<string, VizMaterial>) {
    this.library = library
  }

  /** Resolves once every texture requested so far has loaded (or failed). */
  async ready() {
    while (this.pending.size) await Promise.allSettled([...this.pending])
  }

  get(ref: MatRef, fallback: MatRef): THREE.Material {
    if (ref.kind === 'library') {
      const lib = this.library.get(ref.materialId)
      if (!lib) return this.get(fallback, fallback)
      if (lib.kind === 'paint' || !lib.textureAssetId) {
        return this.colorMaterial(lib.colorHex ?? '#cccccc', ref.roughness, 0)
      }
      const key = `lib:${lib.id}:${ref.roughness}:${ref.rotation ?? 0}`
      let m = this.materials.get(key)
      if (!m) {
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: ref.roughness, metalness: 0 })
        m = mat
        this.materials.set(key, mat)
        const p = this.texture(lib, ref.rotation ?? 0).then((tex) => {
          if (tex) {
            mat.map = tex
            mat.needsUpdate = true
          } else {
            mat.color.set(lib.colorHex ?? '#bbbbbb')
          }
        })
        this.track(p)
      }
      return m
    }
    return this.colorMaterial(ref.hex, ref.roughness, ref.metalness ?? 0, ref.pattern)
  }

  /** Clear glass for window panes. */
  glass(): THREE.Material {
    let m = this.materials.get('glass')
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5, thickness: 0.006, transparent: true, opacity: 0.25 })
      this.materials.set('glass', m)
    }
    return m
  }

  /** Light panel surface. */
  emissive(hex: string): THREE.Material {
    const key = `emit:${hex}`
    let m = this.materials.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(hex), emissiveIntensity: 2 })
      this.materials.set(key, m)
    }
    return m
  }

  dispose() {
    for (const m of this.materials.values()) m.dispose()
    for (const t of this.textures.values()) void t.then((tex) => tex?.dispose())
    for (const t of this.patternCache.values()) t.dispose()
    this.patternCache.clear()
    this.materials.clear()
    this.textures.clear()
  }

  private colorMaterial(hex: string, roughness: number, metalness: number, pattern?: SurfacePattern) {
    const key = `c:${hex}:${roughness}:${metalness}:${pattern ?? ''}`
    let m = this.materials.get(key)
    if (!m) {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness, metalness })
      const tex = pattern ? this.patternTexture(pattern) : null
      if (tex) mat.map = tex
      m = mat
      this.materials.set(key, m)
    }
    return m
  }

  /** Procedural surface detail so untextured finishes read as wood, cloth or plaster, not flat colour. */
  private patternTexture(pattern: SurfacePattern): THREE.Texture | null {
    const key = `pattern:${pattern}`
    const hit = this.patternCache.get(key)
    if (hit) return hit
    if (typeof document === 'undefined') return null
    const tex = makePatternTexture(pattern, this.anisotropy)
    this.patternCache.set(key, tex)
    return tex
  }

  private texture(lib: VizMaterial, rotationDeg: number) {
    const key = `${lib.textureAssetId}:${rotationDeg}`
    let p = this.textures.get(key)
    if (!p) {
      p = this.loadAsset(lib.textureAssetId!)
        .then((blob) => createImageBitmap(blob, { imageOrientation: 'flipY' }))
        .then((bmp) => {
          const tex = new THREE.Texture(bmp)
          // ImageBitmaps are already flipped above; three can't flip them itself.
          tex.flipY = false
          tex.colorSpace = THREE.SRGBColorSpace
          tex.wrapS = THREE.RepeatWrapping
          tex.wrapT = THREE.RepeatWrapping
          tex.anisotropy = this.anisotropy
          const w = lib.widthMm || FALLBACK_TILE_MM
          const h = lib.heightMm || (lib.widthMm && lib.textureWidth && lib.textureHeight ? (lib.widthMm * lib.textureHeight) / lib.textureWidth : FALLBACK_TILE_MM)
          tex.repeat.set(1000 / w, 1000 / h)
          tex.rotation = (rotationDeg * Math.PI) / 180
          tex.needsUpdate = true
          return tex
        })
        .catch(() => null)
      this.textures.set(key, p)
      this.track(p)
    }
    return p
  }

  private track(p: Promise<unknown>) {
    this.pending.add(p)
    void p.finally(() => this.pending.delete(p))
  }
}

/**
 * Rewrites a BoxGeometry's per-face 0..1 UVs into metres so textures keep their
 * physical scale on boxes of any size (grain runs vertically on upright faces).
 */
export function metricBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  // Face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices each).
  const sizes: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ]
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      uv.setXY(i, uv.getX(i) * sizes[f][0], uv.getY(i) * sizes[f][1])
    }
  }
  uv.needsUpdate = true
}


function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Greyscale detail maps that multiply the finish colour. Sizes are chosen so that
 * UVs in metres give realistic scale: 1.2 m of planks, 0.25 m of weave, 1 m of plaster.
 */
function makePatternTexture(pattern: SurfacePattern, anisotropy: number): THREE.Texture {
  const size = pattern === 'wood' ? 1024 : pattern === 'fabric' ? 256 : 512
  const metres = pattern === 'wood' ? 1.2 : pattern === 'fabric' ? 0.25 : 1
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const rand = rng(pattern === 'wood' ? 11 : pattern === 'fabric' ? 23 : 37)
  const grey = (v: number) => `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`
  if (pattern === 'wood') {
    const planks = 5
    const pw = size / planks
    for (let i = 0; i < planks; i++) {
      const tone = 0.8 + rand() * 0.2
      g.fillStyle = grey(tone)
      g.fillRect(i * pw, 0, pw, size)
      for (let k = 0; k < 140; k++) {
        const x = i * pw + rand() * pw
        const w = 0.5 + rand() * 1.6
        const wobble = (rand() - 0.5) * 10
        g.strokeStyle = grey(Math.max(0.45, tone - 0.1 - rand() * 0.3))
        g.globalAlpha = 0.1 + rand() * 0.28
        g.lineWidth = w
        g.beginPath()
        g.moveTo(x, 0)
        g.bezierCurveTo(x + wobble, size * 0.33, x - wobble, size * 0.66, x + wobble * 0.4, size)
        g.stroke()
      }
      g.globalAlpha = 1
      // Staggered butt joints so boards do not line up.
      const joint = rand() * size
      g.fillStyle = 'rgb(70,70,70)'
      g.fillRect(i * pw, joint, pw, 2)
      g.fillStyle = 'rgb(60,60,60)'
      g.fillRect(i * pw, 0, 2, size)
    }
  } else if (pattern === 'fabric') {
    g.fillStyle = grey(0.93)
    g.fillRect(0, 0, size, size)
    for (let y = 0; y < size; y += 2) {
      for (let x = 0; x < size; x += 2) {
        const weave = ((x + y) / 2) % 2 === 0 ? 0.04 : -0.04
        g.fillStyle = grey(0.9 + weave + (rand() - 0.5) * 0.08)
        g.fillRect(x, y, 2, 2)
      }
    }
  } else {
    g.fillStyle = grey(0.96)
    g.fillRect(0, 0, size, size)
    for (let k = 0; k < 900; k++) {
      const r = 6 + rand() * 40
      g.fillStyle = grey(0.9 + rand() * 0.1)
      g.globalAlpha = 0.05 + rand() * 0.08
      g.beginPath()
      g.arc(rand() * size, rand() * size, r, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = anisotropy
  tex.repeat.set(1 / metres, 1 / metres)
  return tex
}
