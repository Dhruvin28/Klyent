import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { visualizerApi, type MaterialInput } from '@/api/visualizer'

export function useVizProjects() {
  return useQuery({ queryKey: ['visualizer', 'projects'], queryFn: visualizerApi.listProjects })
}

export function useVizProject(id: string) {
  return useQuery({
    queryKey: ['visualizer', 'projects', id],
    queryFn: () => visualizerApi.getProject(id),
    enabled: !!id,
    // The editor owns the live state after load; never clobber it with a refetch,
    // and drop the snapshot on leave so reopening always loads the latest revision.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}

export function useDeleteVizProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: visualizerApi.deleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visualizer', 'projects'] }),
  })
}

export function useVizMaterials() {
  return useQuery({ queryKey: ['visualizer', 'materials'], queryFn: visualizerApi.listMaterials })
}

export function useDeleteVizMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: visualizerApi.deleteMaterial,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visualizer', 'materials'] }),
  })
}

export function useUpdateVizMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MaterialInput> }) => visualizerApi.updateMaterial(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visualizer', 'materials'] }),
  })
}

export function useVizExports(projectId: string) {
  return useQuery({
    queryKey: ['visualizer', 'exports', projectId],
    queryFn: () => visualizerApi.listExports(projectId),
    enabled: !!projectId,
  })
}

export function useVizAssetBlob(id: string | null | undefined) {
  return useQuery({
    queryKey: ['visualizer', 'asset', id],
    queryFn: () => visualizerApi.getAssetBlob(id!),
    enabled: !!id,
    // Assets are immutable per id.
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  })
}

/** Object URL for an authenticated asset (revoked on unmount). */
export function useVizAssetUrl(id: string | null | undefined) {
  const { data: blob, isError, isLoading } = useVizAssetBlob(id)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return { url, isError, isLoading }
}
