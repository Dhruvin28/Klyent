import { api } from '@/lib/axios'
import type {
  ElevationAssignment,
  PageDetail,
  PageMeta,
  PageRole,
  Pt,
  RenderSet,
  Report,
  RevisionDetail,
  Units,
  ValidationRun,
  WorkspaceListItem,
  WorkspaceSummary,
  Decision,
} from '@/lib/interior/types'

const LONG = { timeout: 300_000 }

export type InteriorCommand = Record<string, unknown> & { type: string }

export const interiorApi = {
  status: async () => (await api.get<{ data: { enabled: boolean; aiConfigured: boolean; model: string; reasoningEffort: string } }>('/interior/status')).data.data,

  listWorkspaces: async () => (await api.get<{ data: WorkspaceListItem[] }>('/interior/workspaces')).data.data,
  createWorkspace: async (body: { name: string; clientId?: string | null; mode: 'strict' | 'draft' }) =>
    (await api.post<{ data: WorkspaceSummary }>('/interior/workspaces', body)).data.data,
  getWorkspace: async (id: string) => (await api.get<{ data: WorkspaceSummary }>(`/interior/workspaces/${id}`)).data.data,
  updateWorkspace: async (id: string, body: { name?: string; mode?: 'strict' | 'draft'; referencePageId?: string | null; autoBuild?: boolean }) =>
    (await api.patch<{ data: WorkspaceSummary }>(`/interior/workspaces/${id}`, body)).data.data,
  deleteWorkspace: async (id: string) => {
    await api.delete(`/interior/workspaces/${id}`)
  },

  uploadDocuments: async (id: string, files: File[], revisionLabel?: string, onProgress?: (fraction: number) => void) => {
    const form = new FormData()
    if (revisionLabel) form.append('revisionLabel', revisionLabel)
    files.forEach((f) => form.append('files', f, f.name))
    const res = await api.post<{ data: { accepted: { id: string; name: string }[]; rejected: { name: string; code: string; message: string }[] } }>(`/interior/workspaces/${id}/documents`, form, {
      ...LONG,
      onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
      validateStatus: (s) => s === 202 || s === 400,
    })
    return res.data.data
  },
  deleteDocument: async (id: string) => {
    await api.delete(`/interior/documents/${id}`)
  },

  getPage: async (id: string) => (await api.get<{ data: PageDetail }>(`/interior/pages/${id}`)).data.data,
  getPageImage: async (id: string, variant: 'preview' | 'full' = 'preview') => (await api.get<Blob>(`/interior/pages/${id}/image`, { params: { variant }, responseType: 'blob', ...LONG })).data,
  updatePage: async (
    id: string,
    body: {
      role?: PageRole | null
      excluded?: boolean
      assignment?: ElevationAssignment | null
      calibration?: { units?: Units; manual?: { p1: Pt; p2: Pt; distanceMm: number } | null } | null
      registration?: { dxMm: number; dyMm: number } | null
    }
  ) => (await api.patch<{ data: PageMeta }>(`/interior/pages/${id}`, body)).data.data,
  reinterpretPage: async (id: string) => (await api.post<{ data: { jobId: string } }>(`/interior/pages/${id}/interpret`)).data.data,

  build: async (id: string) => (await api.post<{ data: { jobId: string } }>(`/interior/workspaces/${id}/build`, {}, { headers: { 'Idempotency-Key': crypto.randomUUID() } })).data.data,
  getJob: async (id: string) => (await api.get<{ data: { id: string; status: string; error: string | null; errorCode: string | null; result: { revisionId?: string; walls?: number; rooms?: number } | null } }>(`/interior/jobs/${id}`)).data.data,
  cancelJob: async (id: string) => {
    await api.post(`/interior/jobs/${id}/cancel`)
  },
  retryJob: async (id: string) => (await api.post<{ data: { jobId: string } }>(`/interior/jobs/${id}/retry`)).data.data,

  getRevision: async (id: string) => (await api.get<{ data: RevisionDetail }>(`/interior/revisions/${id}`, LONG)).data.data,
  applyCommands: async (id: string, baseLockVersion: number, commands: InteriorCommand[]) =>
    (await api.post<{ data: { revision: RevisionDetail; validation: ValidationRun; rebuildQueued: boolean } }>(`/interior/revisions/${id}/commands`, { baseLockVersion, commands })).data.data,
  validate: async (id: string) => (await api.post<{ data: ValidationRun }>(`/interior/revisions/${id}/validate`)).data.data,
  freeze: async (id: string, baseLockVersion: number) => (await api.post<{ data: { validation: ValidationRun } }>(`/interior/revisions/${id}/freeze`, { baseLockVersion })).data.data,
  approve: async (id: string, body: { validationRunId: string; mode: 'final' | 'draft'; note?: string }) =>
    (await api.post<{ data: { approvalId: string } }>(`/interior/revisions/${id}/approve`, body)).data.data,
  fork: async (id: string) => (await api.post<{ data: { revisionId: string } }>(`/interior/revisions/${id}/fork`)).data.data,
  pushToDesigner: async (id: string, force = false) =>
    (await api.post<{ data: { designProjectId: string; designerRevision: number } }>(`/interior/revisions/${id}/designer`, { force })).data.data,
  syncFromDesigner: async (id: string) => (await api.post<{ data: { revisionId: string; changed: number; removed: number } }>(`/interior/revisions/${id}/sync-designer`)).data.data,
  designerLink: async (workspaceId: string) =>
    (await api.get<{ data: { id: string; revision: number; updatedAt: string; editedSincePush: boolean } | null }>(`/interior/workspaces/${workspaceId}/designer`)).data.data,
  decisions: async (workspaceId: string) => (await api.get<{ data: Decision[] }>(`/interior/workspaces/${workspaceId}/decisions`)).data.data,
  report: async (revisionId: string) => (await api.get<{ data: Report }>(`/interior/revisions/${revisionId}/report`)).data.data,

  createRenderSet: async (revisionId: string, body: { viewKeys: string[]; quality: 'draft' | 'presentation' | 'high_resolution'; longSide: number; allowDraft: boolean; rerun?: boolean; enhance?: boolean }) =>
    (await api.post<{ data: RenderSet }>(`/interior/revisions/${revisionId}/render-sets`, body)).data.data,
  listRenderSets: async (workspaceId: string) => (await api.get<{ data: RenderSet[] }>(`/interior/workspaces/${workspaceId}/render-sets`)).data.data,
  retryRenderSet: async (setId: string) => (await api.post<{ data: RenderSet }>(`/interior/render-sets/${setId}/retry`)).data.data,
  renderCapabilities: async () => (await api.get<{ data: { serverRendering: boolean; photoreal: boolean; imageModel: string } }>('/interior/render-capabilities')).data.data,
}
