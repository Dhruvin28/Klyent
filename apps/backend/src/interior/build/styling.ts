import type { MatRef, Plan } from '../../designer/plan'

// Default, believable finishes for a reconstructed plan. The drawings rarely say what a
// sofa is covered in, so an unstyled model renders as flat grey blocks. These fill only
// empty slots and are recorded as assumptions by the caller, never overwriting a choice.

const c = (hex: string, roughness: number, pattern?: 'wood' | 'fabric' | 'plaster', metalness?: number): MatRef => ({ kind: 'color', hex, roughness, ...(metalness ? { metalness } : {}), ...(pattern ? { pattern } : {}) })

const FLOOR = c('#c79a68', 0.38, 'wood')
const WALL = c('#f1ede6', 0.92, 'plaster')
const CEILING = c('#fbfaf8', 0.95, 'plaster')
const WALNUT = c('#8a5a3a', 0.4, 'wood')
const OAK = c('#c9a075', 0.45, 'wood')
const DARK_LEGS = c('#2a2522', 0.35, undefined, 0.2)
const FABRIC_SOFA = c('#a8a698', 0.95, 'fabric')
const FABRIC_ARM = c('#b9835a', 0.95, 'fabric')
const FABRIC_SEAT = c('#cdbfa8', 0.95, 'fabric')

type Slots = Record<string, MatRef>

function itemFinish(name: string, type: string): Slots {
  const n = name.toLowerCase()
  if (type === 'sofa') return { fabric: /arm/.test(n) ? FABRIC_ARM : FABRIC_SOFA, legs: DARK_LEGS }
  if (type === 'chair') return /arm/.test(n) ? { seat: FABRIC_ARM, legs: DARK_LEGS } : { seat: FABRIC_SEAT, legs: WALNUT }
  if (type === 'table') return /dining/.test(n) ? { top: WALNUT, legs: DARK_LEGS } : /nesting|organic|side|round/.test(n) ? { top: OAK, legs: DARK_LEGS } : { top: WALNUT, legs: DARK_LEGS }
  if (type === 'tv_unit') return { shutter: WALNUT, carcass: c('#5e3d28', 0.45, 'wood'), handle: c('#8a8a8f', 0.3, undefined, 0.9) }
  if (type === 'box' && /television|tv|screen/.test(n)) return { body: c('#0d0d0f', 0.15, undefined, 0.3) }
  return {}
}

/** Plan sheets give footprints, not heights, so default every item to a plausible real-world height. */
function itemHeight(name: string, type: string, current: number): { height?: number; elevation?: number } {
  const n = name.toLowerCase()
  if (type === 'table') {
    if (/dining/.test(n)) return { height: 750 }
    if (/nesting/.test(n)) return { height: /smaller/.test(n) ? 380 : 450 }
    if (/side|round/.test(n)) return { height: 500 }
    if (/low|ottoman|coffee|centre|center/.test(n)) return { height: 420 }
    return current > 600 ? { height: 450 } : {}
  }
  if (type === 'tv_unit') return { height: 450 }
  if (type === 'box' && /television|tv|screen/.test(n)) return { height: 600, elevation: 450 }
  if (type === 'sofa') return { height: 820 }
  if (type === 'chair') return /arm/.test(n) ? { height: 820 } : { height: 880 }
  return {}
}

export function applyDefaultStyling(plan: Plan): string[] {
  const notes: string[] = []
  for (const room of plan.rooms) {
    if (!room.floor) room.floor = FLOOR
    if (!room.ceiling) room.ceiling = CEILING
  }
  for (const wall of plan.walls) {
    if (!wall.left) wall.left = WALL
    if (!wall.right) wall.right = WALL
  }
  let styled = 0
  for (const item of plan.items) {
    if (item.source.kind !== 'parametric') continue
    const fit = itemHeight(item.name, item.source.type, item.height)
    if (fit.height) item.height = fit.height
    if (fit.elevation !== undefined) item.elevation = fit.elevation
    const defaults = itemFinish(item.name, item.source.type)
    for (const [slot, ref] of Object.entries(defaults)) {
      if (!item.materials[slot]) {
        item.materials[slot] = ref
        styled++
      }
    }
  }
  notes.push(`Applied default finishes (wood floor, plaster walls, ${styled} furniture slots) and typical furniture heights. Replace them in the designer once real finishes are known.`)
  return notes
}
