import { api, publicApi } from '@/lib/axios'
import type { Invoice, InvoiceLineItem, InvoiceStatus, InvoiceSummary, PaginatedResponse } from '@/types'

export interface InvoiceParams {
  status?: string
  clientId?: string
  page?: number
  limit?: number
}

export interface CreateInvoiceData {
  invoiceNumber: string
  invoiceDate: string
  dueDate: string

  clientId?: string | null
  clientName: string
  clientPhone?: string | null
  clientEmail?: string | null
  clientAddress?: string | null
  clientGstin?: string | null

  supplierStateCode?: string | null
  supplierStateName?: string | null
  placeOfSupplyCode?: string | null
  placeOfSupplyName?: string | null

  lineItems: InvoiceLineItem[]

  amountPaid?: number
  notes?: string | null
  termsAndConditions?: string[] | null
  bankName?: string | null
  bankAccountName?: string | null
  bankAccountNumber?: string | null
  bankIfsc?: string | null
  upiId?: string | null

  status?: InvoiceStatus
}

interface BackendPaginated<T> {
  data: T[]
  summary: InvoiceSummary
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export interface InvoiceListResult extends PaginatedResponse<Invoice> {
  summary: InvoiceSummary
}

export const invoicesApi = {
  getInvoices: async (params?: InvoiceParams): Promise<InvoiceListResult> => {
    const res = await api.get<BackendPaginated<Invoice>>('/invoices', { params })
    return {
      data: res.data.data,
      summary: res.data.summary,
      page: res.data.pagination.page,
      limit: res.data.pagination.limit,
      total: res.data.pagination.total,
      totalPages: res.data.pagination.totalPages,
    }
  },

  getInvoice: async (id: string): Promise<Invoice> => {
    const res = await api.get<{ data: Invoice }>(`/invoices/${id}`)
    return res.data.data
  },

  getInvoiceByToken: async (token: string): Promise<Invoice> => {
    const res = await publicApi.get<{ data: Invoice }>(`/invoices/share/${token}`)
    return res.data.data
  },

  // Next number in the current financial year's series, e.g. INV/25-26/004.
  getNextNumber: async (): Promise<string> => {
    const res = await api.get<{ data: { invoiceNumber: string } }>('/invoices/next-number')
    return res.data.data.invoiceNumber
  },

  createInvoice: async (data: CreateInvoiceData): Promise<Invoice> => {
    const res = await api.post<{ data: Invoice }>('/invoices', data)
    return res.data.data
  },

  updateInvoice: async (id: string, data: Partial<CreateInvoiceData>): Promise<Invoice> => {
    const res = await api.patch<{ data: Invoice }>(`/invoices/${id}`, data)
    return res.data.data
  },

  // Record how much has been received against this invoice. Status follows:
  // 0 => SENT, part => PART_PAID, full => PAID.
  recordPayment: async (id: string, amountPaid: number): Promise<Invoice> => {
    const res = await api.patch<{ data: Invoice }>(`/invoices/${id}/payment`, { amountPaid })
    return res.data.data
  },

  deleteInvoice: async (id: string): Promise<void> => {
    await api.delete(`/invoices/${id}`)
  },

  generateShareToken: async (id: string): Promise<string> => {
    const res = await api.post<{ data: { shareToken: string } }>(`/invoices/${id}/share`)
    return res.data.data.shareToken
  },
}
