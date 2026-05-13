import { api } from '@/lib/axios'
import type { Payment, PaginatedResponse } from '@/types'

export interface PaymentParams {
  clientId?: string
  method?: string
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface CreatePaymentData {
  clientId: string
  amount: number
  method: 'CASH' | 'ONLINE' | 'CHEQUE'
  date: string
  notes?: string
}

interface BackendPaginated<T> {
  data: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  summary?: { totalAmount: number }
}

export const paymentsApi = {
  getPayments: async (params?: PaymentParams): Promise<PaginatedResponse<Payment> & { totalAmount: number }> => {
    const res = await api.get<BackendPaginated<Payment>>('/payments', { params })
    return {
      data: res.data.data,
      page: res.data.pagination.page,
      limit: res.data.pagination.limit,
      total: res.data.pagination.total,
      totalPages: res.data.pagination.totalPages,
      totalAmount: res.data.summary?.totalAmount ?? 0,
    }
  },

  createPayment: async (data: CreatePaymentData): Promise<Payment> => {
    const res = await api.post<{ data: Payment }>('/payments', data)
    return res.data.data
  },

  updatePayment: async (id: string, data: Partial<CreatePaymentData>): Promise<Payment> => {
    const res = await api.patch<{ data: Payment }>(`/payments/${id}`, data)
    return res.data.data
  },

  deletePayment: async (id: string): Promise<void> => {
    await api.delete(`/payments/${id}`)
  },
}
