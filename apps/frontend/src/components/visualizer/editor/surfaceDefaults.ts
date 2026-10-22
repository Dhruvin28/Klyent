import type { SurfaceType } from '@/lib/visualizer/types'

export const MAX_SURFACES = 30 // server limit

/** Typical real size (mm) of a new surface, until the designer enters the measured width. */
export const DEFAULT_SIZE: Record<SurfaceType, [number, number]> = {
  wardrobe: [2400, 2100],
  cabinet: [1800, 750],
  wall: [3600, 2700],
  floor: [4000, 3500],
  ceiling: [4000, 3500],
  panel: [1200, 2400],
  countertop: [2400, 600],
  backsplash: [2400, 600],
  door: [900, 2100],
  other: [1000, 1000],
}
