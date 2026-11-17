import { config } from '../../config'
import { openai } from '../../lib/openai'
import type { Plan } from '../../designer/plan'
import type { ViewSpec } from '../build/views'

// Photoreal pass: the Cycles render is the geometric ground truth (every wall, opening and
// piece of furniture is in the right place and size). An OpenAI image model upgrades its
// surface realism, and a second vision call checks that nothing structural was changed.

export interface EnhanceResult {
  png: Buffer
  verified: boolean | null
  issues: string[]
  attempts: number
  model: string
}

const MM_TO_M = (mm: number) => (mm / 1000).toFixed(2).replace(/\.00$/, '')

function describeScene(plan: Plan, view: ViewSpec): string {
  const room = view.roomId ? plan.rooms.find((r) => r.id === view.roomId) : null
  const lines: string[] = []
  lines.push(`Space: ${room ? room.name : 'whole residence / site'}. Ceiling height ${MM_TO_M(plan.wallHeight)} m.`)
  const items = plan.items.filter((i) => !room || pointNear(i, room.points)).slice(0, 40)
  if (items.length) lines.push('Furniture and fixtures present (do not add, remove or move any): ' + items.map((i) => `${i.name} (${MM_TO_M(i.width)}×${MM_TO_M(i.depth)}×${MM_TO_M(i.height)} m)`).join('; ') + '.')
  const openings = plan.openings.length
  lines.push(`The model has ${plan.openings.filter((o) => o.type === 'door').length} doors and ${plan.openings.filter((o) => o.type === 'window').length} windows overall (${openings} openings); keep every opening exactly where it is in the image.`)
  const light = plan.lighting.preset
  lines.push(`Lighting: ${light === 'night' ? 'night, warm artificial interior lighting only' : `${light} daylight with warm interior lights`}.`)
  return lines.join('\n')
}

function pointNear(i: { x: number; y: number }, poly: { x: number; y: number }[]) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y)
  const pad = 600
  return i.x >= Math.min(...xs) - pad && i.x <= Math.max(...xs) + pad && i.y >= Math.min(...ys) - pad && i.y <= Math.max(...ys) + pad
}

function pickSize(aspect: number): '1536x1024' | '1024x1536' | '1024x1024' {
  if (aspect >= 1.2) return '1536x1024'
  if (aspect <= 0.83) return '1024x1536'
  return '1024x1024'
}

function enhancePrompt(plan: Plan, view: ViewSpec, extra: string[]) {
  const kind = view.group === 'perspective' || view.group === 'isometric' ? 'interior photograph' : 'architectural visualisation'
  return [
    `Turn this physically based 3D render into a photorealistic ${kind} of a real, lived-in, professionally finished interior, as shot by an architectural photographer with a full-frame camera and a 24mm tilt-shift lens.`,
    'THE GEOMETRY IS FIXED. This is a verified, dimension-accurate model: keep the exact camera position and framing, every wall, ceiling level, door, window, column, cabinet and piece of furniture in precisely the same place, size, proportion and count. Do not add, remove, move, resize or restyle any structural element or object. Do not add people, text, logos or new windows/doors.',
    'WHAT TO IMPROVE: surface and light only. Real material detail (wood grain with natural variation, woven fabric with soft folds and stitching, plaster with subtle texture, stone/tile with grout, brushed metal, glass with correct reflections), crisp edge bevels, contact shadows and ambient occlusion where objects meet the floor and walls, physically plausible soft global illumination, accurate reflections, natural window light, light fall-off, subtle depth of field and lens quality. Keep the colour palette and finishes of the model. Make objects look like real manufactured products, not CG primitives (add realistic handles, hinges, seams, cushions, trim and skirting that are consistent with the existing shapes).',
    describeScene(plan, view),
    ...extra,
  ].join('\n\n')
}

async function editImage(png: Buffer, prompt: string, size: string): Promise<Buffer> {
  // Long image jobs occasionally drop the connection ("terminated"); retry once.
  try {
    return await editImageOnce(png, prompt, size)
  } catch (err) {
    if (/terminated|fetch failed|ECONNRESET|socket/i.test(String((err as Error)?.message ?? err) + String((err as any)?.cause?.message ?? ''))) return editImageOnce(png, prompt, size)
    throw err
  }
}

async function editImageOnce(png: Buffer, prompt: string, size: string): Promise<Buffer> {
  const form = new FormData()
  form.append('model', config.interior.render.imageModel)
  form.append('prompt', prompt)
  form.append('size', size)
  form.append('quality', config.interior.render.imageQuality)
  form.append('n', '1')
  form.append('input_fidelity', 'high')
  form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'render.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(config.interior.render.enhanceTimeoutMs),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Older image models reject input_fidelity; retry once without it.
    if (res.status === 400 && /input_fidelity/i.test(text)) {
      form.delete('input_fidelity')
      const retry = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${config.openai.apiKey}` }, body: form, signal: AbortSignal.timeout(config.interior.render.enhanceTimeoutMs) })
      if (!retry.ok) throw new Error(`Image edit failed (${retry.status}): ${(await retry.text().catch(() => '')).slice(0, 300)}`)
      return readImage(await retry.json())
    }
    throw new Error(`Image edit failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return readImage(await res.json())
}

async function readImage(json: any): Promise<Buffer> {
  const item = json?.data?.[0]
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64')
  if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer())
  throw new Error('Image edit returned no image')
}

/** Vision check: does the photoreal image keep the reference's layout, openings and objects? */
async function verify(reference: Buffer, candidate: Buffer): Promise<{ ok: boolean; issues: string[] } | null> {
  const model = config.interior.render.verifyModel || config.interior.model
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['faithful', 'issues'],
    properties: {
      faithful: { type: 'boolean' },
      issues: { type: 'array', items: { type: 'string' } },
    },
  }
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
                  'Image A is a dimensionally exact 3D model render (ground truth). Image B is a photoreal restyle of it. Decide if B is FAITHFUL: same camera framing; every wall, ceiling edge, door and window in the same position and count; every piece of furniture and fixture present, in the same place, with similar size/proportion and no extra or missing major objects; no people/text added. Differences in surface texture, lighting, small decor and material realism are allowed. List concrete violations in "issues" (empty if faithful).',
              },
              { type: 'input_image', image_url: `data:image/png;base64,${reference.toString('base64')}`, detail: 'high' },
              { type: 'input_image', image_url: `data:image/png;base64,${candidate.toString('base64')}`, detail: 'high' },
            ],
          },
        ],
        text: { format: { type: 'json_schema', name: 'fidelity_check', schema, strict: true } },
        max_output_tokens: 1500,
      } as any,
      { timeout: 4 * 60 * 1000, maxRetries: 1 }
    )
    const text: string = res.output_text ?? ''
    const parsed = JSON.parse(text)
    return { ok: !!parsed.faithful, issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 8) : [] }
  } catch {
    return null
  }
}

/** Runs enhance → verify (with one corrective retry). Returns null when nothing usable came back. */
export async function enhanceRender(reference: Buffer, plan: Plan, view: ViewSpec, aspect: number, log: (msg: string) => void): Promise<EnhanceResult | null> {
  if (!config.openai.apiKey) return null
  const size = pickSize(aspect)
  const model = config.interior.render.imageModel
  let extra: string[] = []
  let last: EnhanceResult | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    let png: Buffer
    try {
      png = await editImage(reference, enhancePrompt(plan, view, extra), size)
    } catch (err) {
      log(`enhance attempt ${attempt} failed: ${(err as Error).message}`)
      if (attempt === 2) break
      continue
    }
    const check = await verify(reference, png)
    if (!check) {
      // Verification unavailable: keep the image but mark it unverified.
      return { png, verified: null, issues: [], attempts: attempt, model }
    }
    last = { png, verified: check.ok, issues: check.issues, attempts: attempt, model }
    if (check.ok) return last
    log(`enhance attempt ${attempt} rejected: ${check.issues.join('; ')}`)
    extra = [`A previous attempt changed the model. Fix these specific problems and change nothing else: ${check.issues.join('; ')}.`]
  }
  return last
}
