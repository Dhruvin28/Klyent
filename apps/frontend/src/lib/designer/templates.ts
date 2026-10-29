import { color, defaultPlan, newParametricItem } from './defaults'
import { cleanupPlan, rectangleWalls, uid } from './geometry'
import type { Item, Opening, Plan, Wall } from './types'

export const TEMPLATES = {
  blank: { label: 'Blank', description: 'Start from an empty plan, or trace an uploaded floor plan.' },
  bedroom: { label: 'Bedroom', description: '3.6 × 4.2 m with wardrobe, bed and window.' },
  kitchen: { label: 'L-shaped kitchen', description: '3 × 3.6 m with base and wall cabinets.' },
  apartment: { label: '1BHK', description: 'Living, bedroom and kitchen to start editing.' },
} as const
export type TemplateKey = keyof typeof TEMPLATES

const at = (it: Item, patch: Partial<Item>): Item => ({ ...it, ...patch })
const opening = (wall: Wall, type: Opening['type'], offset: number, width: number, height: number, sill: number): Opening => ({
  id: uid(),
  wallId: wall.id,
  type,
  offset,
  width,
  height,
  sill,
  flip: false,
})

export function templatePlan(key: TemplateKey): Plan {
  const plan = defaultPlan()
  switch (key) {
    case 'bedroom': {
      // Walls: top, right, bottom, left (clockwise).
      // Inner faces at x 115…3485, y 115…4085. Bottom wall runs right → left.
      const walls = rectangleWalls({ x: 0, y: 0 }, { x: 3600, y: 4200 }, 230)
      const [, right, bottom] = walls
      plan.walls = walls
      plan.openings = [opening(right, 'window', 2100, 1500, 1350, 750), opening(bottom, 'door', 900, 900, 2100, 0)]
      plan.items = [
        at(newParametricItem('wardrobe', { x: 0, y: 0 }), { x: 1015, y: 415, materials: { shutter: color('#c7a57d', 0.5), carcass: color('#efe9df', 0.7), handle: color('#3a3a3a', 0.3, 0.9) } }),
        // Headboard against the left wall, facing into the room.
        at(newParametricItem('bed', { x: 0, y: 0 }), { x: 115 + 1050, y: 2750, rotation: 270 }),
      ]
      break
    }
    case 'kitchen': {
      const walls = rectangleWalls({ x: 0, y: 0 }, { x: 3000, y: 3600 }, 150)
      const [, right, bottom] = walls
      plan.walls = walls
      plan.openings = [opening(right, 'window', 1200, 1200, 1000, 1050), opening(bottom, 'door', 1400, 900, 2100, 0)]
      const base = (patch: Partial<Item>) => at(newParametricItem('base_cabinet', { x: 0, y: 0 }), { materials: { shutter: color('#4f6d6a', 0.4), top: color('#e8e4dc', 0.25), carcass: color('#efe9df', 0.7), handle: color('#8a8a8f', 0.3, 0.9) }, ...patch })
      const wallUnit = (patch: Partial<Item>) => at(newParametricItem('wall_cabinet', { x: 0, y: 0 }), { materials: { shutter: color('#f1ede6', 0.4), carcass: color('#efe9df', 0.7) }, ...patch })
      plan.items = [
        base({ x: 75 + 1425, y: 75 + 300, width: 2850, params: { doors: 4, drawers: 2, handle: 'profile' } }),
        base({ x: 2925 - 300, y: 1575, width: 1800, rotation: 90, params: { doors: 3, drawers: 0, handle: 'profile' } }),
        wallUnit({ x: 75 + 1100, y: 75 + 175, width: 2200, params: { doors: 4, handle: 'profile' } }),
        at(newParametricItem('tall_unit', { x: 0, y: 0 }), { x: 75 + 300, y: 3525 - 300, rotation: 180, materials: { shutter: color('#4f6d6a', 0.4) } }),
      ]
      break
    }
    case 'apartment': {
      const outer = rectangleWalls({ x: 0, y: 0 }, { x: 8400, y: 6000 }, 230)
      const split: Wall = { id: uid(), a: { x: 4800, y: 0 }, b: { x: 4800, y: 6000 }, thickness: 115, height: null, left: null, right: null }
      const kitchen: Wall = { id: uid(), a: { x: 4800, y: 3600 }, b: { x: 8400, y: 3600 }, thickness: 115, height: null, left: null, right: null }
      const [top, right, bottom, left] = outer
      plan.walls = [...outer, split, kitchen]
      plan.openings = [
        // Main door into the living room (the bottom wall runs right → left).
        opening(bottom, 'door', 6200, 1000, 2100, 0),
        opening(left, 'window', 3000, 1800, 1350, 750),
        opening(top, 'window', 2400, 2000, 1500, 600),
        opening(right, 'window', 1800, 1500, 1350, 750),
        opening(split, 'door', 1500, 900, 2100, 0),
        opening(split, 'opening', 4800, 1200, 2100, 0),
      ]
      plan.items = [
        at(newParametricItem('sofa', { x: 0, y: 0 }), { x: 2400, y: 4300, rotation: 180 }),
        at(newParametricItem('tv_unit', { x: 0, y: 0 }), { x: 2400, y: 340 }),
        at(newParametricItem('table', { x: 0, y: 0 }), { x: 2400, y: 2700, width: 1200, depth: 750, height: 420, name: 'Coffee table' }),
        at(newParametricItem('bed', { x: 0, y: 0 }), { x: 6600, y: 1165, rotation: 0 }),
        at(newParametricItem('wardrobe', { x: 0, y: 0 }), { x: 8285 - 300, y: 2600, rotation: 90, width: 1500, params: { doors: 2, handle: 'bar', loft: true } }),
        at(newParametricItem('base_cabinet', { x: 0, y: 0 }), { x: 6600, y: 5885 - 300, rotation: 180, width: 3000, params: { doors: 4, drawers: 1, handle: 'profile' } }),
      ]
      break
    }
  }
  const clean = cleanupPlan(plan)
  const names: Record<TemplateKey, string[]> = { blank: [], bedroom: ['Bedroom'], kitchen: ['Kitchen'], apartment: ['Living', 'Bedroom', 'Kitchen'] }
  // Name rooms left-to-right / top-to-bottom by their first point.
  const sorted = [...clean.rooms].sort((a, b) => Math.min(...a.points.map((p) => p.x)) - Math.min(...b.points.map((p) => p.x)) || Math.min(...a.points.map((p) => p.y)) - Math.min(...b.points.map((p) => p.y)))
  sorted.forEach((r, i) => {
    if (names[key][i]) r.name = names[key][i]
  })
  for (const r of clean.rooms) {
    if (/kitchen/i.test(r.name)) r.floor = color('#d9d4cc', 0.35)
    else r.floor = color('#b48a60', 0.45)
  }
  return clean
}
