import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { filesApi } from '@/api/files'

export function useFiles(clientId: string) {
  return useQuery({
    queryKey: ['files', clientId],
    queryFn: () => filesApi.getFiles(clientId),
    enabled: !!clientId,
  })
}

export function useUploadFile(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, name, description, onProgress }: { file: globalThis.File; name?: string; description?: string; onProgress?: (p: number) => void }) =>
      filesApi.uploadFile(clientId, file, { name, description, onProgress }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', clientId] })
      qc.invalidateQueries({ queryKey: ['clients', clientId] })
    },
  })
}

export function useFileVersions(id: string) {
  return useQuery({
    queryKey: ['file-versions', id],
    queryFn: () => filesApi.getFileVersions(id),
    enabled: !!id,
  })
}

export function useDeleteFile(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => filesApi.deleteFile(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', clientId] })
      qc.invalidateQueries({ queryKey: ['clients', clientId] })
    },
  })
}

export function useComments(fileId: string) {
  return useQuery({
    queryKey: ['comments', fileId],
    queryFn: () => filesApi.getComments(fileId),
    enabled: !!fileId,
  })
}

export function useAddComment(fileId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => filesApi.addComment(fileId, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', fileId] })
    },
  })
}
