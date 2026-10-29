import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { centroid, roomInnerPolygon } from '@/lib/designer/geometry'
import { configureRenderer, initRectAreaLights, type CameraPose } from '@/lib/designer/render'
import { DesignScene, overviewCamera, toWorld, type PickTarget, type SceneContext } from '@/lib/designer/scene'
import type { Plan } from '@/lib/designer/types'

export interface ViewportApi {
  getPose: () => CameraPose
  setPose: (p: CameraPose) => void
  /** JPEG snapshot of the current view. */
  capture: (maxWidth?: number) => Promise<Blob | null>
  resetView: () => void
}

interface Props {
  plan: Plan
  ctx: SceneContext
  /** Bumped when the material library or model catalog changes. */
  ctxVersion: number
  selectionId: string | null
  mode: 'orbit' | 'walk'
  onPick: (t: PickTarget | null) => void
}

const EYE = 1.6

export const Viewport3D = forwardRef<ViewportApi, Props>(function Viewport3D({ plan, ctx, ctxVersion, selectionId, mode, onPick }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const state = useRef<{
    renderer: THREE.WebGLRenderer
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    ds: DesignScene
    keys: Set<string>
    look: { yaw: number; pitch: number }
  } | null>(null)
  const fittedRef = useRef(false)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  // Set up renderer, camera, controls and the render loop once.
  useEffect(() => {
    const host = hostRef.current!
    initRectAreaLights()
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    configureRenderer(renderer, 1)
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500)
    camera.position.set(6, 8, 10)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.495
    controls.screenSpacePanning = true

    const ds = new DesignScene(ctx)
    const keys = new Set<string>()
    const look = { yaw: 0, pitch: 0 }
    state.current = { renderer, camera, controls, ds, keys, look }

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    // Walk mode: drag to look, WASD / arrows to move.
    let dragging: { x: number; y: number; moved: boolean } | null = null
    const raycaster = new THREE.Raycaster()
    const onDown = (e: PointerEvent) => {
      dragging = { x: e.clientX, y: e.clientY, moved: false }
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - dragging.x
      const dy = e.clientY - dragging.y
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true
      if (modeRef.current === 'walk' && e.buttons) {
        look.yaw -= e.movementX * 0.004
        look.pitch = Math.max(-1.2, Math.min(1.2, look.pitch - e.movementY * 0.004))
      }
    }
    const onUp = (e: PointerEvent) => {
      const wasClick = dragging && !dragging.moved
      dragging = null
      if (!wasClick || e.button !== 0) return
      const r = renderer.domElement.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const hits = raycaster.intersectObjects(ds.pickables(), true)
      const visible = (o: THREE.Object3D | null): boolean => !o || (o.visible && visible(o.parent))
      const hit = hits.find((h) => h.object.userData.target && visible(h.object))
      onPickRef.current((hit?.object.userData.target as PickTarget) ?? null)
    }
    const el = renderer.domElement
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    const kd = (e: KeyboardEvent) => {
      if (modeRef.current === 'walk' && !isField(e.target)) keys.add(e.key.toLowerCase())
    }
    const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (modeRef.current === 'walk') {
        const fwd = new THREE.Vector3(-Math.sin(look.yaw), 0, -Math.cos(look.yaw))
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
        const v = new THREE.Vector3()
        if (keys.has('w') || keys.has('arrowup')) v.add(fwd)
        if (keys.has('s') || keys.has('arrowdown')) v.sub(fwd)
        if (keys.has('d') || keys.has('arrowright')) v.add(right)
        if (keys.has('a') || keys.has('arrowleft')) v.sub(right)
        if (v.lengthSq()) camera.position.addScaledVector(v.normalize(), 2.2 * dt)
        camera.position.y = EYE
        camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ')
      } else {
        controls.update()
      }
      camera.updateMatrixWorld()
      ds.applyCamera(camera)
      renderer.render(ds.scene, camera)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      controls.dispose()
      ds.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      host.removeChild(renderer.domElement)
      state.current = null
    }
    // ctx is stable for the editor's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rebuild the scene whenever the plan or its libraries change.
  useEffect(() => {
    const s = state.current
    if (!s) return
    s.ds.build(plan)
    s.ds.setSelection(selectionId)
    s.renderer.toneMappingExposure = plan.lighting.exposure
    if (!fittedRef.current && (plan.walls.length || plan.items.length)) {
      fittedRef.current = true
      const ov = overviewCamera(s.ds.bounds, s.camera.aspect)
      s.camera.position.copy(ov.position)
      s.controls.target.copy(ov.target)
    }
  }, [plan, ctxVersion, selectionId])

  // Switching modes: drop into the first room at eye height, or back to the overview.
  useEffect(() => {
    const s = state.current
    if (!s) return
    s.controls.enabled = mode === 'orbit'
    if (mode === 'walk') {
      const room = plan.rooms[0]
      const p = room ? centroid(roomInnerPolygon(room, plan.walls)) : null
      const pos = p ? toWorld(p, EYE) : new THREE.Vector3(s.controls.target.x, EYE, s.controls.target.z)
      s.camera.position.copy(pos)
      s.look.yaw = 0
      s.look.pitch = 0
    } else {
      const ov = overviewCamera(s.ds.bounds, s.camera.aspect)
      s.camera.position.copy(ov.position)
      s.controls.target.copy(ov.target)
      s.camera.lookAt(ov.target)
    }
    // Only on mode change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useImperativeHandle(
    ref,
    () => ({
      getPose: () => {
        const s = state.current!
        const dir = new THREE.Vector3()
        s.camera.getWorldDirection(dir)
        const target = modeRef.current === 'orbit' ? s.controls.target.clone() : s.camera.position.clone().add(dir.multiplyScalar(3))
        return { position: s.camera.position.clone(), target, fov: s.camera.fov }
      },
      setPose: (p) => {
        const s = state.current
        if (!s) return
        s.camera.fov = p.fov
        s.camera.updateProjectionMatrix()
        s.camera.position.copy(p.position)
        if (modeRef.current === 'orbit') {
          s.controls.target.copy(p.target)
        } else {
          const d = p.target.clone().sub(p.position).normalize()
          s.look.yaw = Math.atan2(-d.x, -d.z)
          s.look.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)))
        }
        s.camera.lookAt(p.target)
      },
      capture: async (maxWidth = 640) => {
        const s = state.current
        if (!s) return null
        s.renderer.render(s.ds.scene, s.camera)
        const src = s.renderer.domElement
        const scaleF = Math.min(1, maxWidth / src.width)
        const c = document.createElement('canvas')
        c.width = Math.round(src.width * scaleF)
        c.height = Math.round(src.height * scaleF)
        c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
        return new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.85))
      },
      resetView: () => {
        const s = state.current
        if (!s) return
        const ov = overviewCamera(s.ds.bounds, s.camera.aspect)
        s.camera.position.copy(ov.position)
        s.controls.target.copy(ov.target)
      },
    }),
    []
  )

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-zinc-200 dark:bg-zinc-900" data-testid="viewport-3d" />
})
