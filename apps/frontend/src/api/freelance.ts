import { api } from '@/lib/axios'
import type { FreelanceProject, FreelanceWorkLog } from '@/types'

export const freelanceApi = {
  getProjects: async (params?: { status?: string; page?: number; limit?: number }) => {
    const res = await api.get<{ data: FreelanceProject[]; pagination: { total: number; totalPages: number; page: number; limit: number } }>('/freelance', { params })
    return res.data
  },

  getProject: async (id: string): Promise<FreelanceProject> => {
    const res = await api.get<{ data: FreelanceProject }>(`/freelance/${id}`)
    return res.data.data
  },

  createProject: async (data: {
    clientName: string
    workType: string
    chargeType: string
    rate: number
    notes?: string
  }): Promise<FreelanceProject> => {
    const res = await api.post<{ data: FreelanceProject }>('/freelance', data)
    return res.data.data
  },

  updateProject: async (id: string, data: {
    clientName?: string
    workType?: string
    chargeType?: string
    rate?: number
    status?: 'ACTIVE' | 'COMPLETED'
    notes?: string | null
  }): Promise<FreelanceProject> => {
    const res = await api.patch<{ data: FreelanceProject }>(`/freelance/${id}`, data)
    return res.data.data
  },

  deleteProject: async (id: string): Promise<void> => {
    await api.delete(`/freelance/${id}`)
  },

  addWorkLog: async (projectId: string, data: {
    quantity: number
    description?: string
    date: string
  }): Promise<{ data: FreelanceWorkLog; stats: { totalBilled: number; totalPaid: number; remainingBalance: number } }> => {
    const res = await api.post(`/freelance/${projectId}/work-logs`, data)
    return res.data
  },

  updateWorkLog: async (projectId: string, logId: string, data: {
    quantity?: number
    description?: string | null
    date?: string
  }): Promise<{ data: FreelanceWorkLog; stats: { totalBilled: number; totalPaid: number; remainingBalance: number } }> => {
    const res = await api.patch(`/freelance/${projectId}/work-logs/${logId}`, data)
    return res.data
  },

  deleteWorkLog: async (projectId: string, logId: string): Promise<{ stats: { totalBilled: number; totalPaid: number; remainingBalance: number } }> => {
    const res = await api.delete(`/freelance/${projectId}/work-logs/${logId}`)
    return res.data
  },
}
