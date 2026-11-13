import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { interiorApi } from '@/api/interior'

export const interiorKeys = {
  workspaces: ['interior', 'workspaces'] as const,
  workspace: (id: string) => ['interior', 'workspace', id] as const,
  page: (id: string) => ['interior', 'page', id] as const,
  revision: (id: string) => ['interior', 'revision', id] as const,
  renderSets: (id: string) => ['interior', 'render-sets', id] as const,
  decisions: (id: string) => ['interior', 'decisions', id] as const,
}

export function useInteriorStatus() {
  return useQuery({ queryKey: ['interior', 'status'], queryFn: interiorApi.status, staleTime: 60_000 })
}

export function useInteriorWorkspaces() {
  return useQuery({ queryKey: interiorKeys.workspaces, queryFn: interiorApi.listWorkspaces })
}

/** Polls every 2 s while extraction / interpretation / build jobs are active. */
export function useInteriorWorkspace(id: string) {
  return useQuery({
    queryKey: interiorKeys.workspace(id),
    queryFn: () => interiorApi.getWorkspace(id),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  })
}

export function useInteriorPage(id: string | null, version?: string | null) {
  return useQuery({
    queryKey: [...interiorKeys.page(id ?? ''), version ?? ''],
    queryFn: () => interiorApi.getPage(id!),
    enabled: !!id,
  })
}

export function useInteriorRevision(id: string | null) {
  return useQuery({ queryKey: interiorKeys.revision(id ?? ''), queryFn: () => interiorApi.getRevision(id!), enabled: !!id, staleTime: 30_000 })
}

export function useRenderSets(workspaceId: string) {
  return useQuery({ queryKey: interiorKeys.renderSets(workspaceId), queryFn: () => interiorApi.listRenderSets(workspaceId), enabled: !!workspaceId })
}

/** Object URL for an authenticated page raster (revoked on unmount). */
export function usePageImageUrl(pageId: string | null | undefined, variant: 'preview' | 'full' = 'preview') {
  const { data: blob } = useQuery({
    queryKey: ['interior', 'page-image', pageId, variant],
    queryFn: () => interiorApi.getPageImage(pageId!, variant),
    enabled: !!pageId,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
