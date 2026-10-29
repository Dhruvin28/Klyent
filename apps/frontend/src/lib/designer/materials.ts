import * as THREE from 'three'
import type { VizMaterial } from '@/lib/visualizer/types'
import type { MatRef } from './types'

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
    return this.colorMaterial(ref.hex, ref.roughness, ref.metalness ?? 0)
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
    this.materials.clear()
    this.textures.clear()
  }

  private colorMaterial(hex: string, roughness: number, metalness: number) {
    const key = `c:${hex}:${roughness}:${metalness}`
    let m = this.materials.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness, metalness })
      this.materials.set(key, m)
    }
    return m
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
