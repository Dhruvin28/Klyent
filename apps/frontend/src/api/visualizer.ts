import { api } from '@/lib/axios'
import type { VerificationReport, VizMaterial, VizState } from '@/lib/visualizer/types'

export interface VizProjectSummary {
  id: string
  name: string
  clientId: string | null
  clientName: string | null
  width: number
  height: number
  thumbnailAssetId: string | null
  createdAt: string
  updatedAt: string
}

export interface VizProject {
  id: string
  name: string
  clientId: string | null
  width: number
  height: number
  originalAssetId: string
  referenceAssetId: string
  thumbnailAssetId: string | null
  state: VizState
  revision: number
  createdAt: string
  updatedAt: string
}

export interface VizExport {
  id: string
  projectId: string
  optionId: string
  optionName: string
  imageAssetId: string
  maskAssetId: string
  details: ExportDetails
  verification: VerificationReport
  createdAt: string
}

export interface ExportDetails {
  project: string
  option: string
  approved: boolean
  notes: string
  generatedAt: string
  image: { width: number; height: number }
  surfaces: {
    name: string
    type: string
    widthMm: number
    heightMm: number
    material: {
      name: string
      kind: 'texture' | 'paint'
      category: string
      brand: string | null
      code: string | null
      colorHex: string | null
      sizeMm: [number, number] | null
    }
    application: Record<string, string | number | boolean>
  }[]
}

export interface MaterialInput {
  name: string
  kind: 'texture' | 'paint'
  category: string
  colorHex?: string | null
  widthMm?: number | null
  heightMm?: number | null
  brand?: string | null
  code?: string | null
  notes?: string | null
  settings?: VizMaterial['settings']
}

export function apiErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string }
  return e.response?.data?.message ?? e.response?.data?.error ?? e.message ?? 'Something went wrong'
}

const LONG = { timeout: 10 * 60 * 1000 }

export const visualizerApi = {
  listProjects: async (): Promise<VizProjectSummary[]> =>
    (await api.get<{ data: VizProjectSummary[] }>('/visualizer/projects')).data.data,

  getProject: async (id: string): Promise<VizProject> =>
    (await api.get<{ data: VizProject }>(`/visualizer/projects/${id}`)).data.data,

  createProject: async (
    input: { name: string; clientId?: string | null; original: File; reference: Blob; thumbnail: Blob },
    onProgress?: (fraction: number) => void
  ): Promise<VizProject> => {
    const form = new FormData()
    form.append('name', input.name)
    if (input.clientId) form.append('clientId', input.clientId)
    form.append('original', input.original, input.original.name)
    form.append('reference', input.reference, 'reference.png')
    form.append('thumbnail', input.thumbnail, 'thumbnail.jpg')
    const res = await api.post<{ data: VizProject }>('/visualizer/projects', form, {
      ...LONG,
      onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
    })
    return res.data.data
  },

  updateProject: async (
    id: string,
    patch: { revision: number; name?: string; clientId?: string | null; state?: VizState }
  ): Promise<VizProject> => (await api.patch<{ data: VizProject }>(`/visualizer/projects/${id}`, patch)).data.data,

  deleteProject: async (id: string): Promise<void> => {
    await api.delete(`/visualizer/projects/${id}`)
  },

  uploadMask: async (projectId: string, png: Blob): Promise<string> => {
    const form = new FormData()
    form.append('mask', png, 'mask.png')
    const res = await api.post<{ data: { id: string } }>(`/visualizer/projects/${projectId}/masks`, form, LONG)
    return res.data.data.id
  },

  getAssetBlob: async (id: string): Promise<Blob> =>
    (await api.get<Blob>(`/visualizer/assets/${id}`, { responseType: 'blob', ...LONG })).data,

  listMaterials: async (): Promise<VizMaterial[]> =>
    (await api.get<{ data: VizMaterial[] }>('/visualizer/materials')).data.data,

  createMaterial: async (data: MaterialInput, files: { texture?: Blob; source?: File }): Promise<VizMaterial> => {
    const form = new FormData()
    form.append('data', JSON.stringify(data))
    if (files.texture) form.append('texture', files.texture, 'texture.png')
    if (files.source) form.append('source', files.source, files.source.name)
    return (await api.post<{ data: VizMaterial }>('/visualizer/materials', form, LONG)).data.data
  },

  updateMaterial: async (id: string, data: Partial<MaterialInput>, files?: { texture?: Blob; source?: File }): Promise<VizMaterial> => {
    if (files?.texture || files?.source) {
      const form = new FormData()
      form.append('data', JSON.stringify(data))
      if (files.texture) form.append('texture', files.texture, 'texture.png')
      if (files.source) form.append('source', files.source, files.source.name)
      return (await api.patch<{ data: VizMaterial }>(`/visualizer/materials/${id}`, form, LONG)).data.data
    }
    return (await api.patch<{ data: VizMaterial }>(`/visualizer/materials/${id}`, data)).data.data
  },

  deleteMaterial: async (id: string): Promise<void> => {
    await api.delete(`/visualizer/materials/${id}`)
  },

  createExport: async (
    projectId: string,
    data: { optionId: string; details: ExportDetails },
    image: Blob,
    mask: Blob
  ): Promise<VizExport> => {
    const form = new FormData()
    form.append('data', JSON.stringify(data))
    form.append('image', image, 'result.png')
    form.append('mask', mask, 'mask.png')
    return (await api.post<{ data: VizExport }>(`/visualizer/projects/${projectId}/exports`, form, LONG)).data.data
  },

  listExports: async (projectId: string): Promise<VizExport[]> =>
    (await api.get<{ data: VizExport[] }>(`/visualizer/projects/${projectId}/exports`)).data.data,

  deleteExport: async (id: string): Promise<void> => {
    await api.delete(`/visualizer/exports/${id}`)
  },
}
