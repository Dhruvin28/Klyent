import { centroid, roomInnerPolygon } from '../../designer/geometry'
import type { Plan } from '../../designer/plan'

export interface ViewSpec {
  key: string
  name: string
  group: 'perspective' | 'elevation' | 'top' | 'ceiling' | 'isometric'
  roomId: string | null
  projection: 'perspective' | 'orthographic'
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  fov: number
  ortho: { width: number; height: number } | null
  aspect: number
  visibility: { items: boolean; ceilings: 'auto' | 'show' | 'hide' }
  mirrorX: boolean
  note: string | null
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')

export function buildCameras(plan: Plan): ViewSpec[] {
  const views: ViewSpec[] = []
  const height = plan.wallHeight
  for (const room of plan.rooms) {
    const poly = roomInnerPolygon(room, plan.walls)
    if (poly.length < 3) continue
    const c = centroid(poly)
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const w = Math.max(500, maxX - minX), d = Math.max(500, maxY - minY)
    const id = safe(room.id)
    const sides = [
      { side: 'N', p: [c.x, maxY - d * 0.18, height * 0.55] as [number, number, number], t: [c.x, minY, height * 0.48] as [number, number, number], ow: w },
      { side: 'E', p: [minX + w * 0.18, c.y, height * 0.55] as [number, number, number], t: [maxX, c.y, height * 0.48] as [number, number, number], ow: d },
      { side: 'S', p: [c.x, minY + d * 0.18, height * 0.55] as [number, number, number], t: [c.x, maxY, height * 0.48] as [number, number, number], ow: w },
      { side: 'W', p: [maxX - w * 0.18, c.y, height * 0.55] as [number, number, number], t: [minX, c.y, height * 0.48] as [number, number, number], ow: d },
    ]
    for (const v of sides) {
      views.push({ key: `${id}:perspective:${v.side}`, name: `${room.name} ${v.side} perspective`, group: 'perspective', roomId: room.id, projection: 'perspective', position: v.p, target: v.t, up: [0, 0, 1], fov: 62, ortho: null, aspect: 16 / 9, visibility: { items: true, ceilings: 'auto' }, mirrorX: false, note: null })
      const outward = [v.p[0] - v.t[0], v.p[1] - v.t[1]]
      const mag = Math.hypot(...outward) || 1
      views.push({ key: `${id}:elevation:${v.side}`, name: `${room.name} ${v.side} elevation`, group: 'elevation', roomId: room.id, projection: 'orthographic', position: [v.t[0] + outward[0] / mag * 100, v.t[1] + outward[1] / mag * 100, height / 2], target: [v.t[0], v.t[1], height / 2], up: [0, 0, 1], fov: 45, ortho: { width: v.ow * 1.08, height: height * 1.08 }, aspect: Math.max(0.5, v.ow / height), visibility: { items: true, ceilings: 'show' }, mirrorX: false, note: 'Orthographic wall elevation' })
    }
    views.push({ key: `${id}:top`, name: `${room.name} top`, group: 'top', roomId: room.id, projection: 'orthographic', position: [c.x, c.y, height + Math.max(w, d)], target: [c.x, c.y, 0], up: [0, -1, 0], fov: 45, ortho: { width: w * 1.12, height: d * 1.12 }, aspect: w / d, visibility: { items: true, ceilings: 'hide' }, mirrorX: false, note: 'Top cutaway' })
    views.push({ key: `${id}:ceiling`, name: `${room.name} reflected ceiling`, group: 'ceiling', roomId: room.id, projection: 'orthographic', position: [c.x, c.y, 0], target: [c.x, c.y, height], up: [0, -1, 0], fov: 45, ortho: { width: w * 1.12, height: d * 1.12 }, aspect: w / d, visibility: { items: false, ceilings: 'show' }, mirrorX: true, note: 'Reflected ceiling plan' })
  }
  const pts = plan.walls.flatMap((w) => [w.a, w.b])
  if (pts.length) {
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x))
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y))
    const c: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, plan.wallHeight / 2]
    const span = Math.max(maxX - minX, maxY - minY, plan.wallHeight)
    views.push({ key: 'plan:isometric', name: 'Whole plan isometric', group: 'isometric', roomId: null, projection: 'perspective', position: [c[0] + span, c[1] + span, c[2] + span], target: c, up: [0, 0, 1], fov: 45, ortho: null, aspect: 16 / 9, visibility: { items: true, ceilings: 'hide' }, mirrorX: false, note: null })
  }
  return views
}
