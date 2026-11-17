import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { config } from '../../config'
import { db, designAssets, designModels, intRenderSets, intRevisions, vizAssets, vizMaterials } from '../../db'
import type { MatRef, Plan } from '../../designer/plan'
import { sha256 } from '../../visualizer/imageCheck'
import type { ViewSpec } from '../build/views'
import type { SceneDoc } from '../contracts'
import { enqueueJob, JobError, registerJobHandler, type JobContext } from '../jobs'
import { RenderError, runBlender } from './blender'
import { enhanceRender } from './enhance'
import { autoExpose, decodePng, downscale, encodePng, mirrorX } from './image'
import { compileRenderScene, type LibraryTexture, type ModelFile } from './scene'

export type RenderOutput = {
  status: 'pending' | 'running' | 'complete' | 'failed'
  /** The image to show first: the verified photoreal image when there is one, else the raw render. */
  assetId: string | null
  /** Physically based Blender render (geometry ground truth). */
  rawAssetId?: string | null
  /** AI photoreal pass (null when disabled, failed or rejected). */
  enhancedAssetId?: string | null
  enhancement?: 'verified' | 'unverified' | 'rejected' | 'failed' | 'off'
  note?: string | null
  error: string | null
}

export const RENDER_QUALITY = {
  draft: { samples: 64, label: 'Draft' },
  presentation: { samples: 256, label: 'Presentation' },
  high_resolution: { samples: 768, label: 'High resolution' },
} as const

type RenderSetRow = typeof intRenderSets.$inferSelect
interface Manifest {
  views: ViewSpec[]
  label: string
  revisionNo: number
  sceneHash: string
  enhance?: boolean
  quality: { samples: number; preset: string; longSide: number }
}

/** Atomically updates one view's output and recomputes the set status. */
export async function updateRenderOutput(setId: string, viewKey: string, patch: Partial<RenderOutput>) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as typeof db
    const [set] = await t.select().from(intRenderSets).where(eq(intRenderSets.id, setId)).for('update').limit(1)
    if (!set) return null
    const outputs = { ...(set.outputs as Record<string, RenderOutput>) }
    if (!outputs[viewKey]) return null
    const previous = outputs[viewKey]
    outputs[viewKey] = { ...previous, ...patch }
    const values = Object.values(outputs)
    const status = values.every((o) => o.status === 'complete')
      ? 'complete'
      : values.every((o) => o.status === 'failed')
        ? 'failed'
        : values.some((o) => o.status === 'complete') && values.every((o) => o.status === 'complete' || o.status === 'failed')
          ? 'partially_complete'
          : 'running'
    await t.update(intRenderSets).set({ outputs, status }).where(eq(intRenderSets.id, set.id))
    return { set: { ...set, outputs, status }, previous }
  })
}

/** Queues one background job per view. Idempotent per (set, view, generation). */
export async function enqueueRenderSet(set: RenderSetRow, viewKeys?: string[], generation = 0) {
  const manifest = set.manifest as Manifest
  const keys = viewKeys ?? manifest.views.map((v) => v.key)
  for (const key of keys) {
    await enqueueJob(db, {
      userId: set.userId,
      workspaceId: set.workspaceId,
      type: 'render_view',
      targetId: set.id,
      idempotencyKey: `render:${set.id}:${key}:${generation}`,
      input: { viewKey: key },
      maxAttempts: 2,
    })
  }
}

// ── scene inputs from the database ──

function collectRefs(plan: Plan): MatRef[] {
  const refs: (MatRef | null | undefined)[] = []
  for (const w of plan.walls) refs.push(w.left, w.right)
  for (const r of plan.rooms) refs.push(r.floor, r.ceiling)
  for (const it of plan.items) refs.push(...Object.values(it.materials))
  for (const z of plan.ceilings ?? []) refs.push(z.material)
  for (const p of plan.panels ?? []) refs.push(p.material)
  return refs.filter((r): r is MatRef => !!r)
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

async function loadInputs(userId: string, plan: Plan, dir: string) {
  const library = new Map<string, LibraryTexture>()
  const ids = [...new Set(collectRefs(plan).flatMap((r) => (r.kind === 'library' ? [r.materialId] : [])))]
  if (ids.length) {
    const rows = await db.select().from(vizMaterials).where(and(inArray(vizMaterials.id, ids), eq(vizMaterials.userId, userId)))
    for (const m of rows) {
      let file: string | null = null
      if (m.kind === 'texture' && m.textureAssetId) {
        const [asset] = await db.select({ data: vizAssets.data, mime: vizAssets.mimeType }).from(vizAssets).where(eq(vizAssets.id, m.textureAssetId)).limit(1)
        const ext = asset && EXT[asset.mime]
        if (asset && ext) {
          file = `tex_${m.id}.${ext}`
          await writeFile(path.join(dir, file), asset.data as Buffer)
        }
      }
      const w = m.widthMm ? Number(m.widthMm) : 600
      const h = m.heightMm ? Number(m.heightMm) : m.widthMm && m.textureWidth && m.textureHeight ? (Number(m.widthMm) * m.textureHeight) / m.textureWidth : 600
      library.set(m.id, { colorHex: m.colorHex, file, widthMm: w || 600, heightMm: h || 600 })
    }
  }
  const models = new Map<string, ModelFile>()
  const modelIds = [...new Set(plan.items.flatMap((i) => (i.source.kind === 'model' ? [i.source.modelId] : [])))]
  if (modelIds.length) {
    const rows = await db.select().from(designModels).where(and(inArray(designModels.id, modelIds), eq(designModels.userId, userId)))
    for (const m of rows) {
      const [asset] = await db.select({ data: designAssets.data }).from(designAssets).where(eq(designAssets.id, m.glbAssetId)).limit(1)
      if (!asset) continue
      const file = `model_${m.id}.glb`
      await writeFile(path.join(dir, file), asset.data as Buffer)
      models.set(m.id, { file, widthMm: Number(m.widthMm), depthMm: Number(m.depthMm), heightMm: Number(m.heightMm) })
    }
  }
  return { library, models }
}

async function storeImage(set: RenderSetRow, manifest: Manifest, view: ViewSpec, png: Buffer, width: number, height: number, variant: 'raw' | 'photoreal') {
  const assetId = crypto.randomUUID()
  const label = manifest.label === 'final' ? '' : ' · DRAFT'
  const tag = variant === 'raw' ? ' (3D render)' : ''
  await db.insert(designAssets).values({
    id: assetId,
    userId: set.userId,
    projectId: set.designProjectId,
    kind: 'render',
    name: `${view.name} · R${manifest.revisionNo}${label}${tag}.png`.slice(0, 480),
    mimeType: 'image/png',
    size: png.length,
    width,
    height,
    sha256: sha256(png),
    meta: {
      camera: view.name,
      samples: manifest.quality.samples,
      preset: manifest.quality.preset,
      interior: { renderSetId: set.id, revisionNo: manifest.revisionNo, sceneHash: manifest.sceneHash, viewKey: view.key, group: view.group, label: manifest.label, projection: view.projection, variant, renderer: variant === 'raw' ? 'blender-cycles' : config.interior.render.imageModel },
    },
    data: png,
  })
  return assetId
}

function dims(view: ViewSpec, longSide: number) {
  const aspect = view.aspect || 16 / 9
  return aspect >= 1 ? { width: longSide, height: Math.max(64, Math.round(longSide / aspect)) } : { width: Math.max(64, Math.round(longSide * aspect)), height: longSide }
}

async function handleRenderView(ctx: JobContext) {
  const { viewKey } = ctx.job.input as { viewKey: string }
  const [set] = await db.select().from(intRenderSets).where(eq(intRenderSets.id, ctx.job.targetId)).limit(1)
  if (!set) throw new JobError('NOT_FOUND', 'Render set no longer exists')
  const manifest = set.manifest as Manifest
  const view = manifest.views.find((v) => v.key === viewKey)
  if (!view) throw new JobError('NOT_FOUND', `Unknown view ${viewKey}`)
  const prior = (set.outputs as Record<string, RenderOutput>)[viewKey]
  if (prior?.status === 'complete') return { skipped: true }
  const [rev] = await db.select().from(intRevisions).where(eq(intRevisions.id, set.revisionId)).limit(1)
  if (!rev) throw new JobError('NOT_FOUND', 'Revision no longer exists')
  const plan = (rev.scene as SceneDoc).plan as unknown as Plan

  await updateRenderOutput(set.id, viewKey, { status: 'running', error: null })
  const dir = path.join(os.tmpdir(), 'klyent-render', ctx.job.id)
  await mkdir(dir, { recursive: true })
  try {
    await ctx.checkpoint({ stage: 'compile' })
    const inputs = await loadInputs(set.userId, plan, dir)
    const scene = compileRenderScene(plan, view, inputs)
    if (!scene.meshes.length) throw new JobError('EMPTY_SCENE', 'The model has no geometry to render.')
    const sceneJson = path.join(dir, 'scene.json')
    await writeFile(sceneJson, JSON.stringify(scene))
    const { width, height } = dims(view, manifest.quality.longSide)
    const outPng = path.join(dir, 'render.png')

    await ctx.checkpoint({ stage: 'render', triangles: scene.stats.triangles, lights: scene.stats.lights })
    ctx.log.info({ view: viewKey, triangles: scene.stats.triangles, lights: scene.stats.lights, samples: manifest.quality.samples }, 'interior render: blender start')
    try {
      await runBlender({ sceneJson, outPng, width, height, samples: manifest.quality.samples })
    } catch (err) {
      if (err instanceof RenderError) throw new JobError(err.code, err.message, err.retryable)
      throw err
    }
    await ctx.checkpoint({ stage: 'post' })

    const png = decodePng(await readFile(outPng))
    if (plan.lighting.preset !== 'night') autoExpose(png, view.group === 'perspective' ? 112 : 128)
    if (view.mirrorX) mirrorX(png)
    const rawBuf = encodePng(png)

    let enhancement: RenderOutput['enhancement'] = 'off'
    let note: string | null = null
    let enhancedBuf: Buffer | null = null
    let enhancedDims = { width, height }
    const wantsEnhance = manifest.enhance !== false && config.interior.render.enhance && (view.group === 'perspective' || view.group === 'isometric')
    if (wantsEnhance) {
      await ctx.checkpoint({ stage: 'photoreal' })
      const reference = encodePng(downscale(png, 1536))
      const res = await enhanceRender(reference, plan, view, width / height, (m) => ctx.log.warn({ view: viewKey }, m))
      if (!res) {
        enhancement = 'failed'
        note = 'The photoreal pass was unavailable; this is the physically based render.'
      } else if (res.verified === false) {
        enhancement = 'rejected'
        note = `The photoreal pass changed the model (${res.issues.slice(0, 3).join('; ') || 'fidelity check failed'}), so the exact render is shown.`
      } else {
        enhancement = res.verified ? 'verified' : 'unverified'
        enhancedBuf = res.png
        const out = decodePng(res.png)
        enhancedDims = { width: out.width, height: out.height }
      }
    }
    if (!(await ctx.stillOwner())) throw new JobError('LEASE_LOST', 'Worker lost its lease', true)

    const rawAssetId = await storeImage(set, manifest, view, rawBuf, width, height, 'raw')
    const enhancedAssetId = enhancedBuf ? await storeImage(set, manifest, view, enhancedBuf, enhancedDims.width, enhancedDims.height, 'photoreal') : null
    const result = await updateRenderOutput(set.id, viewKey, {
      status: 'complete',
      assetId: enhancedAssetId ?? rawAssetId,
      rawAssetId,
      enhancedAssetId,
      enhancement,
      note,
      error: null,
    })
    // Replace assets from an earlier attempt of the same view.
    const old = [prior?.assetId, prior?.rawAssetId, prior?.enhancedAssetId].filter((id): id is string => !!id)
    for (const id of new Set(old)) await db.delete(designAssets).where(and(eq(designAssets.id, id), eq(designAssets.userId, set.userId)))
    return { enhancement, triangles: scene.stats.triangles, setStatus: result?.set.status }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

registerJobHandler('render_view', handleRenderView)

/** Called by the job runner when a render job fails for good. */
export async function onRenderJobFailed(job: { targetId: string; input: unknown; error: string | null }) {
  const viewKey = (job.input as { viewKey?: string } | null)?.viewKey
  if (!viewKey) return
  await updateRenderOutput(job.targetId, viewKey, { status: 'failed', error: (job.error ?? 'Render failed').slice(0, 500) })
}
