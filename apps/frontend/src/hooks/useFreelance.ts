import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { freelanceApi } from '@/api/freelance'

export function useFreelanceProjects(params?: { status?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['freelance', params],
    queryFn: () => freelanceApi.getProjects(params),
  })
}

export function useFreelanceProject(id: string) {
  return useQuery({
    queryKey: ['freelance', id],
    queryFn: () => freelanceApi.getProject(id),
    enabled: !!id,
  })
}

export function useCreateFreelanceProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: freelanceApi.createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['freelance'] }),
  })
}

export function useUpdateFreelanceProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof freelanceApi.updateProject>[1] }) =>
      freelanceApi.updateProject(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['freelance'] }),
  })
}

export function useDeleteFreelanceProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: freelanceApi.deleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['freelance'] }),
  })
}

export function useAddWorkLog(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof freelanceApi.addWorkLog>[1]) =>
      freelanceApi.addWorkLog(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['freelance', projectId] }),
  })
}

export function useUpdateWorkLog(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ logId, data }: { logId: string; data: Parameters<typeof freelanceApi.updateWorkLog>[2] }) =>
      freelanceApi.updateWorkLog(projectId, logId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['freelance', projectId] }),
  })
}

export function useDeleteWorkLog(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (logId: string) => freelanceApi.deleteWorkLog(projectId, logId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['freelance', projectId] }),
  })
}
