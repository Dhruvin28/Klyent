import type { ReactNode } from 'react'
import { ImageOff, Paintbrush } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVizAssetUrl } from '@/hooks/useVisualizer'
import type { VizMaterial } from '@/lib/visualizer/types'

export function VizAssetImage({ id, alt, className }: { id: string | null | undefined; alt: string; className?: string }) {
  const { url, isError } = useVizAssetUrl(id)
  if (!id || isError) {
    return (
      <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
        <ImageOff className="h-5 w-5" />
      </div>
    )
  }
  if (!url) return <div className={cn('animate-pulse bg-muted', className)} />
  return <img src={url} alt={alt} className={className} draggable={false} />
}

export function MaterialSwatch({ material, className }: { material: VizMaterial | undefined; className?: string }) {
  if (!material) {
    return (
      <div className={cn('flex items-center justify-center rounded border border-dashed bg-muted text-muted-foreground', className)}>
        <Paintbrush className="h-4 w-4" />
      </div>
    )
  }
  if (material.kind === 'paint') {
    return <div className={cn('rounded border', className)} style={{ backgroundColor: material.colorHex ?? '#ccc' }} title={material.name} />
  }
  return <VizAssetImage id={material.textureAssetId} alt={material.name} className={cn('rounded border object-cover', className)} />
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  hint?: string
}) {
  return (
    <label className="block space-y-1" title={hint}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        className="w-full accent-primary"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'sm',
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'xs'
}) {
  return (
    <div className="inline-flex w-full rounded-md border bg-muted p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded px-2 font-medium transition-colors',
            size === 'xs' ? 'py-0.5 text-[11px]' : 'py-1 text-xs',
            value === o.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
        <input
          type="number"
          className="h-8 w-full min-w-0 bg-transparent px-2 text-sm outline-none disabled:opacity-60"
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : ''}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (e.target.value !== '' && Number.isFinite(v)) onChange(v)
          }}
        />
        {suffix && <span className="pr-2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  )
}

export const SURFACE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#ea580c']

export function surfaceColor(index: number) {
  return SURFACE_COLORS[index % SURFACE_COLORS.length]
}
