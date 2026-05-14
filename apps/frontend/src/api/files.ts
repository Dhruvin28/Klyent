import { api } from '@/lib/axios'
import type { File, FileVersion, Comment } from '@/types'

export const filesApi = {
  getFiles: async (clientId: string): Promise<File[]> => {
    const res = await api.get<{ data: File[] }>('/files', { params: { clientId } })
    return res.data.data
  },

  uploadFile: async (
    clientId: string,
    file: globalThis.File,
    options?: { name?: string; description?: string; onProgress?: (progress: number) => void }
  ): Promise<File> => {
    const formData = new FormData()
    formData.append('clientId', clientId)
    if (options?.name) formData.append('name', options.name)
    if (options?.description) formData.append('description', options.description)
    formData.append('file', file)
    const onProgress = options?.onProgress
    const res = await api.post<{ data: File }>('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          onProgress(pct)
        }
      },
    })
    return res.data.data
  },

  getFileVersions: async (id: string): Promise<FileVersion[]> => {
    const res = await api.get<{ data: FileVersion[] }>(`/files/${id}/versions`)
    return res.data.data
  },

  getFileDownloadUrl: async (id: string): Promise<string> => {
    const res = await api.get<{ url: string }>(`/files/${id}/download`)
    return res.data.url
  },

  getFilePreview: async (id: string): Promise<string> => {
    const res = await api.get<{ data: { url: string } }>(`/files/${id}/preview`)
    return res.data.data.url
  },

  deleteFile: async (id: string): Promise<void> => {
    await api.delete(`/files/${id}`)
  },

  getSharedFile: async (token: string): Promise<{ file: File; previewUrl: string }> => {
    const res = await api.get<{ data: {
      id: string; name: string; mimeType: string; clientName: string
      versionNumber: number; size: number; createdAt: string; updatedAt: string
      downloadUrl: string; expiresIn: number
    } }>(`/files/share/${token}`)
    const d = res.data.data
    return {
      file: {
        id: d.id,
        name: d.name,
        mimeType: d.mimeType,
        clientId: '',
        shareToken: token,
        createdAt: d.createdAt,
        latestVersion: {
          id: '',
          versionNumber: d.versionNumber,
          size: d.size,
          isActive: true,
          createdAt: d.createdAt,
        },
      },
      previewUrl: d.downloadUrl,
    }
  },

  getComments: async (fileId: string): Promise<Comment[]> => {
    const res = await api.get<{ data: Comment[] }>(`/files/${fileId}/comments`)
    return res.data.data
  },

  addComment: async (fileId: string, content: string): Promise<Comment> => {
    const res = await api.post<{ data: Comment }>(`/files/${fileId}/comments`, { content })
    return res.data.data
  },
}
