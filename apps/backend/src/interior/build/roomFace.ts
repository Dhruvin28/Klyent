import { dist, projectToSegment, type Vec2 } from '../../designer/geometry'
import type { Room, Wall } from '../../designer/plan'

export type RoomSide = 'N' | 'E' | 'S' | 'W'

export interface RoomFace {
  wall: Wall
  a: Vec2
  b: Vec2
  length: number
  side: RoomSide
}

/** Returns the room boundary edge that faces the requested plan direction. */
export function roomFace(room: Room, walls: Wall[], side: RoomSide): RoomFace | null {
  if (room.points.length < 2) return null
  const xs = room.points.map((p) => p.x)
  const ys = room.points.map((p) => p.y)
  const extreme = side === 'N' ? Math.min(...ys) : side === 'S' ? Math.max(...ys) : side === 'W' ? Math.min(...xs) : Math.max(...xs)
  let best: RoomFace | null = null
  let bestScore = Infinity
  for (let i = 0; i < room.points.length; i++) {
    const a = room.points[i]
    const b = room.points[(i + 1) % room.points.length]
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
    if ((side === 'N' || side === 'S') !== horizontal) continue
    const axis = horizontal ? (a.y + b.y) / 2 : (a.x + b.x) / 2
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const wall = walls
      .map((w) => ({ w, d: projectToSegment(mid, w.a, w.b).distance }))
      .sort((p, q) => p.d - q.d)[0]
    if (!wall) continue
    const score = Math.abs(axis - extreme) + wall.d
    if (score < bestScore) {
      bestScore = score
      best = { wall: wall.w, a, b, length: dist(a, b), side }
    }
  }
  return best
}
