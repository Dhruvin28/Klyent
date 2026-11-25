import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/** Interactive 360° viewer for an equirectangular image: drag to look around, scroll to zoom. */
export function PanoramaViewer({ src, className }: { src: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.style.cursor = 'grab'

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100)
    const geo = new THREE.SphereGeometry(10, 64, 32)
    geo.scale(-1, 1, 1) // view from inside
    const mat = new THREE.MeshBasicMaterial({ color: 0x222222 })
    const sphere = new THREE.Mesh(geo, mat)
    scene.add(sphere)
    let disposed = false
    new THREE.TextureLoader().load(src, (tex) => {
      if (disposed) return tex.dispose()
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      mat.map = tex
      mat.color.set(0xffffff)
      mat.needsUpdate = true
    })

    let lon = 0
    let lat = 0
    let drag: { x: number; y: number; lon: number; lat: number } | null = null
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

    const el = renderer.domElement
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
      drag = { x: e.clientX, y: e.clientY, lon, lat }
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const k = camera.fov / (host.clientHeight || 1)
      lon = drag.lon - (e.clientX - drag.x) * k
      lat = Math.max(-85, Math.min(85, drag.lat + (e.clientY - drag.y) * k))
    }
    const up = () => {
      drag = null
      el.style.cursor = 'grab'
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      camera.fov = Math.max(30, Math.min(100, camera.fov + e.deltaY * 0.05))
      camera.updateProjectionMatrix()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: false })

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      // The path tracer's equirect camera puts -Z (forward) at the image centre.
      const phi = THREE.MathUtils.degToRad(90 - lat)
      const theta = THREE.MathUtils.degToRad(lon)
      camera.lookAt(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta))
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
      mat.map?.dispose()
      mat.dispose()
      geo.dispose()
      renderer.dispose()
      host.removeChild(el)
    }
  }, [src])

  return <div ref={hostRef} className={className ?? 'h-full w-full'} />
}
