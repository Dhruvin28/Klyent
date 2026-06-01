import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { filesApi } from '@/api/files'

type FileOwner = { clientId?: string; freelanceProjectId?: string }

export function useFiles(owner: FileOwner) {
  const key = owner.clientId ?? owner.freelanceProjectId ?? ''
  return useQuery({
    queryKey: ['files', key],
    queryFn: () => filesApi.getFiles(owner),
    enabled: !!(owner.clientId || owner.freelanceProjectId),
  })
}

export function useUploadFile(owner: FileOwner) {
  const qc = useQueryClient()
  const key = owner.clientId ?? owner.freelanceProjectId ?? ''
  return useMutation({
    mutationFn: ({ file, name, description, onProgress }: { file: globalThis.File; name?: string; description?: string; onProgress?: (p: number) => void }) =>
      filesApi.uploadFile(owner, file, { name, description, onProgress }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', key] })
      if (owner.clientId) qc.invalidateQueries({ queryKey: ['clients', owner.clientId] })
      if (owner.freelanceProjectId) qc.invalidateQueries({ queryKey: ['freelance', owner.freelanceProjectId] })
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

export function useDeleteFile(owner: FileOwner) {
  const qc = useQueryClient()
  const key = owner.clientId ?? owner.freelanceProjectId ?? ''
  return useMutation({
    mutationFn: (id: string) => filesApi.deleteFile(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', key] })
      if (owner.clientId) qc.invalidateQueries({ queryKey: ['clients', owner.clientId] })
      if (owner.freelanceProjectId) qc.invalidateQueries({ queryKey: ['freelance', owner.freelanceProjectId] })
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
