import { api, publicApi } from '@/lib/axios'
import type {
  DesignModel,
  DesignProject,
  DesignProjectSummary,
  DesignRender,
  DesignRenderKind,
  DesignShare,
  Plan,
  PolyHavenModel,
  PublicDesignShare,
} from '@/lib/designer/types'

// Model packing and video uploads can take a while.
const LONG = { timeout: 180_000 }

export interface ModelInput {
  name: string
  category: string
  widthMm: number
  depthMm: number
  heightMm: number
  price?: number | null
  brand?: string | null
}

export function designerPublicAssetUrl(path: string): string {
  return `${import.meta.env.VITE_API_URL ?? '/api'}${path}`
}

export const designerApi = {
  listProjects: async () => (await api.get<{ data: DesignProjectSummary[] }>('/designer/projects')).data.data,

  createProject: async (data: { name: string; clientId?: string | null; plan?: Plan }) =>
    (await api.post<{ data: DesignProject }>('/designer/projects', data)).data.data,

  getProject: async (id: string) => (await api.get<{ data: DesignProject }>(`/designer/projects/${id}`)).data.data,

  /** Rejected with 409 when `revision` is stale (edited in another tab). */
  updateProject: async (id: string, data: { revision: number; name?: string; clientId?: string | null; plan?: Plan }) =>
    (await api.patch<{ data: DesignProject }>(`/designer/projects/${id}`, data)).data.data,

  deleteProject: async (id: string) => {
    await api.delete(`/designer/projects/${id}`)
  },

  uploadThumbnail: async (id: string, file: Blob) => {
    const form = new FormData()
    form.append('file', file, 'thumbnail.jpg')
    return (await api.post<{ data: { thumbnailAssetId: string } }>(`/designer/projects/${id}/thumbnail`, form)).data.data
  },

  uploadUnderlay: async (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return (await api.post<{ data: { assetId: string; width: number; height: number } }>(`/designer/projects/${id}/underlay`, form, LONG)).data.data
  },

  getAssetBlob: async (id: string) =>
    (await api.get<Blob>(`/designer/assets/${id}`, { responseType: 'blob', ...LONG })).data,

  // ── Renders, panoramas and videos ──
  listRenders: async (projectId: string) =>
    (await api.get<{ data: DesignRender[] }>(`/designer/projects/${projectId}/renders`)).data.data,

  uploadRender: async (
    projectId: string,
    file: Blob,
    info: { kind: DesignRenderKind; name: string; width?: number; height?: number; meta?: DesignRender['meta'] }
  ) => {
    const form = new FormData()
    form.append('kind', info.kind)
    form.append('name', info.name)
    if (info.width) form.append('width', String(info.width))
    if (info.height) form.append('height', String(info.height))
    form.append('meta', JSON.stringify(info.meta ?? {}))
    const ext = info.kind === 'video' ? (file.type.includes('mp4') ? 'mp4' : 'webm') : file.type.includes('png') ? 'png' : 'jpg'
    form.append('file', file, `${info.name}.${ext}`)
    return (await api.post<{ data: DesignRender }>(`/designer/projects/${projectId}/renders`, form, LONG)).data.data
  },

  deleteRender: async (id: string) => {
    await api.delete(`/designer/renders/${id}`)
  },

  // ── Model catalog ──
  listModels: async () => (await api.get<{ data: DesignModel[] }>('/designer/models')).data.data,

  uploadModel: async (glb: File, thumbnail: Blob | null, data: ModelInput) => {
    const form = new FormData()
    form.append('name', data.name)
    form.append('category', data.category)
    form.append('widthMm', String(data.widthMm))
    form.append('depthMm', String(data.depthMm))
    form.append('heightMm', String(data.heightMm))
    if (data.price != null) form.append('price', String(data.price))
    if (data.brand) form.append('brand', data.brand)
    form.append('model', glb, glb.name)
    if (thumbnail) form.append('thumbnail', thumbnail, 'thumbnail.png')
    return (await api.post<{ data: DesignModel }>('/designer/models', form, LONG)).data.data
  },

  updateModel: async (id: string, data: Partial<ModelInput>) =>
    (await api.patch<{ data: DesignModel }>(`/designer/models/${id}`, data)).data.data,

  deleteModel: async (id: string) => {
    await api.delete(`/designer/models/${id}`)
  },

  listPolyHaven: async (category: string) =>
    (await api.get<{ data: PolyHavenModel[] }>('/designer/polyhaven', { params: { category } })).data.data,

  importPolyHaven: async (assetId: string) =>
    (await api.post<{ data: DesignModel }>(`/designer/polyhaven/${encodeURIComponent(assetId)}/import`, {}, LONG)).data.data,

  // ── Share links (virtual tour) ──
  createShare: async (projectId: string, data: { title: string; message?: string; renderIds: string[]; expiresInDays?: number | null }) =>
    (await api.post<{ data: DesignShare }>(`/designer/projects/${projectId}/shares`, data)).data.data,

  listShares: async (projectId: string) =>
    (await api.get<{ data: DesignShare[] }>(`/designer/projects/${projectId}/shares`)).data.data,

  revokeShare: async (id: string) => {
    await api.delete(`/designer/shares/${id}`)
  },
}

export const designerPublicApi = {
  getShare: async (token: string) =>
    (await publicApi.get<{ data: PublicDesignShare }>(`/designer-public/shares/${token}`)).data.data,
}
