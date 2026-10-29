import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clapperboard, Globe, Image as ImageIcon, Orbit, Phone } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'
import { apiErrorMessage } from '@/api/visualizer'
import { designerPublicApi, designerPublicAssetUrl } from '@/api/designer'
import { PanoramaViewer } from '@/components/designer/PanoramaViewer'
import type { PublicDesignShare } from '@/lib/designer/types'

type TourItem = PublicDesignShare['items'][number]

const ICON = { render: ImageIcon, panorama: Orbit, video: Clapperboard } as const

/** Client-facing virtual tour: 360° panoramas, renders and walkthroughs, no login. */
export function DesignerTourPage() {
  const { token = '' } = useParams()
  const { data, isLoading, error } = useQuery({ queryKey: ['designer-tour', token], queryFn: () => designerPublicApi.getShare(token), retry: false })
  const [active, setActive] = useState<TourItem | null>(null)

  useEffect(() => {
    if (data && !active) setActive(data.items.find((i) => i.kind === 'panorama') ?? data.items[0] ?? null)
  }, [data, active])

  useEffect(() => {
    if (data) document.title = `${data.title} — virtual tour`
  }, [data])

  if (isLoading) return <LoadingSpinner />
  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <p className="text-lg font-semibold">This tour isn’t available</p>
          <p className="text-sm text-muted-foreground">{apiErrorMessage(error)}</p>
        </div>
      </div>
    )
  }

  const src = active ? designerPublicAssetUrl(active.path) : null

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
        {data.company.logoUrl && <img src={data.company.logoUrl} alt="" className="h-9 w-9 rounded object-contain" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{data.title}</h1>
          <p className="truncate text-xs text-zinc-400">{[data.company.name, data.projectName !== data.title ? data.projectName : null].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex gap-3 text-xs text-zinc-400">
          {data.company.phone && (
            <a href={`tel:${data.company.phone}`} className="flex items-center gap-1 hover:text-white">
              <Phone className="h-3.5 w-3.5" /> {data.company.phone}
            </a>
          )}
          {data.company.website && (
            <a href={/^https?:\/\//.test(data.company.website) ? data.company.website : `https://${data.company.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-white">
              <Globe className="h-3.5 w-3.5" /> Website
            </a>
          )}
        </div>
      </header>

      {data.message && <p className="whitespace-pre-line border-b border-zinc-800 px-4 py-3 text-sm text-zinc-300">{data.message}</p>}

      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <div className="overflow-hidden rounded-xl bg-black">
          {active && src ? (
            active.kind === 'panorama' ? (
              <div className="relative">
                <PanoramaViewer src={src} className="aspect-video w-full" />
                <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-xs">Drag to look around · scroll to zoom</span>
              </div>
            ) : active.kind === 'video' ? (
              <video key={src} src={src} controls autoPlay playsInline className="aspect-video w-full" />
            ) : (
              <img src={src} alt={active.name} className="max-h-[75vh] w-full object-contain" />
            )
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">Nothing to show</div>
          )}
        </div>
        {active && <p className="text-sm font-medium">{active.name}</p>}

        {data.items.length > 1 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {data.items.map((it) => {
              const Icon = ICON[it.kind]
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setActive(it)}
                  className={cn('overflow-hidden rounded-lg border text-left transition-colors', active?.id === it.id ? 'border-white' : 'border-zinc-800 hover:border-zinc-500')}
                >
                  {it.kind === 'video' ? (
                    <div className="flex aspect-video items-center justify-center bg-zinc-900">
                      <Clapperboard className="h-6 w-6 text-zinc-400" />
                    </div>
                  ) : (
                    <img src={designerPublicAssetUrl(it.path)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                  )}
                  <div className="flex items-center gap-1.5 p-1.5">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="truncate text-xs">{it.name}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
