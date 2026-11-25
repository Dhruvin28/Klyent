import type { PageInterpretation } from '../contracts'
import { SegmentIndex, snapDimension, snapFootprint, snapOpening } from './refine'

/**
 * Deterministic clean-up of an interpretation before calibration/compilation. On vector
 * sheets (CAD PDF / DXF) the model's localisation noise is removed by snapping to the
 * drawing's own line work:
 *  - dimension end points → their extension lines (scale and constraint anchors),
 *  - door/window ends → the jamb lines of the wall gap (opening width and position),
 *  - furniture edges → the outline drawn for the piece (footprint width/depth).
 * Walls are refined separately (they also need raster support).
 */
export function prepareInterpretation(it: PageInterpretation | null, vectors: Float32Array | null): PageInterpretation | null {
  if (!it || !vectors || vectors.length < 5) return it
  const index = new SegmentIndex(vectors)
  const snap = <T extends { p1: { x: number; y: number }; p2: { x: number; y: number } }>(d: T): T => {
    const { snapped: _s, ...rest } = snapDimension(d, index)
    return rest as unknown as T
  }
  const walls = new Map(it.walls.map((w) => [w.id, w]))
  return {
    ...it,
    dimensions: it.dimensions.map(snap),
    openings: it.openings.map((o) => {
      const w = o.wallRef ? walls.get(o.wallRef) : undefined
      return w ? snapOpening(o, w, index) : o
    }),
    furniture: it.furniture.map((f) => snapFootprint(f, index)),
    elevation: it.elevation ? { ...it.elevation, heightDimensions: it.elevation.heightDimensions.map(snap) } : null,
  }
}
