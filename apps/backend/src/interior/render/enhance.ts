import { PNG } from 'pngjs'
import { config } from '../../config'
import { openai } from '../../lib/openai'
import type { Plan, MatRef } from '../../designer/plan'
import type { ViewSpec } from '../build/views'
import { structureScore } from './image'

// Photoreal pass. The guide render (render/guide.ts) is the geometric ground truth: every wall,
// opening and piece of furniture is exactly where the drawings put it. An OpenAI image model
// upgrades its surfaces and light; each candidate is then checked three ways before it is
// allowed to replace the exact render:
//   1. a structured vision audit of framing, structure, openings and furniture;
//   2. a deterministic structural-correlation score against the guide's edges;
//   3. the best verified candidate wins, with one targeted corrective round if none pass.

export interface EnhanceGuide {
  png: Buffer
  /** Decoded guide size; the AI image is requested at exactly this size. */
  width: number
  height: number
  /** Structural edge mask (width*height) from the guide renderer. */
  edges: Uint8Array
}

export interface EnhanceResult {
  png: Buffer
  verified: boolean | null
  issues: string[]
  attempts: number
  model: string
  /** 0..100 audit score of the chosen candidate. */
  score: number | null
  /** Structural correlation of the chosen candidate (-1..1), null if not measured. */
  structure: number | null
  candidates: number
}

export type ImageSize = '1536x1024' | '1024x1536' | '1024x1024'

const MM_TO_M = (mm: number) => (mm / 1000).toFixed(2).replace(/\.00$/, '')

/** The API's supported size closest to the view's aspect. The guide is rendered at this size. */
export function pickSize(aspect: number): ImageSize {
  if (aspect >= 1.2) return '1536x1024'
  if (aspect <= 0.83) return '1024x1536'
  return '1024x1024'
}
export function sizeDims(size: ImageSize): { width: number; height: number } {
  const [w, h] = size.split('x').map(Number)
  return { width: w, height: h }
}

// ── prompt ──

const NAMED: [string, number, number, number][] = [
  ['white', 0, 0, 0.97], ['off-white', 40, 0.12, 0.93], ['cream', 45, 0.3, 0.9], ['beige', 38, 0.25, 0.8], ['light grey', 0, 0, 0.78], ['grey', 0, 0, 0.55], ['charcoal', 0, 0, 0.25], ['black', 0, 0, 0.08],
]
function colourName(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return hex
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let hue = 0
  if (d) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  hue = (hue * 60 + 360) % 360
  const tone = l > 0.85 ? 'very light ' : l > 0.65 ? 'light ' : l < 0.18 ? 'very dark ' : l < 0.35 ? 'dark ' : ''
  if (s < 0.12) return NAMED.reduce((best, n) => (Math.abs(n[3] - l) < Math.abs(best[3] - l) ? n : best), NAMED[0])[0]
  const family = hue < 15 || hue >= 345 ? 'red' : hue < 40 ? (l < 0.45 ? 'brown' : 'terracotta/orange') : hue < 65 ? (s < 0.35 ? 'beige/sand' : 'yellow/ochre') : hue < 160 ? 'green' : hue < 200 ? 'teal' : hue < 260 ? 'blue' : hue < 300 ? 'purple' : 'pink/rose'
  return `${tone}${family}`
}

export type MaterialNames = Map<string, string>

function describeMat(ref: MatRef | null | undefined, names: MaterialNames): string | null {
  if (!ref) return null
  if (ref.kind === 'library') return names.get(ref.materialId) ?? 'library material finish'
  const finish = ref.metalness && ref.metalness > 0.5 ? 'metallic' : ref.roughness < 0.25 ? 'glossy' : ref.roughness < 0.5 ? 'satin' : 'matte'
  const pattern = ref.pattern === 'wood' ? ' wood grain' : ref.pattern === 'fabric' ? ' fabric weave' : ref.pattern === 'plaster' ? ' plaster' : ''
  return `${colourName(ref.hex)}${pattern}, ${finish}`
}

function pointNear(i: { x: number; y: number }, poly: { x: number; y: number }[], pad = 600) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y)
  return i.x >= Math.min(...xs) - pad && i.x <= Math.max(...xs) + pad && i.y >= Math.min(...ys) - pad && i.y <= Math.max(...ys) + pad
}

/** Where a plan point sits in the picture: "left/centre/right, near/mid/far" or null if out of frame. */
function framePosition(view: ViewSpec, p: { x: number; y: number }, aspect: number): string | null {
  if (view.projection !== 'perspective') return null
  const fx = view.target[0] - view.position[0], fy = view.target[1] - view.position[1]
  const fl = Math.hypot(fx, fy) || 1
  const f = { x: fx / fl, y: fy / fl }
  const r = { x: -f.y, y: f.x }
  const dx = p.x - view.position[0], dy = p.y - view.position[1]
  const forward = dx * f.x + dy * f.y
  if (forward <= 100) return null
  const side = dx * r.x + dy * r.y
  const halfH = Math.atan(Math.tan((view.fov * Math.PI) / 360) * aspect)
  const ang = Math.atan2(side, forward)
  if (Math.abs(ang) > halfH * 1.05) return null
  const t = ang / halfH
  const where = t < -0.55 ? 'far left' : t < -0.18 ? 'left' : t <= 0.18 ? 'centre' : t <= 0.55 ? 'right' : 'far right'
  const dist = forward < 2200 ? 'foreground' : forward < 4800 ? 'midground' : 'background'
  return `${where}, ${dist}`
}

function describeScene(plan: Plan, view: ViewSpec, names: MaterialNames, aspect: number): string {
  const room = view.roomId ? plan.rooms.find((r) => r.id === view.roomId) : null
  const lines: string[] = []
  lines.push(`SPACE: ${room ? room.name : 'whole residence'}. Ceiling height ${MM_TO_M(plan.wallHeight)} m. Camera eye height ${MM_TO_M(view.position[2])} m, ${Math.round(view.fov)}° vertical field of view${view.projection === 'perspective' ? '' : ' (orthographic)'}.`)
  if (room) {
    const floor = describeMat(room.floor, names), ceil = describeMat(room.ceiling, names)
    const inRoomWalls = plan.walls.filter((w) => pointNear({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, room.points, 150))
    const wallFinish = new Set<string>()
    for (const w of inRoomWalls) for (const m of [w.left, w.right]) { const d = describeMat(m, names); if (d) wallFinish.add(d) }
    lines.push(`FINISH SCHEDULE (keep these colours and materials): floor — ${floor ?? 'neutral stone/wood floor as in the guide'}; ceiling — ${ceil ?? 'white'}; walls — ${[...wallFinish].join(' | ') || 'as coloured in the guide'}.`)
  }
  const items = plan.items.filter((i) => !room || pointNear(i, room.points)).slice(0, 40)
  if (items.length) {
    const rows = items.map((i) => {
      const slots = Object.entries(i.materials ?? {}).map(([k, m]) => { const d = describeMat(m as MatRef, names); return d ? `${k}: ${d}` : null }).filter(Boolean)
      const pos = framePosition(view, i, aspect)
      return `- ${i.name} (${MM_TO_M(i.width)}×${MM_TO_M(i.depth)}×${MM_TO_M(i.height)} m)${pos ? ` at ${pos}` : ' (not in frame)'}${slots.length ? `; ${slots.join(', ')}` : ''}`
    })
    lines.push('FURNITURE AND FIXTURES — every one must stay, in the same place, count and proportion (do not add, remove, merge, move or resize any):\n' + rows.join('\n'))
  }
  const ops = plan.openings
    .map((o) => {
      const w = plan.walls.find((x) => x.id === o.wallId)
      if (!w || (room && !pointNear({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, room.points, 150))) return null
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1
      const p = { x: w.a.x + ((w.b.x - w.a.x) * o.offset) / L, y: w.a.y + ((w.b.y - w.a.y) * o.offset) / L }
      const pos = framePosition(view, p, aspect)
      return pos ? `- ${o.type} ${MM_TO_M(o.width)}×${MM_TO_M(o.height)} m at ${pos}` : null
    })
    .filter(Boolean)
  if (ops.length) lines.push('OPENINGS IN FRAME (keep exactly these, same size and position; add no others):\n' + ops.join('\n'))
  const light = plan.lighting.preset
  lines.push(`LIGHTING: ${light === 'night' ? 'night, warm artificial interior lighting only' : `${light} daylight entering through the openings with warm ${plan.lighting.lightTemp} K interior lights`}.`)
  return lines.join('\n')
}

function enhancePrompt(plan: Plan, view: ViewSpec, names: MaterialNames, aspect: number, extra: string[]) {
  const kind = view.group === 'perspective' || view.group === 'isometric' ? 'interior photograph' : 'architectural visualisation'
  return [
    `Turn this clean 3D model render into a photorealistic ${kind} of a real, professionally finished, lived-in interior, as shot by an architectural photographer on a full-frame camera with a 24mm tilt-shift lens (verticals perfectly straight).`,
    'THE GEOMETRY IS FIXED AND VERIFIED. The input is a dimension-accurate model: the dark outlines mark real edges. Keep the exact camera position, framing and aspect; every wall, ceiling level and step, door, window, column, cabinet and piece of furniture must stay in precisely the same place, size, proportion and count. Do not add, remove, move, resize or restyle any structural element or object. No people, text, logos, extra windows or doors. Output ONE single image, not a collage or multiple views.',
    'WHAT TO IMPROVE: surfaces and light only. Real material detail (wood grain with natural variation, woven fabric with folds and stitching, plaster texture, stone/tile with grout, brushed metal, glass with correct reflections), crisp bevels, contact shadows, ambient occlusion where objects meet floor and walls, physically plausible soft global illumination, accurate reflections, natural window light with fall-off, subtle depth of field. Remove the clay/CG look and the dark outline strokes — they are guides, not part of the picture. Keep the colour palette and finishes of the model. Make objects look like real manufactured products (handles, hinges, seams, cushions, trim, skirting) consistent with their existing shapes.',
    describeScene(plan, view, names, aspect),
    ...extra,
  ].join('\n\n')
}

// ── OpenAI image edit ──

async function editImage(png: Buffer, prompt: string, size: string): Promise<Buffer> {
  // Long image jobs occasionally drop the connection ("terminated"); retry once.
  try {
    return await editImageOnce(png, prompt, size)
  } catch (err) {
    if (/terminated|fetch failed|ECONNRESET|socket|5\d\d/i.test(String((err as Error)?.message ?? err) + String((err as any)?.cause?.message ?? ''))) return editImageOnce(png, prompt, size)
    throw err
  }
}

async function editImageOnce(png: Buffer, prompt: string, size: string): Promise<Buffer> {
  const build = (withFidelity: boolean) => {
    const form = new FormData()
    form.append('model', config.interior.render.imageModel)
    form.append('prompt', prompt)
    form.append('size', size)
    form.append('quality', config.interior.render.imageQuality)
    form.append('n', '1')
    if (withFidelity) form.append('input_fidelity', 'high')
    form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'render.png')
    return form
  }
  const post = (form: FormData) =>
    fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${config.openai.apiKey}` }, body: form, signal: AbortSignal.timeout(config.interior.render.enhanceTimeoutMs) })
  let res = await post(build(true))
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Some image models reject input_fidelity; retry once without it.
    if (res.status === 400 && /input_fidelity/i.test(text)) res = await post(build(false))
    else throw new Error(`Image edit failed (${res.status}): ${text.slice(0, 300)}`)
    if (!res.ok) throw new Error(`Image edit failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`)
  }
  return readImage(await res.json())
}

async function readImage(json: any): Promise<Buffer> {
  const item = json?.data?.[0]
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64')
  if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer())
  throw new Error('Image edit returned no image')
}

// ── audit ──

interface Audit {
  framing: boolean
  structure: boolean
  openings: boolean
  furniture: boolean
  additions: boolean
  score: number
  issues: string[]
}
const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['framing_matches', 'structure_matches', 'openings_match', 'furniture_matches', 'nothing_added', 'score', 'issues'],
  properties: {
    framing_matches: { type: 'boolean', description: 'Same camera position, field of view and aspect: the same things are cut off at the same edges.' },
    structure_matches: { type: 'boolean', description: 'Walls, ceiling edges/steps, columns and floor boundaries are in the same places.' },
    openings_match: { type: 'boolean', description: 'Every door and window is present, with the same position and size, and none added.' },
    furniture_matches: { type: 'boolean', description: 'Every furniture piece and fixture is present, in the same place with similar size/proportion, none missing or merged.' },
    nothing_added: { type: 'boolean', description: 'No people, text, logos, collage or invented major objects.' },
    score: { type: 'integer', description: '0-100 overall geometric fidelity; 100 means indistinguishable layout.' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Concrete violations, naming the object and what changed. Empty if none.' },
  },
}

async function audit(reference: Buffer, candidate: Buffer, plan: Plan, view: ViewSpec, names: MaterialNames, aspect: number): Promise<Audit | null> {
  const model = config.interior.render.verifyModel || config.interior.model
  try {
    const res: any = await openai.responses.create(
      {
        model,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text:
                  'Image A is a dimensionally exact 3D model render (ground truth; dark lines are outlines). Image B is a photoreal restyle of it. Audit B against A for GEOMETRIC fidelity only. Ignore shifts smaller than about 2% of the image width; flag only changes a viewer would notice. ' +
                  'Differences in surface texture, lighting, shadows, reflections, small decor and the absence of A\'s outline strokes are allowed and expected. ' +
                  'Anything structural is not: framing, wall/ceiling positions, doors, windows, furniture presence/position/size.\n\n' +
                  'Expected content (from the drawings):\n' + describeScene(plan, view, names, aspect),
              },
              { type: 'input_image', image_url: `data:image/png;base64,${reference.toString('base64')}`, detail: 'high' },
              { type: 'input_image', image_url: `data:image/png;base64,${candidate.toString('base64')}`, detail: 'high' },
            ],
          },
        ],
        text: { format: { type: 'json_schema', name: 'fidelity_audit', schema: AUDIT_SCHEMA, strict: true } },
        max_output_tokens: 2500,
      } as any,
      { timeout: 4 * 60 * 1000, maxRetries: 1 }
    )
    const p = JSON.parse(res.output_text ?? '')
    return {
      framing: !!p.framing_matches,
      structure: !!p.structure_matches,
      openings: !!p.openings_match,
      furniture: !!p.furniture_matches,
      additions: !!p.nothing_added,
      score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))),
      issues: Array.isArray(p.issues) ? p.issues.map(String).slice(0, 8) : [],
    }
  } catch {
    return null
  }
}

/**
 * Openings, furniture and "nothing added" are hard requirements. A tiny framing/wall shift is
 * tolerated only when the audit score is very high AND the deterministic structure score
 * independently confirms the layout (an unaligned image scores ~0.3-0.5, a faithful one ~0.75).
 */
const passes = (a: Audit, structure: number) => {
  const r = config.interior.render
  if (!(a.openings && a.furniture && a.additions && a.score >= r.minScore)) return false
  if (a.framing && a.structure) return true
  return a.score >= 95 && structure >= Math.max(r.minStructure, 0.7)
}

interface Candidate {
  png: Buffer
  audit: Audit | null
  structure: number
  rank: number
}

export interface EnhanceContext {
  plan: Plan
  view: ViewSpec
  materialNames?: MaterialNames
}

/** Generates, audits and ranks candidates. Returns null when nothing usable came back. */
export async function enhanceRender(guide: EnhanceGuide, ctx: EnhanceContext, log: (msg: string) => void): Promise<EnhanceResult | null> {
  if (!config.openai.apiKey) return null
  const { plan, view } = ctx
  const names = ctx.materialNames ?? new Map()
  const aspect = guide.width / guide.height
  const size = `${guide.width}x${guide.height}`
  const model = config.interior.render.imageModel
  const minStructure = config.interior.render.minStructure
  let extra: string[] = []
  let best = null as Candidate | null
  let attempts = 0
  let produced = 0

  const evaluate = async (png: Buffer): Promise<Candidate> => {
    const decoded = PNG.sync.read(png)
    let structure = 0
    if (decoded.width === guide.width && decoded.height === guide.height) structure = structureScore(guide.edges, guide.width, guide.height, decoded)
    const a = await audit(guide.png, png, plan, view, names, aspect)
    // Rank: audit score dominates, structural correlation breaks ties and catches silent drift.
    const rank = (a ? a.score : 50) + structure * 40 - (a && !passes(a, structure) ? 30 : 0)
    return { png, audit: a, structure, rank }
  }

  for (let round = 1; round <= 2; round++) {
    const n = round === 1 ? config.interior.render.candidates : 1
    attempts = round
    const prompt = enhancePrompt(plan, view, names, aspect, extra)
    const settled = await Promise.allSettled(
      Array.from({ length: n }, async () => {
        const png = await editImage(guide.png, prompt, size)
        produced++
        return evaluate(png)
      })
    )
    const round_: Candidate[] = []
    for (const s of settled) {
      if (s.status === 'fulfilled') round_.push(s.value)
      else log(`enhance round ${round} candidate failed: ${(s.reason as Error)?.message ?? s.reason}`)
    }
    for (const c of round_) if (!best || c.rank > best.rank) best = c
    // Audit unavailable and nothing audited so far: keep the best image but mark it unverified.
    if (best && !best.audit && round_.length && round_.every((c) => !c.audit)) {
      return { png: best.png, verified: null, issues: [], attempts, model, score: null, structure: best.structure, candidates: produced }
    }
    const ok = round_.filter((c) => c.audit && passes(c.audit, c.structure) && c.structure >= minStructure)
    if (ok.length) {
      const win = ok.reduce((a, b) => (b.rank > a.rank ? b : a))
      return { png: win.png, verified: true, issues: win.audit?.issues ?? [], attempts, model, score: win.audit?.score ?? null, structure: win.structure, candidates: produced }
    }
    const worst = best?.audit ? best.audit.issues : []
    const weak = best && best.structure < minStructure ? [`the layout drifted from the guide (structural match ${best.structure.toFixed(2)})`] : []
    log(`enhance round ${round}: no candidate passed (best score ${best?.audit?.score ?? '?'}, structure ${best?.structure.toFixed(2) ?? '?'}): ${[...worst, ...weak].join('; ')}`)
    extra = [`A previous attempt changed the model. Fix exactly these problems and change nothing else; reproduce the input's framing and layout precisely: ${[...worst, ...weak].join('; ') || 'keep every element where the input has it'}.`]
  }
  if (!best) return null
  return { png: best.png, verified: false, issues: best.audit?.issues ?? [], attempts, model, score: best.audit?.score ?? null, structure: best.structure, candidates: produced }
}
