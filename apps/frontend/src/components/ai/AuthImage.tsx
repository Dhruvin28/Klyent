import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiApi } from '@/api/ai'

/** Fetches an attachment with the auth header and exposes it as an object URL. */
export function useAttachmentUrl(id: string) {
  const { data: blob, isError, isLoading } = useQuery({
    queryKey: ['ai', 'attachment', id],
    queryFn: () => aiApi.getAttachmentBlob(id),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return { url, isError, isLoading }
}

export function AuthImage({ id, alt, className, onClick }: { id: string; alt: string; className?: string; onClick?: () => void }) {
  const { url, isError } = useAttachmentUrl(id)
  if (isError) return <div className="flex h-40 w-40 items-center justify-center rounded-lg border text-xs text-muted-foreground">Image unavailable</div>
  if (!url) return <div className="h-40 w-40 animate-pulse rounded-lg bg-muted" />
  return <img src={url} alt={alt} className={className} onClick={onClick} />
}
