import { describe, expect, it } from 'vitest'
import {
  cleanupPlan,
  findEnclosures,
  insetPolygon,
  polygonArea,
  rectangleWalls,
  roomAreaSqm,
  snapItemToWall,
  splitWall,
  syncRooms,
  wallExtensions,
} from '../geometry'
import { defaultPlan } from '../defaults'
import type { Item, Wall } from '../types'

const wall = (ax: number, ay: number, bx: number, by: number, t = 100): Wall => ({
  id: `${ax},${ay}-${bx},${by}`,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness: t,
  height: null,
  left: null,
  right: null,
})

describe('findEnclosures', () => {
  it('finds one room in a rectangle regardless of drawing direction', () => {
    const cw = rectangleWalls({ x: 0, y: 0 }, { x: 4000, y: 3000 }, 100)
    expect(findEnclosures(cw)).toHaveLength(1)
    expect(polygonArea(findEnclosures(cw)[0].points)).toBeCloseTo(12e6)
    const ccw = cw.map((w) => ({ ...w, a: w.b, b: w.a })).reverse()
    expect(findEnclosures(ccw)).toHaveLength(1)
  })

  it('splits a rectangle into two rooms with a partition ending on walls (T-junctions)', () => {
    const walls = [...rectangleWalls({ x: 0, y: 0 }, { x: 6000, y: 3000 }, 150), wall(2500, 0, 2500, 3000)]
    const faces = findEnclosures(walls)
    expect(faces).toHaveLength(2)
    const areas = faces.map((f) => polygonArea(f.points) / 1e6).sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(7.5)
    expect(areas[1]).toBeCloseTo(10.5)
  })

  it('ignores dangling walls and open shapes', () => {
    expect(findEnclosures([wall(0, 0, 3000, 0), wall(3000, 0, 3000, 3000)])).toHaveLength(0)
    const withSpur = [...rectangleWalls({ x: 0, y: 0 }, { x: 4000, y: 4000 }, 100), wall(2000, 4000, 2000, 2500)]
    const faces = findEnclosures(withSpur)
    expect(faces).toHaveLength(1)
    expect(polygonArea(faces[0].points) / 1e6).toBeCloseTo(16)
  })

  it('handles an L-shaped room', () => {
    const pts = [
      [0, 0],
      [4000, 0],
      [4000, 2000],
      [2000, 2000],
      [2000, 4000],
      [0, 4000],
    ]
    const walls = pts.map((p, i) => wall(p[0], p[1], pts[(i + 1) % 6][0], pts[(i + 1) % 6][1]))
    const faces = findEnclosures(walls)
    expect(faces).toHaveLength(1)
    expect(polygonArea(faces[0].points) / 1e6).toBeCloseTo(12)
  })
})

describe('rooms', () => {
  it('keeps room identity and finishes when walls move', () => {
    const walls = rectangleWalls({ x: 0, y: 0 }, { x: 4000, y: 3000 }, 100)
    const [room] = syncRooms(walls, [])
    const named = { ...room, name: 'Bedroom', floor: { kind: 'color' as const, hex: '#aa8866', roughness: 0.5 } }
    const moved = walls.map((w) => ({ ...w, a: { ...w.a, x: w.a.x === 4000 ? 4500 : w.a.x }, b: { ...w.b, x: w.b.x === 4000 ? 4500 : w.b.x } }))
    const [after] = syncRooms(moved, [named])
    expect(after.id).toBe(room.id)
    expect(after.name).toBe('Bedroom')
    expect(after.floor).toEqual(named.floor)
  })

  it('measures carpet area inside the wall faces', () => {
    const walls = rectangleWalls({ x: 0, y: 0 }, { x: 4000, y: 3000 }, 200)
    const [room] = syncRooms(walls, [])
    // (4000-200) × (3000-200)
    expect(roomAreaSqm(room, walls)).toBeCloseTo(3.8 * 2.8)
  })

  it('insets polygons of either winding inwards', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    expect(polygonArea(insetPolygon(sq, [10, 10, 10, 10]))).toBeCloseTo(6400)
    expect(polygonArea(insetPolygon([...sq].reverse(), [10, 10, 10, 10]))).toBeCloseTo(6400)
  })
})

describe('walls', () => {
  it('extends wall ends that meet other walls by half their thickness', () => {
    const walls = rectangleWalls({ x: 0, y: 0 }, { x: 4000, y: 3000 }, 200)
    expect(wallExtensions(walls[0], walls)).toEqual({ a: 100, b: 100 })
    const lone = wall(0, 0, 1000, 0)
    expect(wallExtensions(lone, [lone])).toEqual({ a: 0, b: 0 })
  })

  it('moves openings to the second half when splitting a wall', () => {
    const plan = { ...defaultPlan(), walls: [wall(0, 0, 4000, 0)] }
    plan.openings = [
      { id: 'd1', wallId: plan.walls[0].id, type: 'door', offset: 800, width: 900, height: 2100, sill: 0, flip: false },
      { id: 'w1', wallId: plan.walls[0].id, type: 'window', offset: 3000, width: 1200, height: 1200, sill: 900, flip: false },
    ]
    const out = splitWall(plan, plan.walls[0].id, { x: 2000, y: 0 })
    expect(out.walls).toHaveLength(2)
    const win = out.openings.find((o) => o.id === 'w1')!
    expect(win.wallId).toBe(out.walls[1].id)
    expect(win.offset).toBe(1000)
  })

  it('cleanup drops tiny walls and clamps openings', () => {
    const plan = { ...defaultPlan(), walls: [wall(0, 0, 1000, 0), wall(0, 0, 3, 0)] }
    plan.openings = [{ id: 'o', wallId: plan.walls[0].id, type: 'door', offset: 950, width: 900, height: 2100, sill: 0, flip: false }]
    const out = cleanupPlan(plan)
    expect(out.walls).toHaveLength(1)
    expect(out.openings[0].offset).toBe(550)
  })
})

describe('snapItemToWall', () => {
  const item: Item = {
    id: 'i',
    name: 'Wardrobe',
    source: { kind: 'parametric', type: 'wardrobe' },
    x: 2000,
    y: 450,
    elevation: 0,
    rotation: 0,
    width: 1800,
    depth: 600,
    height: 2100,
    params: {},
    materials: {},
  }

  it('backs an item against the nearest wall and faces it into the room', () => {
    const s = snapItemToWall(item, [wall(0, 0, 4000, 0, 200)])!
    expect(s.y).toBe(100 + 300)
    expect(s.rotation).toBe(0) // front (+y) already points away from the wall
    const below = snapItemToWall({ ...item, y: -450 }, [wall(0, 0, 4000, 0, 200)])!
    expect(below.y).toBe(-400)
    expect(below.rotation).toBe(180)
  })

  it('leaves items far from walls alone', () => {
    expect(snapItemToWall({ ...item, y: 2000 }, [wall(0, 0, 4000, 0)])).toBeNull()
  })
})
