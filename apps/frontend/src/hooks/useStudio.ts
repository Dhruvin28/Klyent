import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { studioApi, type CreateStudioProjectData } from '@/api/studio'
import type { StudioTask } from '@/types'

export function useStudioProjects() {
  return useQuery({ queryKey: ['studio', 'projects'], queryFn: studioApi.getProjects })
}

export function useStudioProject(id: string) {
  return useQuery({
    queryKey: ['studio', 'projects', id],
    queryFn: () => studioApi.getProject(id),
    enabled: !!id,
  })
}

export function useCreateStudioProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateStudioProjectData) => studioApi.createProject(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'projects'] }),
  })
}

export function useStudioMessages(projectId?: string) {
  return useQuery({
    queryKey: ['studio', 'messages', projectId],
    queryFn: () => studioApi.getMessages({ projectId }),
    enabled: !!projectId,
  })
}

export function useStudioDocuments(projectId?: string) {
  return useQuery({
    queryKey: ['studio', 'documents', projectId],
    queryFn: () => studioApi.getDocuments({ projectId }),
    enabled: !!projectId,
  })
}

export function useUploadStudioDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, projectId, groupName }: { file: File; projectId?: string; groupName?: string }) =>
      studioApi.uploadDocument(file, { projectId, groupName }),
    onSuccess: (_, { projectId }) => qc.invalidateQueries({ queryKey: ['studio', 'documents', projectId] }),
  })
}

export function useStudioTasks(projectId?: string) {
  return useQuery({
    queryKey: ['studio', 'tasks', projectId],
    queryFn: () => studioApi.getTasks({ projectId }),
    enabled: !!projectId,
  })
}

export function useUpdateStudioTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<StudioTask, 'status' | 'priority'>> }) =>
      studioApi.updateTask(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'tasks'] }),
  })
}

export function useStudioDecisions(projectId?: string) {
  return useQuery({
    queryKey: ['studio', 'decisions', projectId],
    queryFn: () => studioApi.getDecisions({ projectId }),
    enabled: !!projectId,
  })
}

export function useStudioQuotes(projectId?: string) {
  return useQuery({
    queryKey: ['studio', 'quotes', projectId],
    queryFn: () => studioApi.getQuotes({ projectId }),
    enabled: !!projectId,
  })
}

export function useStudioAsk() {
  return useMutation({
    mutationFn: ({ question, projectName }: { question: string; projectName?: string }) =>
      studioApi.ask(question, projectName),
  })
}

export function useImportWhatsAppExport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, groupName, projectId }: { file: File; groupName: string; projectId?: string }) =>
      studioApi.importWhatsAppExport(file, groupName, projectId),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['studio', 'messages', projectId] })
      qc.invalidateQueries({ queryKey: ['studio', 'tasks', projectId] })
      qc.invalidateQueries({ queryKey: ['studio', 'decisions', projectId] })
      qc.invalidateQueries({ queryKey: ['studio', 'quotes', projectId] })
    },
  })
}

export function useStudioIngestionKeyStatus() {
  return useQuery({ queryKey: ['studio', 'ingestion-key-status'], queryFn: studioApi.getIngestionKeyStatus })
}

export function useGenerateStudioIngestionKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: studioApi.generateIngestionKey,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'ingestion-key-status'] }),
  })
}
