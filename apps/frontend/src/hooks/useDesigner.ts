import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { designerApi } from '@/api/designer'
import type { DesignModel } from '@/lib/designer/types'

export function useDesignProjects() {
  return useQuery({ queryKey: ['designer', 'projects'], queryFn: designerApi.listProjects })
}

export function useDesignProject(id: string) {
  return useQuery({
    queryKey: ['designer', 'projects', id],
    queryFn: () => designerApi.getProject(id),
    enabled: !!id,
    // The editor owns the live plan after load (same policy as the visualizer).
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}

export function useDeleteDesignProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: designerApi.deleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['designer', 'projects'] }),
  })
}

export function useDesignModels() {
  return useQuery({ queryKey: ['designer', 'models'], queryFn: designerApi.listModels })
}

export function useDesignModelMap() {
  const { data } = useDesignModels()
  return useMemo(() => new Map<string, DesignModel>((data ?? []).map((m) => [m.id, m])), [data])
}

export function useDeleteDesignModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: designerApi.deleteModel,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['designer', 'models'] }),
  })
}

export function useDesignRenders(projectId: string) {
  return useQuery({
    queryKey: ['designer', 'renders', projectId],
    queryFn: () => designerApi.listRenders(projectId),
    enabled: !!projectId,
  })
}

export function useDesignShares(projectId: string) {
  return useQuery({
    queryKey: ['designer', 'shares', projectId],
    queryFn: () => designerApi.listShares(projectId),
    enabled: !!projectId,
  })
}

export function useDesignAssetBlob(id: string | null | undefined) {
  return useQuery({
    queryKey: ['designer', 'asset', id],
    queryFn: () => designerApi.getAssetBlob(id!),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  })
}

/** Object URL for an authenticated designer asset (revoked on unmount). */
export function useDesignAssetUrl(id: string | null | undefined) {
  const { data: blob, isError, isLoading } = useDesignAssetBlob(id)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return { url, isError, isLoading }
}
