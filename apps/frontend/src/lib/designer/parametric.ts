import * as THREE from 'three'
import { metricBoxUVs } from './materials'
import type { Item, ParametricType } from './types'

type SlotMaterial = (slot: string) => THREE.Material

const BOARD = 0.018
const GAP = 0.003

/**
 * Builds a parametric furniture item in metres. Origin is the centre of the footprint
 * at the item's bottom; the front faces +z. Every mesh records its material slot so
 * clicking it in 3D picks that slot.
 */
export function buildParametric(type: ParametricType, item: Item, mat: SlotMaterial): THREE.Group {
  const g = new THREE.Group()
  const W = item.width / 1000
  const D = item.depth / 1000
  const H = item.height / 1000
  const p = item.params
  const num = (k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d)
  const handleStyle = typeof p.handle === 'string' ? p.handle : 'bar'

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, slot: string) => {
    if (w <= 0 || h <= 0 || d <= 0) return
    const geo = new THREE.BoxGeometry(w, h, d)
    metricBoxUVs(geo, w, h, d)
    const m = new THREE.Mesh(geo, mat(slot))
    m.position.set(x, y, z)
    m.userData.slot = slot
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
  }

  /** A shutter panel with its handle; `hinge` is the side the handle is away from. */
  const shutter = (x0: number, x1: number, y0: number, y1: number, zFront: number, handleAt: 'left' | 'right' | 'top' | 'bottom' | 'center') => {
    const w = x1 - x0 - GAP
    const h = y1 - y0 - GAP
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    box(w, h, BOARD, cx, cy, zFront - BOARD / 2, 'shutter')
    const z = zFront + 0.01
    if (handleStyle === 'profile') {
      box(w, 0.012, 0.006, cx, y1 - GAP - 0.006, zFront + 0.003, 'handle')
      return
    }
    const inset = 0.05
    const hx = handleAt === 'left' ? x0 + inset : handleAt === 'right' ? x1 - inset : cx
    const hy = handleAt === 'top' ? y1 - inset : handleAt === 'bottom' ? y0 + inset : Math.min(cy, y0 + 1.05)
    if (handleStyle === 'knob') {
      box(0.025, 0.025, 0.025, hx, hy, z, 'handle')
    } else if (handleAt === 'top' || handleAt === 'bottom') {
      box(Math.min(0.3, w * 0.6), 0.012, 0.02, hx, hy, z, 'handle')
    } else {
      box(0.012, Math.min(0.3, h * 0.5), 0.02, hx, hy, z, 'handle')
    }
  }

  /** Row of side-by-side shutters, handles at the meeting edges of each pair. */
  const shutterRow = (x0: number, x1: number, y0: number, y1: number, n: number, zFront: number, vertical: 'top' | 'bottom' | null) => {
    const cw = (x1 - x0) / n
    for (let i = 0; i < n; i++) {
      const at = vertical ?? (n === 1 ? 'right' : i % 2 === 0 ? 'right' : 'left')
      shutter(x0 + i * cw, x0 + (i + 1) * cw, y0, y1, zFront, at)
    }
  }

  const drawerStack = (x0: number, x1: number, y0: number, y1: number, n: number, zFront: number) => {
    const ch = (y1 - y0) / n
    for (let i = 0; i < n; i++) shutter(x0, x1, y0 + i * ch, y0 + (i + 1) * ch, zFront, 'top')
  }

  const front = D / 2
  switch (type) {
    case 'wardrobe': {
      const loft = !!p.loft
      const doors = Math.max(1, Math.round(num('doors', 3)))
      box(W, H, D - BOARD, 0, H / 2, -BOARD / 2, 'carcass')
      const split = loft ? H - Math.min(0.6, H * 0.25) : H
      shutterRow(-W / 2, W / 2, 0, split, doors, front, null)
      if (loft) shutterRow(-W / 2, W / 2, split, H, doors, front, 'bottom')
      break
    }
    case 'base_cabinet': {
      const plinth = 0.1
      const top = 0.02
      const doors = Math.max(0, Math.round(num('doors', 2)))
      const drawers = Math.max(0, Math.round(num('drawers', 0)))
      box(W, plinth, D - 0.06, 0, plinth / 2, -0.03, 'carcass')
      box(W, H - plinth - top, D - BOARD, 0, plinth + (H - plinth - top) / 2, -BOARD / 2, 'carcass')
      box(W + 0.01, top, D + 0.02, 0, H - top / 2, 0.01, 'top')
      const cols = doors + (drawers > 0 ? 1 : 0)
      if (cols > 0) {
        const cw = W / cols
        let x = -W / 2
        if (drawers > 0) {
          drawerStack(x, x + cw, plinth, H - top, drawers, front)
          x += cw
        }
        if (doors > 0) shutterRow(x, W / 2, plinth, H - top, doors, front, handleStyle === 'profile' ? null : 'top')
      }
      break
    }
    case 'wall_cabinet': {
      const doors = Math.max(1, Math.round(num('doors', 2)))
      box(W, H, D - BOARD, 0, H / 2, -BOARD / 2, 'carcass')
      shutterRow(-W / 2, W / 2, 0, H, doors, front, handleStyle === 'profile' ? null : 'bottom')
      break
    }
    case 'tall_unit': {
      const doors = Math.max(1, Math.round(num('doors', 2)))
      box(W, H, D - BOARD, 0, H / 2, -BOARD / 2, 'carcass')
      const ch = H / doors
      for (let i = 0; i < doors; i++) shutter(-W / 2, W / 2, i * ch, (i + 1) * ch, front, 'right')
      break
    }
    case 'shelf': {
      const shelves = Math.max(1, Math.round(num('shelves', 4)))
      const t = 0.025
      box(t, H, D, -W / 2 + t / 2, H / 2, 0, 'carcass')
      box(t, H, D, W / 2 - t / 2, H / 2, 0, 'carcass')
      box(W - 2 * t, 0.009, D, 0, H / 2, -D / 2 + 0.0045, 'carcass')
      for (let i = 0; i <= shelves; i++) {
        const y = Math.min(H - t / 2, t / 2 + (i * (H - t)) / shelves)
        box(W - 2 * t, t, D - 0.01, 0, y, 0.005, 'carcass')
      }
      break
    }
    case 'tv_unit': {
      const drawers = Math.max(0, Math.round(num('drawers', 2)))
      box(W, H, D - BOARD, 0, H / 2, -BOARD / 2, 'carcass')
      if (drawers > 0) {
        const cw = W / drawers
        for (let i = 0; i < drawers; i++) shutter(-W / 2 + i * cw, -W / 2 + (i + 1) * cw, 0.04, H, front, 'top')
      }
      break
    }
    case 'bed': {
      const baseH = Math.min(0.38, H * 0.35)
      const head = 0.08
      box(W, baseH, D - head, 0, baseH / 2, head / 2, p.storage ? 'frame' : 'frame')
      box(W - 0.04, 0.22, D - head - 0.06, 0, baseH + 0.11, head / 2, 'fabric')
      box(W + 0.06, H, head, 0, H / 2, -D / 2 + head / 2, 'headboard')
      const pillowW = Math.min(0.7, (W - 0.15) / 2)
      for (const s of W > 1.2 ? [-1, 1] : [0]) box(pillowW, 0.12, 0.42, s * (pillowW / 2 + 0.04), baseH + 0.28, -D / 2 + head + 0.3, 'fabric')
      // Throw across the foot of the bed.
      box(W - 0.02, 0.03, 0.55, 0, baseH + 0.235, D / 2 - 0.35, 'headboard')
      break
    }
    case 'sofa': {
      const seats = Math.max(1, Math.round(num('seats', 3)))
      const legH = 0.08
      const arm = Math.min(0.2, W * 0.12)
      const backD = Math.min(0.22, D * 0.25)
      const seatH = 0.44
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.04, legH, 0.04, sx * (W / 2 - 0.06), legH / 2, sz * (D / 2 - 0.06), 'legs')
      box(W, seatH - legH - 0.12, D, 0, legH + (seatH - legH - 0.12) / 2, 0, 'fabric')
      box(W - 2 * arm, H - legH, backD, 0, legH + (H - legH) / 2, -D / 2 + backD / 2, 'fabric')
      for (const s of [-1, 1]) box(arm, 0.62 - legH, D, s * (W / 2 - arm / 2), legH + (0.62 - legH) / 2, 0, 'fabric')
      const cw = (W - 2 * arm) / seats
      for (let i = 0; i < seats; i++) box(cw - 0.01, 0.12, D - backD - 0.02, -W / 2 + arm + cw * (i + 0.5), seatH - 0.06, backD / 2, 'fabric')
      break
    }
    case 'table': {
      const top = 0.04
      box(W, top, D, 0, H - top / 2, 0, 'top')
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, H - top, 0.05, sx * (W / 2 - 0.08), (H - top) / 2, sz * (D / 2 - 0.08), 'legs')
      break
    }
    case 'chair': {
      const seatY = Math.min(0.46, H * 0.52)
      box(W, 0.04, D, 0, seatY, 0, 'seat')
      box(W, H - seatY - 0.02, 0.03, 0, seatY + (H - seatY) / 2, -D / 2 + 0.015, 'seat')
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.035, seatY - 0.02, 0.035, sx * (W / 2 - 0.03), (seatY - 0.02) / 2, sz * (D / 2 - 0.03), 'legs')
      break
    }
    case 'box':
    default:
      box(W, H, D, 0, H / 2, 0, 'body')
  }
  return g
}

/** Shutter/front area in m² (for BOM laminate quantities). */
export function frontAreaSqm(type: ParametricType, item: Item): number {
  const W = item.width / 1000
  const H = item.height / 1000
  switch (type) {
    case 'wardrobe':
    case 'wall_cabinet':
    case 'tall_unit':
      return W * H
    case 'base_cabinet':
      return W * Math.max(0, H - 0.12)
    case 'tv_unit':
      return W * Math.max(0, H - 0.04)
    default:
      return 0
  }
}
