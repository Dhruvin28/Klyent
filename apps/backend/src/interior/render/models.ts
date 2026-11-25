import { readFile } from 'node:fs/promises'
import { NodeIO } from '@gltf-transform/core'
import type { GuideModelGeometry } from './guide'

// Loads a GLB furniture model into unit-box-normalised triangles for the guide renderer, with
// the same placement rule as the Blender script: glTF Y-up -> Z-up, then the bounding box is
// centred on x/y, sat on z = 0 and later scaled to the item's target size.

const MAX_TRIANGLES = 120_000

export async function loadModelGeometry(file: string): Promise<GuideModelGeometry[] | null> {
  try {
    const io = new NodeIO()
    const doc = await io.readBinary(new Uint8Array(await readFile(file)))
    const scene = doc.getRoot().listScenes()[0] ?? null
    if (!scene) return null
    const raw: { pos: number[]; idx: number[]; color: [number, number, number] }[] = []
    scene.traverse((node) => {
      const mesh = node.getMesh()
      if (!mesh) return
      const m = node.getWorldMatrix()
      for (const prim of mesh.listPrimitives()) {
        const pa = prim.getAttribute('POSITION')
        if (!pa) continue
        const arr = pa.getArray()
        if (!arr) continue
        const pos: number[] = []
        for (let i = 0; i < arr.length; i += 3) {
          const x = arr[i], y = arr[i + 1], z = arr[i + 2]
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12]
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13]
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14]
          pos.push(wx, -wz, wy) // Y-up -> Z-up (Blender importer convention)
        }
        const ia = prim.getIndices()?.getArray()
        const idx = ia ? Array.from(ia as ArrayLike<number>) : Array.from({ length: arr.length / 3 }, (_, i) => i)
        const bc = prim.getMaterial()?.getBaseColorFactor() ?? [0.72, 0.7, 0.66, 1]
        const toS = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)
        raw.push({ pos, idx, color: [toS(bc[0]), toS(bc[1]), toS(bc[2])] })
      }
    })
    if (!raw.length) return null
    let triangles = raw.reduce((n, r) => n + r.idx.length / 3, 0)
    if (triangles > MAX_TRIANGLES) {
      // Decimate by dropping triangles evenly; this is only a guide.
      const keep = MAX_TRIANGLES / triangles
      for (const r of raw) {
        const next: number[] = []
        let acc = 0
        for (let i = 0; i < r.idx.length; i += 3) {
          acc += keep
          if (acc >= 1) {
            acc -= 1
            next.push(r.idx[i], r.idx[i + 1], r.idx[i + 2])
          }
        }
        r.idx = next
      }
      triangles = raw.reduce((n, r) => n + r.idx.length / 3, 0)
    }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
    for (const r of raw) {
      for (let i = 0; i < r.pos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = r.pos[i + k]
          if (v < mn[k]) mn[k] = v
          if (v > mx[k]) mx[k] = v
        }
      }
    }
    const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]]
    const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2
    return raw.map((r) => {
      const positions = new Float32Array(r.pos.length)
      for (let i = 0; i < r.pos.length; i += 3) {
        positions[i] = size[0] > 1e-6 ? (r.pos[i] - cx) / size[0] : 0
        positions[i + 1] = size[1] > 1e-6 ? (r.pos[i + 1] - cy) / size[1] : 0
        positions[i + 2] = size[2] > 1e-6 ? (r.pos[i + 2] - mn[2]) / size[2] : 0
      }
      return { positions, indices: Uint32Array.from(r.idx), color: r.color }
    })
  } catch {
    return null
  }
}
