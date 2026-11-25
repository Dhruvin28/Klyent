import { NodeIO, getBounds } from '@gltf-transform/core'

// Poly Haven (https://polyhaven.com) publishes CC0 models. We list them through their
// public API and pack the 1k glTF + textures into one GLB so the catalog works offline
// from our own storage afterwards.

const API = 'https://api.polyhaven.com'
const DL_PREFIX = 'https://dl.polyhaven.org/'
const USER_AGENT = 'Klyent-3D-Designer/1.0'
const LIST_TTL_MS = 12 * 60 * 60 * 1000

export class UpstreamError extends Error {
  statusCode = 502
}

export interface PolyHavenEntry {
  id: string
  name: string
  categories: string[]
  dimensions: [number, number, number] | null
  thumbnailUrl: string
}

async function fetchOk(url: string, what: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) })
  } catch (err) {
    throw new UpstreamError(`Could not reach Poly Haven (${what}): ${(err as Error).message}`)
  }
  if (!res.ok) throw new UpstreamError(`Poly Haven returned ${res.status} for ${what}`)
  return res
}

export function thumbnailUrl(id: string) {
  return `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`
}

const listCache = new Map<string, { at: number; entries: PolyHavenEntry[] }>()

export async function listModels(category: string): Promise<PolyHavenEntry[]> {
  const hit = listCache.get(category)
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.entries
  const url = `${API}/assets?t=models${category ? `&c=${encodeURIComponent(category)}` : ''}`
  const json = (await (await fetchOk(url, 'model list')).json()) as Record<string, { name?: string; categories?: string[]; dimensions?: number[] }>
  const entries = Object.entries(json)
    .map(([id, a]) => ({
      id,
      name: a.name || id,
      categories: Array.isArray(a.categories) ? a.categories : [],
      dimensions:
        Array.isArray(a.dimensions) && a.dimensions.length === 3 && a.dimensions.every((n) => Number.isFinite(n))
          ? (a.dimensions as [number, number, number])
          : null,
      thumbnailUrl: thumbnailUrl(id),
    }))
    .sort((x, y) => x.name.localeCompare(y.name))
  listCache.set(category, { at: Date.now(), entries })
  return entries
}

/** Looks up one asset's catalog entry (name/categories). */
export async function getModelInfo(id: string): Promise<{ name: string; categories: string[] }> {
  const json = (await (await fetchOk(`${API}/info/${encodeURIComponent(id)}`, 'model info')).json()) as { name?: string; categories?: string[]; type?: number }
  if (json.type !== undefined && json.type !== 2) throw Object.assign(new Error('Not a Poly Haven model'), { statusCode: 400 })
  return { name: json.name || id, categories: Array.isArray(json.categories) ? json.categories : [] }
}

interface FileRef {
  url: string
  size?: number
  include?: Record<string, { url: string; size?: number }>
}

export interface PackedModel {
  glb: Buffer
  widthMm: number
  depthMm: number
  heightMm: number
  thumbnail: Buffer | null
}

async function download(url: string, budget: { left: number }, what: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!url.startsWith(DL_PREFIX)) throw new UpstreamError(`Unexpected download location for ${what}`)
  const res = await fetchOk(url, what)
  const buf = new Uint8Array(await res.arrayBuffer())
  budget.left -= buf.byteLength
  if (budget.left < 0) throw Object.assign(new Error('This model is too large to import'), { statusCode: 413 })
  return buf
}

/** Downloads the 1k (fallback 2k) glTF of a Poly Haven model and packs it as one GLB. */
export async function packModel(id: string, maxBytes: number): Promise<PackedModel> {
  const files = (await (await fetchOk(`${API}/files/${encodeURIComponent(id)}`, 'model files')).json()) as {
    gltf?: Record<string, { gltf?: FileRef }>
  }
  const ref = files.gltf?.['1k']?.gltf ?? files.gltf?.['2k']?.gltf
  if (!ref?.url) throw new UpstreamError('Poly Haven has no glTF download for this model')

  const budget = { left: maxBytes }
  const json = JSON.parse(Buffer.from(await download(ref.url, budget, 'glTF')).toString('utf8'))
  const resources: Record<string, Uint8Array<ArrayBuffer>> = {}
  for (const [path, inc] of Object.entries(ref.include ?? {})) {
    resources[path] = await download(inc.url, budget, path)
  }

  const io = new NodeIO()
  const doc = await io.readJSON({ json, resources })
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  if (!scene) throw new UpstreamError('The downloaded model has no scene')
  const { min, max } = getBounds(scene)
  const glb = Buffer.from(await io.writeBinary(doc))

  let thumbnail: Buffer | null = null
  try {
    const res = await fetch(thumbnailUrl(id), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
    if (res.ok) thumbnail = Buffer.from(await res.arrayBuffer())
  } catch {
    // A missing thumbnail is not worth failing the import for.
  }

  const mm = (n: number) => Math.max(1, Math.round(n * 1000 * 100) / 100)
  return { glb, widthMm: mm(max[0] - min[0]), heightMm: mm(max[1] - min[1]), depthMm: mm(max[2] - min[2]), thumbnail }
}
