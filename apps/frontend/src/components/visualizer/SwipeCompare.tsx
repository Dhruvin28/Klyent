import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Before / after swipe: the right image is revealed to the right of a draggable
 * divider. Works with mouse, touch and the keyboard (← →).
 */
export function SwipeCompare({
  before,
  after,
  beforeLabel = 'Before',
  afterLabel = 'After',
  className,
}: {
  before: string
  after: string
  beforeLabel?: string
  afterLabel?: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(0.5)
  const [dragging, setDragging] = useState(false)
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (r && r.width > 0) setPos(Math.max(0, Math.min(1, (clientX - r.left) / r.width)))
  }
  return (
    <div
      ref={box}
      className={cn('relative w-full touch-none select-none overflow-hidden rounded-md border bg-muted', className)}
      onPointerDown={(e) => {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        setDragging(true)
        move(e.clientX)
      }}
      onPointerMove={(e) => dragging && move(e.clientX)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      role="slider"
      aria-label="Before and after comparison"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 0.05))
        if (e.key === 'ArrowRight') setPos((p) => Math.min(1, p + 0.05))
      }}
      data-testid="viz-swipe"
    >
      <img src={before} alt={beforeLabel} className="block w-full" draggable={false} />
      <img
        src={after}
        alt={afterLabel}
        className="absolute inset-0 block h-full w-full"
        style={{ clipPath: `inset(0 0 0 ${pos * 100}%)` }}
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${pos * 100}%` }}>
        <div className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs text-black shadow">⇆</div>
      </div>
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{beforeLabel}</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{afterLabel}</span>
    </div>
  )
}
