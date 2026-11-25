import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPlan, type Plan } from '../../designer/plan'
import { buildCameras } from '../build/views'
import { compileRenderScene } from '../render/scene'
import { PNG } from 'pngjs'
import { autoExpose, downscale, mirrorX } from '../render/image'

function room(): Plan {
  const p = defaultPlan()
  const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, height: null, left: null, right: null })
  p.walls = [wall('w1', 0, 0, 5000, 0), wall('w2', 5000, 0, 5000, 4000), wall('w3', 5000, 4000, 0, 4000), wall('w4', 0, 4000, 0, 0)]
  p.rooms = [{ id: 'r1', name: 'Living', points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], floor: null, ceiling: null }]
  p.openings = [
    { id: 'o1', wallId: 'w1', type: 'window', offset: 2500, width: 1800, height: 1300, sill: 900, flip: false },
    { id: 'o2', wallId: 'w3', type: 'door', offset: 1000, width: 900, height: 2100, sill: 0, flip: false },
  ]
  p.items = [{ id: 'i1', name: 'Sofa', source: { kind: 'parametric', type: 'sofa' }, x: 2500, y: 3000, elevation: 0, rotation: 180, width: 2200, depth: 900, height: 820, params: { seats: 3 }, materials: {} }]
  p.fixtures = [{ id: 'f1', name: 'Downlight', kind: 'downlight', x: 2500, y: 2000, mount: null, size: 120, kelvin: 3000, on: true }]
  return p
}

test('render scene compiles watertight-ish geometry in metres with Blender axes', () => {
  const plan = room()
  const views = buildCameras(plan)
  const persp = views.find((v) => v.group === 'perspective')!
  const scene = compileRenderScene(plan, persp, { library: new Map(), models: new Map() })
  assert.ok(scene.meshes.length > 10)
  assert.ok(scene.lights.length >= 1)
  const xs = scene.meshes.flatMap((m) => m.positions.filter((_, i) => i % 3 === 0))
  const ys = scene.meshes.flatMap((m) => m.positions.filter((_, i) => i % 3 === 1))
  const zs = scene.meshes.flatMap((m) => m.positions.filter((_, i) => i % 3 === 2))
  assert.ok(Math.max(...xs) <= 5.15 && Math.min(...xs) >= -0.15) // 5 m room + half wall
  assert.ok(Math.min(...ys) >= -4.15 && Math.max(...ys) <= 0.15) // plan y flipped
  assert.ok(Math.max(...zs) <= 2.71)
  for (const m of scene.meshes) {
    assert.equal(m.positions.length / 3, m.uvs.length / 2)
    assert.ok(Math.max(...m.indices) < m.positions.length / 3)
  }
  // The sofa sits inside the room footprint.
  const sofa = scene.meshes.filter((m) => m.name.startsWith('item_i1'))
  assert.ok(sofa.length)
  const sx = sofa.flatMap((m) => m.positions.filter((_, i) => i % 3 === 0))
  assert.ok(Math.min(...sx) > 1.3 && Math.max(...sx) < 3.7)
})

test('wall faces leave the window and door holes open', () => {
  const plan = room()
  const scene = compileRenderScene(plan, buildCameras(plan)[0], { library: new Map(), models: new Map() })
  const face = scene.meshes.find((m) => m.name.startsWith('wall_w1_left'))!
  // Area of the wall face = 5.2 m x 2.7 m minus the 1.8 x 1.3 window hole (within the extension).
  let area = 0
  for (let i = 0; i < face.indices.length; i += 3) {
    const [a, b, c] = [face.indices[i], face.indices[i + 1], face.indices[i + 2]].map((k) => face.positions.slice(k * 3, k * 3 + 3))
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
  }
  assert.ok(Math.abs(area - (5.2 * 2.7 - 1.8 * 1.3)) < 0.05, `area ${area}`)
})

test('top view hides ceilings; exterior wall facing a camera outside is cut away', () => {
  const plan = room()
  const top = buildCameras(plan).find((v) => v.group === 'top')!
  const scene = compileRenderScene(plan, top, { library: new Map(), models: new Map() })
  assert.ok(!scene.meshes.some((m) => m.name.startsWith('ceiling_')))
  assert.ok(scene.stats.hidden.includes('ceilings'))
})

test('image helpers', () => {
  const png = new PNG({ width: 8, height: 4 })
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = png.data[i + 1] = png.data[i + 2] = 40; png.data[i + 3] = 255 }
  const { gain } = autoExpose(png, 120)
  assert.ok(gain > 1.5)
  assert.ok(png.data[0] > 60)
  png.data[0] = 1
  mirrorX(png)
  assert.equal(png.data[(7) * 4], 1)
  assert.equal(downscale(png, 4).width, 4)
})
