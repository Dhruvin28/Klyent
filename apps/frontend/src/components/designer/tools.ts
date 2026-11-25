import type { Item, OpeningType } from '@/lib/designer/types'

export type Tool =
  | { kind: 'select' }
  | { kind: 'wall' }
  | { kind: 'room' }
  | { kind: 'opening'; type: OpeningType }
  | { kind: 'place'; item: Item }
  | { kind: 'calibrate' }

export const SELECT: Tool = { kind: 'select' }

/** True when keyboard focus is in a text field (editor shortcuts must not fire). */
export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}
