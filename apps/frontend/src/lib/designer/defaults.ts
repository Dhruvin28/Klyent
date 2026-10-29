import { uid } from './geometry'
import type { Item, Lighting, LightingPreset, MatRef, OpeningType, ParametricType, Plan } from './types'

export function defaultLighting(): Lighting {
  return { preset: 'noon', sunAzimuth: 135, exposure: 1, ceilingLights: true, lightTemp: 3500 }
}

export function defaultPlan(): Plan {
  return {
    version: 1,
    wallHeight: 2700,
    walls: [],
    openings: [],
    rooms: [],
    items: [],
    lighting: defaultLighting(),
    cameras: [],
    underlay: null,
  }
}

export const color = (hex: string, roughness = 0.8, metalness?: number): MatRef => ({ kind: 'color', hex, roughness, ...(metalness ? { metalness } : {}) })

/** Finishes used where nothing has been chosen yet. */
export const DEFAULT_FINISH = {
  wall: color('#f2efe9', 0.9),
  floor: color('#d8cfc2', 0.6),
  ceiling: color('#fbfbfa', 0.95),
  wallTop: color('#3f3f46', 1),
  trim: color('#ebe7e0', 0.9),
  door: color('#a47b54', 0.55),
  frame: color('#5b4636', 0.5),
  glass: color('#cfe6f2', 0.05),
}

export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: 'Chalk white', hex: '#f4f2ee' },
  { name: 'Warm grey', hex: '#bdb6ab' },
  { name: 'Greige', hex: '#cfc4b4' },
  { name: 'Sage', hex: '#a7b49b' },
  { name: 'Teal', hex: '#3f6f73' },
  { name: 'Navy', hex: '#26344d' },
  { name: 'Terracotta', hex: '#b5654a' },
  { name: 'Mustard', hex: '#d1a43b' },
  { name: 'Blush', hex: '#e2c0b5' },
  { name: 'Charcoal', hex: '#3b3b3f' },
  { name: 'Oak', hex: '#c09a6b' },
  { name: 'Walnut', hex: '#6b4a33' },
  { name: 'Black', hex: '#1d1d1f' },
  { name: 'Brass', hex: '#b5935a' },
]

export const OPENING_DEFAULTS: Record<OpeningType, { width: number; height: number; sill: number; label: string }> = {
  door: { width: 900, height: 2100, sill: 0, label: 'Door' },
  window: { width: 1200, height: 1200, sill: 900, label: 'Window' },
  opening: { width: 1000, height: 2100, sill: 0, label: 'Opening' },
}

export interface ParamSpec {
  key: string
  label: string
  kind: 'int' | 'bool' | 'select'
  min?: number
  max?: number
  options?: { value: string; label: string }[]
}

export interface ParametricSpec {
  type: ParametricType
  label: string
  group: 'Storage' | 'Kitchen' | 'Living' | 'Bedroom' | 'Dining' | 'Basic'
  size: { width: number; depth: number; height: number }
  elevation: number
  params: Record<string, number | string | boolean>
  paramSpecs: ParamSpec[]
  /** Material slots in display order with their defaults. */
  slots: Record<string, { label: string; default: MatRef }>
}

const HANDLE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'knob', label: 'Knob' },
  { value: 'profile', label: 'Profile (handleless)' },
]

const carcass = { label: 'Carcass', default: color('#efe9df', 0.7) }
const shutter = { label: 'Shutters', default: color('#d9cbb6', 0.45) }
const handle = { label: 'Handles', default: color('#8a8a8f', 0.3, 0.9) }

export const PARAMETRIC: Record<ParametricType, ParametricSpec> = {
  wardrobe: {
    type: 'wardrobe',
    label: 'Wardrobe',
    group: 'Storage',
    size: { width: 1800, depth: 600, height: 2100 },
    elevation: 0,
    params: { doors: 3, handle: 'bar', loft: true },
    paramSpecs: [
      { key: 'doors', label: 'Shutters', kind: 'int', min: 1, max: 8 },
      { key: 'handle', label: 'Handle', kind: 'select', options: HANDLE_OPTIONS },
      { key: 'loft', label: 'Loft above', kind: 'bool' },
    ],
    slots: { shutter, carcass, handle },
  },
  base_cabinet: {
    type: 'base_cabinet',
    label: 'Base cabinet',
    group: 'Kitchen',
    size: { width: 1200, depth: 600, height: 900 },
    elevation: 0,
    params: { doors: 2, drawers: 0, handle: 'profile' },
    paramSpecs: [
      { key: 'doors', label: 'Shutters', kind: 'int', min: 0, max: 6 },
      { key: 'drawers', label: 'Drawers', kind: 'int', min: 0, max: 4 },
      { key: 'handle', label: 'Handle', kind: 'select', options: HANDLE_OPTIONS },
    ],
    slots: { shutter, top: { label: 'Countertop', default: color('#2f2f33', 0.25) }, carcass, handle },
  },
  wall_cabinet: {
    type: 'wall_cabinet',
    label: 'Wall cabinet',
    group: 'Kitchen',
    size: { width: 1200, depth: 350, height: 700 },
    elevation: 1500,
    params: { doors: 2, handle: 'profile' },
    paramSpecs: [
      { key: 'doors', label: 'Shutters', kind: 'int', min: 1, max: 6 },
      { key: 'handle', label: 'Handle', kind: 'select', options: HANDLE_OPTIONS },
    ],
    slots: { shutter, carcass, handle },
  },
  tall_unit: {
    type: 'tall_unit',
    label: 'Tall unit',
    group: 'Kitchen',
    size: { width: 600, depth: 600, height: 2100 },
    elevation: 0,
    params: { doors: 2, handle: 'bar' },
    paramSpecs: [
      { key: 'doors', label: 'Shutters (stacked)', kind: 'int', min: 1, max: 4 },
      { key: 'handle', label: 'Handle', kind: 'select', options: HANDLE_OPTIONS },
    ],
    slots: { shutter, carcass, handle },
  },
  shelf: {
    type: 'shelf',
    label: 'Open shelf',
    group: 'Storage',
    size: { width: 900, depth: 300, height: 1800 },
    elevation: 0,
    params: { shelves: 4 },
    paramSpecs: [{ key: 'shelves', label: 'Shelves', kind: 'int', min: 1, max: 10 }],
    slots: { carcass: { label: 'Body', default: color('#b48a60', 0.5) } },
  },
  tv_unit: {
    type: 'tv_unit',
    label: 'TV unit',
    group: 'Living',
    size: { width: 1800, depth: 450, height: 450 },
    elevation: 0,
    params: { drawers: 2, handle: 'profile' },
    paramSpecs: [
      { key: 'drawers', label: 'Drawers', kind: 'int', min: 0, max: 6 },
      { key: 'handle', label: 'Handle', kind: 'select', options: HANDLE_OPTIONS },
    ],
    slots: { shutter, carcass, handle },
  },
  bed: {
    type: 'bed',
    label: 'Bed',
    group: 'Bedroom',
    size: { width: 1800, depth: 2100, height: 1100 },
    elevation: 0,
    params: { storage: true },
    paramSpecs: [{ key: 'storage', label: 'Storage base', kind: 'bool' }],
    slots: {
      frame: { label: 'Frame', default: color('#7a5a40', 0.55) },
      headboard: { label: 'Headboard', default: color('#b9ab98', 0.9) },
      fabric: { label: 'Bedding', default: color('#f1eee8', 0.95) },
    },
  },
  sofa: {
    type: 'sofa',
    label: 'Sofa',
    group: 'Living',
    size: { width: 2200, depth: 900, height: 820 },
    elevation: 0,
    params: { seats: 3 },
    paramSpecs: [{ key: 'seats', label: 'Seats', kind: 'int', min: 1, max: 5 }],
    slots: {
      fabric: { label: 'Upholstery', default: color('#8c8f86', 0.95) },
      legs: { label: 'Legs', default: color('#2b2b2b', 0.4) },
    },
  },
  table: {
    type: 'table',
    label: 'Table',
    group: 'Dining',
    size: { width: 1600, depth: 900, height: 750 },
    elevation: 0,
    params: {},
    paramSpecs: [],
    slots: {
      top: { label: 'Top', default: color('#9b7350', 0.45) },
      legs: { label: 'Legs', default: color('#2b2b2b', 0.4) },
    },
  },
  chair: {
    type: 'chair',
    label: 'Chair',
    group: 'Dining',
    size: { width: 480, depth: 520, height: 880 },
    elevation: 0,
    params: {},
    paramSpecs: [],
    slots: {
      seat: { label: 'Seat', default: color('#9b7350', 0.5) },
      legs: { label: 'Legs', default: color('#2b2b2b', 0.4) },
    },
  },
  box: {
    type: 'box',
    label: 'Box / panel',
    group: 'Basic',
    size: { width: 600, depth: 600, height: 600 },
    elevation: 0,
    params: {},
    paramSpecs: [],
    slots: { body: { label: 'Body', default: color('#cfc8bd', 0.7) } },
  },
}

export function newParametricItem(type: ParametricType, at: { x: number; y: number }): Item {
  const spec = PARAMETRIC[type]
  return {
    id: uid(),
    name: spec.label,
    source: { kind: 'parametric', type },
    x: at.x,
    y: at.y,
    elevation: spec.elevation,
    rotation: 0,
    ...spec.size,
    params: { ...spec.params },
    materials: Object.fromEntries(Object.entries(spec.slots).map(([k, s]) => [k, s.default])),
  }
}

export interface LightingLook {
  sunElevation: number
  sunColor: string
  sunIntensity: number
  skyTop: string
  skyBottom: string
  envIntensity: number
  /** Ceiling lights are always on at night. */
  forceLights: boolean
}

export const LIGHTING_LOOKS: Record<LightingPreset, LightingLook & { label: string }> = {
  morning: { label: 'Morning', sunElevation: 18, sunColor: '#ffd8a8', sunIntensity: 3, skyTop: '#9fc4f5', skyBottom: '#f6e2c8', envIntensity: 0.9, forceLights: false },
  noon: { label: 'Noon', sunElevation: 58, sunColor: '#fff4e2', sunIntensity: 4, skyTop: '#86b2f0', skyBottom: '#eef2f7', envIntensity: 1.1, forceLights: false },
  evening: { label: 'Evening', sunElevation: 7, sunColor: '#ff9d5c', sunIntensity: 2.6, skyTop: '#5f6fa8', skyBottom: '#f3ab78', envIntensity: 0.55, forceLights: false },
  night: { label: 'Night', sunElevation: 30, sunColor: '#9fb3ff', sunIntensity: 0, skyTop: '#05070d', skyBottom: '#141a26', envIntensity: 0.04, forceLights: true },
}

/** Approximate sRGB colour of a black-body light source. */
export function kelvinToHex(k: number): string {
  const t = Math.min(40000, Math.max(1000, k)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
