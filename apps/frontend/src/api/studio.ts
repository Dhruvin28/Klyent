import { api } from '@/lib/axios'
import type {
  StudioProject,
  StudioMessage,
  StudioDocument,
  StudioTask,
  StudioDecision,
  StudioQuote,
  StudioAskResponse,
  StudioImportResult,
} from '@/types'

export interface CreateStudioProjectData {
  name: string
  clientName?: string
  siteAddress?: string
  projectType?: string
  budget?: number
  timelineNotes?: string
  clientId?: string
}

export const studioApi = {
  getProjects: async (): Promise<StudioProject[]> => {
    const res = await api.get<{ data: StudioProject[] }>('/studio/projects')
    return res.data.data
  },

  getProject: async (id: string): Promise<StudioProject> => {
    const res = await api.get<{ data: StudioProject }>(`/studio/projects/${id}`)
    return res.data.data
  },

  createProject: async (data: CreateStudioProjectData): Promise<StudioProject> => {
    const res = await api.post<{ data: StudioProject }>('/studio/projects', data)
    return res.data.data
  },

  getMessages: async (params?: { projectId?: string; limit?: number }): Promise<StudioMessage[]> => {
    const res = await api.get<{ data: StudioMessage[] }>('/studio/messages', { params })
    return res.data.data
  },

  getDocuments: async (params?: { projectId?: string }): Promise<StudioDocument[]> => {
    const res = await api.get<{ data: StudioDocument[] }>('/studio/documents', { params })
    return res.data.data
  },

  uploadDocument: async (file: File, opts?: { projectId?: string; groupName?: string }): Promise<StudioDocument> => {
    const form = new FormData()
    form.append('file', file)
    if (opts?.projectId) form.append('projectId', opts.projectId)
    if (opts?.groupName) form.append('groupName', opts.groupName)
    const res = await api.post<{ data: StudioDocument }>('/studio/documents', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data.data
  },

  getTasks: async (params?: { projectId?: string; status?: string }): Promise<StudioTask[]> => {
    const res = await api.get<{ data: StudioTask[] }>('/studio/tasks', { params })
    return res.data.data
  },

  updateTask: async (id: string, data: Partial<Pick<StudioTask, 'status' | 'priority'>>): Promise<StudioTask> => {
    const res = await api.patch<{ data: StudioTask }>(`/studio/tasks/${id}`, data)
    return res.data.data
  },

  getDecisions: async (params?: { projectId?: string }): Promise<StudioDecision[]> => {
    const res = await api.get<{ data: StudioDecision[] }>('/studio/decisions', { params })
    return res.data.data
  },

  getQuotes: async (params?: { projectId?: string }): Promise<StudioQuote[]> => {
    const res = await api.get<{ data: StudioQuote[] }>('/studio/quotes', { params })
    return res.data.data
  },

  ask: async (question: string, projectName?: string): Promise<StudioAskResponse> => {
    const res = await api.post<StudioAskResponse>('/studio/ask', { question, projectName })
    return res.data
  },

  importWhatsAppExport: async (file: File, groupName: string, projectId?: string): Promise<StudioImportResult> => {
    const form = new FormData()
    form.append('file', file)
    form.append('groupName', groupName)
    if (projectId) form.append('projectId', projectId)
    const res = await api.post<{ data: StudioImportResult }>('/studio/import/whatsapp-export', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data.data
  },

  getIngestionKeyStatus: async (): Promise<{ hasIngestionKey: boolean }> => {
    const res = await api.get<{ data: { hasIngestionKey: boolean } }>('/studio/settings')
    return res.data.data
  },

  generateIngestionKey: async (): Promise<string> => {
    const res = await api.post<{ data: { ingestionApiKey: string } }>('/studio/settings/ingestion-key')
    return res.data.data.ingestionApiKey
  },
}
