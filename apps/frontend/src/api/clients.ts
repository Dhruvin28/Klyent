import { api } from '@/lib/axios'
import type { Client, PaginatedResponse } from '@/types'

export interface ClientParams {
  search?: string
  status?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface CreateClientData {
  name: string
  email?: string
  phone?: string
  address?: string
  projectDescription?: string
  totalDealAmount: number
  status?: string
}

interface BackendPaginated<T> {
  data: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export const clientsApi = {
  getClients: async (params?: ClientParams): Promise<PaginatedResponse<Client>> => {
    const res = await api.get<BackendPaginated<Client>>('/clients', { params })
    return {
      data: res.data.data,
      page: res.data.pagination.page,
      limit: res.data.pagination.limit,
      total: res.data.pagination.total,
      totalPages: res.data.pagination.totalPages,
    }
  },

  getClient: async (id: string): Promise<Client> => {
    const res = await api.get<{ data: Client }>(`/clients/${id}`)
    return res.data.data
  },

  createClient: async (data: CreateClientData): Promise<Client> => {
    const res = await api.post<{ data: Client }>('/clients', data)
    return res.data.data
  },

  updateClient: async (id: string, data: Partial<CreateClientData>): Promise<Client> => {
    const res = await api.patch<{ data: Client }>(`/clients/${id}`, data)
    return res.data.data
  },

  deleteClient: async (id: string): Promise<void> => {
    await api.delete(`/clients/${id}`)
  },

  getClientStats: async (id: string): Promise<{ totalPaid: number; remainingBalance: number; paymentCount: number }> => {
    const res = await api.get<{ data: { totalPaid: number; remainingBalance: number; paymentCount: number } }>(`/clients/${id}/stats`)
    return res.data.data
  },
}
