import { describe, expect, it } from 'vitest'
import { computeBom } from '../bom'
import { itemFootprint, pointInPolygon, roomAreaSqm } from '../geometry'
import { TEMPLATES, templatePlan, type TemplateKey } from '../templates'

describe('templates', () => {
  it('detects the expected rooms', () => {
    expect(templatePlan('blank').rooms).toHaveLength(0)
    expect(templatePlan('bedroom').rooms.map((r) => r.name)).toEqual(['Bedroom'])
    expect(templatePlan('kitchen').rooms.map((r) => r.name)).toEqual(['Kitchen'])
    expect(templatePlan('apartment').rooms.map((r) => r.name).sort()).toEqual(['Bedroom', 'Kitchen', 'Living'])
  })

  it('places every item fully inside a room and keeps openings on their walls', () => {
    for (const key of Object.keys(TEMPLATES) as TemplateKey[]) {
      const plan = templatePlan(key)
      for (const it of plan.items) {
        const inside = plan.rooms.some((r) => itemFootprint(it).every((p) => pointInPolygon(p, r.points)))
        expect(inside, `${key}: ${it.name}`).toBe(true)
      }
      for (const o of plan.openings) expect(plan.walls.some((w) => w.id === o.wallId)).toBe(true)
    }
  })

  it('reports carpet areas and furniture in the BOM', () => {
    const plan = templatePlan('bedroom')
    expect(roomAreaSqm(plan.rooms[0], plan.walls)).toBeCloseTo(3.37 * 3.97, 1)
    const bom = computeBom(plan, new Map(), new Map())
    expect(bom.furniture.map((f) => f.name).sort()).toEqual(['Bed', 'Wardrobe'])
    // Default finishes are plain colours: the wardrobe shutters show up as a colour area.
    expect(bom.colors.some((c) => c.surfaces.includes('Wardrobe shutters'))).toBe(true)
  })
})
