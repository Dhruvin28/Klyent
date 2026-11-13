import { z } from 'zod'
import { PARAMETRIC_TYPES } from '../designer/plan'
import type { Assumption, SceneDoc } from './contracts'

// Allowlisted semantic commands (plan §12.3): typed edits instead of free-form patches.
// Each applied command yields a decision record (actor/time added by the service).

const mm = (min: number, max: number) => z.number().finite().min(min).max(max)
const ids = z.array(z.string().min(1).max(128)).min(1).max(500)
const rationale = z.string().trim().max(1000).optional()

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_wall_height'), value: mm(1800, 10_000), rationale }),
  z.object({ type: z.literal('set_openings'), openingIds: ids, width: mm(100, 20_000).optional(), height: mm(100, 10_000).optional(), sill: mm(0, 5000).optional(), rationale }),
  z.object({ type: z.literal('set_items'), itemIds: ids, width: mm(10, 50_000).optional(), depth: mm(10, 50_000).optional(), height: mm(5, 10_000).optional(), elevation: mm(0, 10_000).optional(), rationale }),
  z.object({ type: z.literal('set_item_family'), itemId: z.string().min(1).max(128), family: z.enum(PARAMETRIC_TYPES), rationale }),
  z.object({ type: z.literal('set_ceiling_level'), ceilingId: z.string().min(1).max(128), level: mm(1500, 10_000), rationale }),
  z.object({ type: z.literal('set_panels'), panelIds: ids, depth: mm(1, 300).optional(), divisions: z.number().int().min(1).max(200).optional(), groove: mm(0, 100).optional(), rationale }),
  z.object({ type: z.literal('set_fixtures'), fixtureIds: ids, mount: mm(0, 10_000).optional(), kelvin: z.number().finite().min(1000).max(12_000).optional(), on: z.boolean().optional(), rationale }),
  z.object({ type: z.literal('delete_objects'), objectIds: ids, rationale: z.string().trim().min(3).max(1000) }),
  z.object({ type: z.literal('accept'), key: z.string().min(1).max(300), rationale: z.string().trim().min(3).max(1000) }),
  z.object({ type: z.literal('accept_assumption'), assumptionId: z.string().min(1).max(200), rationale }),
  // Page-level: handled by the service (updates the page and rebuilds).
  z.object({ type: z.literal('set_page_units'), pageId: z.string().min(1).max(128), units: z.enum(['mm', 'cm', 'm', 'ft_in']) }),
])

export type Command = z.infer<typeof commandSchema>

export class CommandError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export interface DecisionDraft {
  kind: string
  target: { objectIds: string[]; key?: string }
  before: unknown
  after: unknown
  rationale: string | null
  command: Command
}

/** Removes object ids from assumptions covering `prop`; drops emptied assumptions. */
function resolve(assumptions: Assumption[], objectIds: string[], props: string[]) {
  for (const a of assumptions) {
    if (props.includes(a.property)) a.objectIds = a.objectIds.filter((id) => !objectIds.includes(id))
  }
  return assumptions.filter((a) => a.objectIds.length)
}

/** Applies commands to a draft scene (mutates a clone) and returns the decisions to record. */
export function applyCommands(input: SceneDoc, commands: Command[], decisionId: () => string): { scene: SceneDoc; decisions: (DecisionDraft & { id: string })[] } {
  const scene: SceneDoc = structuredClone(input)
  const plan = scene.plan
  const out: (DecisionDraft & { id: string })[] = []
  const evd = (objectId: string, prop: string, value: unknown, id: string, note?: string) => {
    const o = (scene.evidence[objectId] ??= {})
    ;(o[prop] ??= []).push({ kind: 'designer_decision', value, decisionId: id, note })
  }
  const need = <T extends { id: string }>(list: T[] | undefined, wanted: string[], what: string): T[] => {
    const found = (list ?? []).filter((x) => wanted.includes(x.id))
    if (found.length !== new Set(wanted).size) throw new CommandError('UNKNOWN_OBJECT', `Some ${what} no longer exist in this revision.`)
    return found
  }

  for (const cmd of commands) {
    const id = decisionId()
    const why = 'rationale' in cmd ? (cmd.rationale ?? null) : null
    switch (cmd.type) {
      case 'set_wall_height': {
        const before = plan.wallHeight
        plan.wallHeight = cmd.value
        for (const z2 of plan.ceilings ?? []) if (z2.level > cmd.value) throw new CommandError('INVALID_VALUE', `A ceiling zone (${z2.name}) is at ${z2.level} mm, above ${cmd.value} mm.`)
        evd('plan', 'ceilingHeight', cmd.value, id)
        scene.assumptions = resolve(scene.assumptions, ['plan'], ['wallHeight'])
        out.push({ id, kind: cmd.type, target: { objectIds: ['plan'] }, before, after: cmd.value, rationale: why, command: cmd })
        break
      }
      case 'set_openings': {
        const ops = need(plan.openings, cmd.openingIds, 'openings')
        const props = (['width', 'height', 'sill'] as const).filter((k) => cmd[k] !== undefined)
        if (!props.length) throw new CommandError('EMPTY_COMMAND', 'Nothing to change.')
        const before = ops.map((o) => ({ id: o.id, width: o.width, height: o.height, sill: o.sill }))
        for (const o of ops) {
          for (const k of props) {
            o[k] = cmd[k]!
            evd(o.id, k, cmd[k], id)
          }
          if (o.type === 'door') o.sill = 0
        }
        scene.assumptions = resolve(scene.assumptions, cmd.openingIds, props)
        out.push({ id, kind: cmd.type, target: { objectIds: cmd.openingIds }, before, after: Object.fromEntries(props.map((k) => [k, cmd[k]])), rationale: why, command: cmd })
        break
      }
      case 'set_items': {
        const items = need(plan.items, cmd.itemIds, 'items')
        const props = (['width', 'depth', 'height', 'elevation'] as const).filter((k) => cmd[k] !== undefined)
        if (!props.length) throw new CommandError('EMPTY_COMMAND', 'Nothing to change.')
        const before = items.map((i) => ({ id: i.id, width: i.width, depth: i.depth, height: i.height, elevation: i.elevation }))
        for (const it of items) {
          for (const k of props) {
            it[k] = cmd[k]!
            evd(it.id, k, cmd[k], id)
          }
        }
        scene.assumptions = resolve(scene.assumptions, cmd.itemIds, props)
        out.push({ id, kind: cmd.type, target: { objectIds: cmd.itemIds }, before, after: Object.fromEntries(props.map((k) => [k, cmd[k]])), rationale: why, command: cmd })
        break
      }
      case 'set_item_family': {
        const [it] = need(plan.items, [cmd.itemId], 'items')
        const before = it.source
        it.source = { kind: 'parametric', type: cmd.family }
        it.params = {}
        it.materials = {}
        evd(it.id, 'family', cmd.family, id, 'Family chosen by the designer (substitute, not an exact product)')
        scene.unsupported = scene.unsupported.filter((u) => !(u.kind === 'unsupported_family' && scene.objectSources[it.id]?.some((s) => s.pageId === u.pageId) && u.message.includes(it.name)))
        out.push({ id, kind: cmd.type, target: { objectIds: [it.id] }, before, after: it.source, rationale: why, command: cmd })
        break
      }
      case 'set_ceiling_level': {
        const [zone] = need(plan.ceilings, [cmd.ceilingId], 'ceiling zones')
        if (cmd.level > plan.wallHeight) throw new CommandError('INVALID_VALUE', `The level must be at or below the ceiling height (${plan.wallHeight} mm).`)
        const before = zone.level
        zone.level = cmd.level
        evd(zone.id, 'level', cmd.level, id)
        scene.assumptions = resolve(scene.assumptions, [zone.id], ['level'])
        out.push({ id, kind: cmd.type, target: { objectIds: [zone.id] }, before, after: cmd.level, rationale: why, command: cmd })
        break
      }
      case 'set_panels': {
        const panels = need(plan.panels, cmd.panelIds, 'panels')
        const props = (['depth', 'divisions', 'groove'] as const).filter((k) => cmd[k] !== undefined)
        if (!props.length) throw new CommandError('EMPTY_COMMAND', 'Nothing to change.')
        const before = panels.map((p) => ({ id: p.id, depth: p.depth, divisions: p.divisions, groove: p.groove }))
        for (const p of panels) {
          for (const k of props) {
            ;(p as Record<string, unknown>)[k] = cmd[k]
            evd(p.id, k, cmd[k], id)
          }
        }
        scene.assumptions = resolve(scene.assumptions, cmd.panelIds, props)
        out.push({ id, kind: cmd.type, target: { objectIds: cmd.panelIds }, before, after: Object.fromEntries(props.map((k) => [k, cmd[k]])), rationale: why, command: cmd })
        break
      }
      case 'set_fixtures': {
        const fx = need(plan.fixtures, cmd.fixtureIds, 'fixtures')
        const props = (['mount', 'kelvin', 'on'] as const).filter((k) => cmd[k] !== undefined)
        if (!props.length) throw new CommandError('EMPTY_COMMAND', 'Nothing to change.')
        const before = fx.map((f) => ({ id: f.id, mount: f.mount, kelvin: f.kelvin, on: f.on }))
        for (const f of fx) {
          for (const k of props) {
            ;(f as Record<string, unknown>)[k] = cmd[k]
            evd(f.id, k, cmd[k], id)
          }
        }
        scene.assumptions = resolve(scene.assumptions, cmd.fixtureIds, props)
        out.push({ id, kind: cmd.type, target: { objectIds: cmd.fixtureIds }, before, after: Object.fromEntries(props.map((k) => [k, cmd[k]])), rationale: why, command: cmd })
        break
      }
      case 'delete_objects': {
        const want = new Set(cmd.objectIds)
        if (plan.walls.some((w) => want.has(w.id))) throw new CommandError('USE_DESIGNER', 'Walls are edited in the designer (open it, change the walls, then sync back).')
        const before = {
          openings: plan.openings.filter((o) => want.has(o.id)),
          items: plan.items.filter((i) => want.has(i.id)),
          fixtures: (plan.fixtures ?? []).filter((f) => want.has(f.id)),
          panels: (plan.panels ?? []).filter((p) => want.has(p.id)),
          ceilings: (plan.ceilings ?? []).filter((c) => want.has(c.id)),
        }
        const removed = Object.values(before).reduce((a, l) => a + l.length, 0)
        if (removed !== want.size) throw new CommandError('UNKNOWN_OBJECT', 'Some objects no longer exist in this revision.')
        plan.openings = plan.openings.filter((o) => !want.has(o.id))
        plan.items = plan.items.filter((i) => !want.has(i.id))
        plan.fixtures = (plan.fixtures ?? []).filter((f) => !want.has(f.id))
        plan.panels = (plan.panels ?? []).filter((p) => !want.has(p.id))
        plan.ceilings = (plan.ceilings ?? []).filter((c) => !want.has(c.id))
        scene.assumptions = resolve(scene.assumptions, cmd.objectIds, ['height', 'sill', 'width', 'depth', 'level', 'mount', 'kelvin', 'elevation'])
        scene.review = scene.review.filter((r) => !want.has(r.objectId))
        out.push({ id, kind: cmd.type, target: { objectIds: cmd.objectIds }, before, after: null, rationale: cmd.rationale, command: cmd })
        break
      }
      case 'accept': {
        if (scene.acceptances.some((a) => a.key === cmd.key)) break
        scene.acceptances.push({ key: cmd.key, decisionId: id, rationale: cmd.rationale })
        out.push({ id, kind: cmd.type, target: { objectIds: [], key: cmd.key }, before: null, after: 'accepted', rationale: cmd.rationale, command: cmd })
        break
      }
      case 'accept_assumption': {
        const a = scene.assumptions.find((x) => x.id === cmd.assumptionId)
        if (!a) throw new CommandError('UNKNOWN_OBJECT', 'That assumption is already resolved.')
        // The value becomes a designer decision: still reported as designer-supplied, never as extracted.
        for (const oid of a.objectIds) evd(oid, a.property, a.value, id, `Designer confirmed ${a.value} ${a.unit}`)
        scene.assumptions = scene.assumptions.filter((x) => x.id !== a.id)
        out.push({ id, kind: cmd.type, target: { objectIds: a.objectIds, key: a.id }, before: { assumed: a.value }, after: { confirmed: a.value }, rationale: why, command: cmd })
        break
      }
      case 'set_page_units':
        throw new CommandError('PAGE_COMMAND', 'Page commands are applied by the service.')
    }
  }
  return { scene, decisions: out }
}
