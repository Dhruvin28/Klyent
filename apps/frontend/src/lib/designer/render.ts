import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { EquirectCamera, WebGLPathTracer } from 'three-gpu-pathtracer'
import { DesignScene, overviewCamera, type SceneContext } from './scene'
import type { Plan, SavedCamera } from './types'

let rectAreaReady = false
/** RectAreaLight needs its lookup tables registered once before raster rendering. */
export function initRectAreaLights() {
  if (rectAreaReady) return
  RectAreaLightUniformsLib.init()
  rectAreaReady = true
}

export function configureRenderer(renderer: THREE.WebGLRenderer, exposure: number) {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = exposure
}

export interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

export function poseFromSaved(c: SavedCamera): CameraPose {
  return { position: new THREE.Vector3(...c.position), target: new THREE.Vector3(...c.target), fov: c.fov }
}

export const RENDER_SIZES = {
  hd: { label: 'HD 1280×720', width: 1280, height: 720 },
  fhd: { label: 'Full HD 1920×1080', width: 1920, height: 1080 },
  qhd: { label: '2K 2560×1440', width: 2560, height: 1440 },
  uhd: { label: '4K 3840×2160', width: 3840, height: 2160 },
} as const
export type RenderSize = keyof typeof RENDER_SIZES

export const PANORAMA_SIZES = {
  draft: { label: '2K (2048×1024)', width: 2048, height: 1024 },
  high: { label: '4K (4096×2048)', width: 4096, height: 2048 },
} as const
export type PanoramaSize = keyof typeof PANORAMA_SIZES

export const QUALITY = {
  draft: { label: 'Draft', samples: 64 },
  standard: { label: 'Standard', samples: 256 },
  high: { label: 'High', samples: 768 },
} as const
export type Quality = keyof typeof QUALITY

export interface TraceJob {
  kind: 'render' | 'panorama'
  width: number
  height: number
  samples: number
  pose: CameraPose
}

export interface TraceHandle {
  canvas: HTMLCanvasElement
  /** Resolves with the finished image (or the best so far when stopped early). */
  done: Promise<Blob>
  /** Stops tracing and resolves `done` with the current image. */
  finish: () => void
  /** Stops tracing and rejects `done`. */
  cancel: () => void
}

/**
 * Path-traces a plan on the user's GPU into its own canvas. The scene is rebuilt from
 * the plan so the editor viewport keeps running untouched.
 */
export function pathTrace(plan: Plan, ctx: SceneContext, job: TraceJob, onProgress: (samples: number, phase: 'loading' | 'tracing') => void): TraceHandle {
  const canvas = document.createElement('canvas')
  let stop: 'finish' | 'cancel' | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let tracer: WebGLPathTracer | null = null
  let ds: DesignScene | null = null

  const cleanup = () => {
    tracer?.dispose()
    ds?.dispose()
    renderer?.dispose()
    renderer?.forceContextLoss()
  }

  const done = (async () => {
    onProgress(0, 'loading')
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(job.width, job.height, false)
    configureRenderer(renderer, plan.lighting.exposure)

    ds = new DesignScene(ctx)
    ds.build(plan)
    await ds.ready()

    let camera: THREE.Camera
    if (job.kind === 'panorama') {
      const eq = new EquirectCamera()
      eq.position.copy(job.pose.position)
      camera = eq
    } else {
      const pc = new THREE.PerspectiveCamera(job.pose.fov, job.width / job.height, 0.05, 500)
      pc.position.copy(job.pose.position)
      pc.lookAt(job.pose.target)
      camera = pc
    }
    camera.updateMatrixWorld()
    ds.applyCamera(camera)
    ds.scene.updateMatrixWorld(true)

    tracer = new WebGLPathTracer(renderer)
    tracer.bounces = 6
    tracer.transmissiveBounces = 6
    tracer.filterGlossyFactor = 0.5
    tracer.minSamples = 0
    tracer.renderDelay = 0
    tracer.fadeDuration = 0
    tracer.dynamicLowRes = false
    tracer.renderToCanvas = true
    // Large frames are traced in tiles so the browser stays responsive.
    const tiles = job.width * job.height > 2_500_000 ? 3 : job.width * job.height > 1_000_000 ? 2 : 1
    tracer.tiles.set(tiles, tiles)
    if (stop === 'cancel') throw new DOMException('Render cancelled', 'AbortError')
    await tracer.setSceneAsync(ds.scene, camera)

    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (stop === 'cancel') return reject(new DOMException('Render cancelled', 'AbortError'))
        if (stop === 'finish' || tracer!.samples >= job.samples) return resolve()
        try {
          tracer!.renderSample()
        } catch (e) {
          return reject(e)
        }
        onProgress(Math.floor(tracer!.samples), 'tracing')
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the render'))), 'image/jpeg', 0.92)
    )
  })().finally(cleanup)

  return {
    canvas,
    done,
    finish: () => {
      stop = stop ?? 'finish'
    },
    cancel: () => {
      stop = 'cancel'
    },
  }
}

// ── Walkthrough video ──

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Camera pose at time t ∈ [0,1] along the walkthrough. */
export function walkthroughPose(t: number, path: CameraPose[] | null, bounds: THREE.Box3): CameraPose {
  if (path && path.length >= 2) {
    const seg = Math.min(path.length - 2, Math.floor(t * (path.length - 1)))
    const local = smooth(t * (path.length - 1) - seg)
    const a = path[seg]
    const b = path[seg + 1]
    return {
      position: a.position.clone().lerp(b.position, local),
      target: a.target.clone().lerp(b.target, local),
      fov: a.fov + (b.fov - a.fov) * local,
    }
  }
  // Orbit around the plan from a raised viewpoint.
  const ov = overviewCamera(bounds, 16 / 9)
  const c = ov.target
  const off = ov.position.clone().sub(c)
  const r = Math.hypot(off.x, off.z)
  const ang = Math.atan2(off.z, off.x) + t * Math.PI * 2
  return { position: new THREE.Vector3(c.x + Math.cos(ang) * r, ov.position.y * 0.8, c.z + Math.sin(ang) * r), target: c.clone(), fov: 50 }
}

export function videoMimeType(): string | null {
  for (const t of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}

export interface VideoHandle {
  canvas: HTMLCanvasElement
  done: Promise<Blob>
  cancel: () => void
}

/** Records a real-time rasterised walkthrough (orbit, or a path through saved views). */
export function recordWalkthrough(
  plan: Plan,
  ctx: SceneContext,
  opts: { width: number; height: number; seconds: number; path: CameraPose[] | null },
  onProgress: (fraction: number) => void
): VideoHandle {
  const canvas = document.createElement('canvas')
  let cancelled = false
  const mime = videoMimeType()
  const done = (async () => {
    if (!mime) throw new Error('This browser cannot record video. Try Chrome, Edge or Firefox.')
    initRectAreaLights()
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(opts.width, opts.height, false)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    configureRenderer(renderer, plan.lighting.exposure)
    const ds = new DesignScene(ctx)
    try {
      ds.build(plan)
      await ds.ready()
      const camera = new THREE.PerspectiveCamera(50, opts.width / opts.height, 0.05, 500)
      const stream = canvas.captureStream(30)
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.width >= 1920 ? 12_000_000 : 6_000_000 })
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      const stopped = new Promise<void>((r) => (rec.onstop = () => r()))
      const frame = (t: number) => {
        const pose = walkthroughPose(t, opts.path, ds.bounds)
        camera.fov = pose.fov
        camera.updateProjectionMatrix()
        camera.position.copy(pose.position)
        camera.lookAt(pose.target)
        camera.updateMatrixWorld()
        ds.applyCamera(camera)
        renderer.render(ds.scene, camera)
      }
      frame(0)
      rec.start(250)
      const start = performance.now()
      const total = opts.seconds * 1000
      await new Promise<void>((resolve) => {
        const tick = () => {
          const t = Math.min(1, (performance.now() - start) / total)
          if (cancelled) return resolve()
          frame(t)
          onProgress(t)
          if (t >= 1) return resolve()
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      rec.stop()
      await stopped
      stream.getTracks().forEach((tr) => tr.stop())
      if (cancelled) throw new DOMException('Recording cancelled', 'AbortError')
      return new Blob(chunks, { type: mime.split(';')[0] })
    } finally {
      ds.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    }
  })()
  return {
    canvas,
    done,
    cancel: () => {
      cancelled = true
    },
  }
}
