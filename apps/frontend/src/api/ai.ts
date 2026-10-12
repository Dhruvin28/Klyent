import { api } from '@/lib/axios'

export interface AiSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface AiAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: 'upload' | 'generated'
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  attachments: AiAttachment[]
}

export interface AiStatus {
  configured: boolean
}

export interface AiRunOptions {
  model: string
  reasoningEffort: string // '' = model default
  imageModel: string
}

export const aiApi = {
  getStatus: async (): Promise<AiStatus> => (await api.get<{ data: AiStatus }>('/ai/status')).data.data,

  getSessions: async (): Promise<AiSession[]> => (await api.get<{ data: AiSession[] }>('/ai/sessions')).data.data,

  createSession: async (): Promise<AiSession> => (await api.post<{ data: AiSession }>('/ai/sessions')).data.data,

  renameSession: async (id: string, title: string): Promise<AiSession> =>
    (await api.patch<{ data: AiSession }>(`/ai/sessions/${id}`, { title })).data.data,

  deleteSession: async (id: string): Promise<void> => {
    await api.delete(`/ai/sessions/${id}`)
  },

  getMessages: async (sessionId: string): Promise<AiMessage[]> =>
    (await api.get<{ data: AiMessage[] }>(`/ai/sessions/${sessionId}/messages`)).data.data,

  sendMessage: async (
    sessionId: string,
    content: string,
    files: File[],
    run: AiRunOptions
  ): Promise<{ userMessage: AiMessage; assistantMessage: AiMessage }> => {
    const form = new FormData()
    form.append('content', content)
    form.append('model', run.model)
    form.append('reasoningEffort', run.reasoningEffort)
    form.append('imageModel', run.imageModel)
    files.forEach((f) => form.append('files', f))
    const res = await api.post<{ data: { userMessage: AiMessage; assistantMessage: AiMessage } }>(
      `/ai/sessions/${sessionId}/messages`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 10 * 60 * 1000 }
    )
    return res.data.data
  },

  getAttachmentBlob: async (id: string): Promise<Blob> =>
    (await api.get<Blob>(`/ai/attachments/${id}`, { responseType: 'blob' })).data,
}
