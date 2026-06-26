import { api, publicApi } from '@/lib/axios'
import type { Proposal, PaginatedResponse } from '@/types'

export interface ProposalParams {
  status?: string
  page?: number
  limit?: number
}

export interface CreateProposalData {
  proposalNumber: string
  serviceType: string
  date: string
  validTill: string
  clientName: string
  clientPhone?: string | null
  clientEmail?: string | null
  clientAddress?: string | null
  siteName?: string | null
  projectLocation?: string | null
  projectType?: string | null
  projectScope?: string | null
  aboutCompany?: string | null
  scopeOfWork?: string[] | null
  feesDescription: string
  feesAmount: number
  feesAmountInWords?: string | null
  feesNote?: string | null
  paymentMilestones?: { milestone: number; description: string; percentage: number; amount: number }[] | null
  termsAndConditions?: string[] | null
  status?: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED'
}

interface BackendPaginated<T> {
  data: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export const proposalsApi = {
  getProposals: async (params?: ProposalParams): Promise<PaginatedResponse<Proposal>> => {
    const res = await api.get<BackendPaginated<Proposal>>('/proposals', { params })
    return {
      data: res.data.data,
      page: res.data.pagination.page,
      limit: res.data.pagination.limit,
      total: res.data.pagination.total,
      totalPages: res.data.pagination.totalPages,
    }
  },

  getProposal: async (id: string): Promise<Proposal> => {
    const res = await api.get<{ data: Proposal }>(`/proposals/${id}`)
    return res.data.data
  },

  getProposalByToken: async (token: string): Promise<Proposal> => {
    const res = await publicApi.get<{ data: Proposal }>(`/proposals/share/${token}`)
    return res.data.data
  },

  createProposal: async (data: CreateProposalData): Promise<Proposal> => {
    const res = await api.post<{ data: Proposal }>('/proposals', data)
    return res.data.data
  },

  // Save the given data as a new version of an existing proposal (same lineage).
  createVersion: async (id: string, data: CreateProposalData): Promise<Proposal> => {
    const res = await api.post<{ data: Proposal }>(`/proposals/${id}/version`, data)
    return res.data.data
  },

  updateProposal: async (id: string, data: Partial<CreateProposalData>): Promise<Proposal> => {
    const res = await api.patch<{ data: Proposal }>(`/proposals/${id}`, data)
    return res.data.data
  },

  deleteProposal: async (id: string): Promise<void> => {
    await api.delete(`/proposals/${id}`)
  },

  generateShareToken: async (id: string): Promise<string> => {
    const res = await api.post<{ data: { shareToken: string } }>(`/proposals/${id}/share`)
    return res.data.data.shareToken
  },
}
