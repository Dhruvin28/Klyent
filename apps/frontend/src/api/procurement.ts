import { api, publicApi } from '@/lib/axios'
import type {
  Vendor,
  VendorProduct,
  VendorProductPrice,
  ProcurementItem,
  ProcurementItemDetail,
  ProcurementQuote,
  ProcurementSummary,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderSummary,
  PaginatedResponse,
} from '@/types'

export interface VendorData {
  name: string
  phone?: string | null
  email?: string | null
  gstin?: string | null
  address?: string | null
  category?: string | null
  notes?: string | null
}

export interface ProductData {
  vendorId: string
  name: string
  brand?: string | null
  sku?: string | null
  category?: string | null
  unit: string
  price: number
  gstRate: number
  hsnCode?: string | null
  description?: string | null
  leadTimeDays?: number | null
  minOrderQty?: number | null
  isActive?: boolean
}

export interface ProductImportRow {
  vendorName: string
  name: string
  brand?: string | null
  sku?: string | null
  category?: string | null
  unit?: string | null
  price: number
  gstRate?: number | null
  hsnCode?: string | null
  leadTimeDays?: number | null
}

export interface ProductImportResult {
  created: number
  updated: number
  unchanged: number
  vendorsCreated: number
}

export interface ItemData {
  projectId?: string | null
  title: string
  category?: string | null
  specification?: string | null
  quantity: number
  unit: string
  clientRate?: number | null
  neededBy?: string | null
  notes?: string | null
}

export interface QuoteData {
  productId?: string | null
  vendorId?: string | null
  vendorName?: string | null
  price?: number
  unit?: string | null
  gstRate?: number | null
  leadTimeDays?: number | null
  validTill?: string | null
  notes?: string | null
}

export interface OrderData {
  poNumber: string
  poDate: string
  expectedDelivery?: string | null
  projectId?: string | null
  vendorId: string
  deliveryAddress?: string | null
  placeOfSupplyCode?: string | null
  placeOfSupplyName?: string | null
  lineItems: Omit<PurchaseOrderLine, 'receivedQuantity'>[]
  notes?: string | null
  termsAndConditions?: string[] | null
  status?: 'DRAFT' | 'SENT' | 'CANCELLED'
}

export interface OrderParams {
  status?: string
  projectId?: string
  vendorId?: string
  page?: number
  limit?: number
}

export interface OrderListResult extends PaginatedResponse<PurchaseOrder> {
  summary: PurchaseOrderSummary
}

interface BackendPaginated<T> {
  data: T[]
  summary: PurchaseOrderSummary
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export const procurementApi = {
  // ── Vendors ──
  getVendors: async (q?: string): Promise<Vendor[]> => {
    const res = await api.get<{ data: Vendor[] }>('/procurement/vendors', { params: { q: q || undefined } })
    return res.data.data
  },
  createVendor: async (data: VendorData): Promise<Vendor> => {
    const res = await api.post<{ data: Vendor }>('/procurement/vendors', data)
    return res.data.data
  },
  updateVendor: async (id: string, data: Partial<VendorData>): Promise<Vendor> => {
    const res = await api.patch<{ data: Vendor }>(`/procurement/vendors/${id}`, data)
    return res.data.data
  },
  deleteVendor: async (id: string): Promise<void> => {
    await api.delete(`/procurement/vendors/${id}`)
  },

  // ── Catalog ──
  getProducts: async (params?: { q?: string; vendorId?: string; category?: string; includeInactive?: boolean }): Promise<VendorProduct[]> => {
    const res = await api.get<{ data: VendorProduct[] }>('/procurement/products', {
      params: {
        q: params?.q || undefined,
        vendorId: params?.vendorId || undefined,
        category: params?.category || undefined,
        includeInactive: params?.includeInactive ? 'true' : undefined,
      },
    })
    return res.data.data
  },
  getCategories: async (): Promise<string[]> => {
    const res = await api.get<{ data: string[] }>('/procurement/products/categories')
    return res.data.data
  },
  getProductPrices: async (id: string): Promise<VendorProductPrice[]> => {
    const res = await api.get<{ data: VendorProductPrice[] }>(`/procurement/products/${id}/prices`)
    return res.data.data
  },
  createProduct: async (data: ProductData): Promise<VendorProduct> => {
    const res = await api.post<{ data: VendorProduct }>('/procurement/products', data)
    return res.data.data
  },
  updateProduct: async (id: string, data: Partial<ProductData>): Promise<VendorProduct> => {
    const res = await api.patch<{ data: VendorProduct }>(`/procurement/products/${id}`, data)
    return res.data.data
  },
  deleteProduct: async (id: string): Promise<void> => {
    await api.delete(`/procurement/products/${id}`)
  },
  importProducts: async (rows: ProductImportRow[]): Promise<ProductImportResult> => {
    const res = await api.post<{ data: ProductImportResult }>('/procurement/products/import', { rows })
    return res.data.data
  },

  // ── Requirements & quotes ──
  getItems: async (params?: { projectId?: string; status?: string; ids?: string[] }): Promise<ProcurementItem[]> => {
    const res = await api.get<{ data: ProcurementItem[] }>('/procurement/items', {
      params: {
        projectId: params?.projectId || undefined,
        status: params?.status || undefined,
        ids: params?.ids?.length ? params.ids.join(',') : undefined,
      },
    })
    return res.data.data
  },
  getItem: async (id: string): Promise<ProcurementItemDetail> => {
    const res = await api.get<{ data: ProcurementItemDetail }>(`/procurement/items/${id}`)
    return res.data.data
  },
  createItem: async (data: ItemData): Promise<ProcurementItemDetail> => {
    const res = await api.post<{ data: ProcurementItemDetail }>('/procurement/items', data)
    return res.data.data
  },
  updateItem: async (id: string, data: Partial<ItemData> & { status?: 'cancelled' | 'open' }): Promise<ProcurementItemDetail> => {
    const res = await api.patch<{ data: ProcurementItemDetail }>(`/procurement/items/${id}`, data)
    return res.data.data
  },
  deleteItem: async (id: string): Promise<void> => {
    await api.delete(`/procurement/items/${id}`)
  },
  addQuote: async (itemId: string, data: QuoteData): Promise<ProcurementItemDetail> => {
    const res = await api.post<{ data: ProcurementItemDetail }>(`/procurement/items/${itemId}/quotes`, data)
    return res.data.data
  },
  updateQuote: async (quoteId: string, data: Partial<QuoteData> & { status?: 'quoted' | 'revised' | 'rejected' }): Promise<void> => {
    await api.patch(`/procurement/items/quotes/${quoteId}`, data)
  },
  deleteQuote: async (quoteId: string): Promise<void> => {
    await api.delete(`/procurement/items/quotes/${quoteId}`)
  },
  approveQuote: async (itemId: string, quoteId: string): Promise<ProcurementItemDetail> => {
    const res = await api.post<{ data: ProcurementItemDetail }>(`/procurement/items/${itemId}/approve`, { quoteId })
    return res.data.data
  },
  unapproveQuote: async (itemId: string): Promise<ProcurementItemDetail> => {
    const res = await api.post<{ data: ProcurementItemDetail }>(`/procurement/items/${itemId}/unapprove`)
    return res.data.data
  },
  getUnlinkedQuotes: async (projectId?: string | null): Promise<ProcurementQuote[]> => {
    const res = await api.get<{ data: ProcurementQuote[] }>('/procurement/items/unlinked-quotes', {
      params: { projectId: projectId || undefined },
    })
    return res.data.data
  },
  linkQuotes: async (itemId: string, quoteIds: string[]): Promise<ProcurementItemDetail> => {
    const res = await api.post<{ data: ProcurementItemDetail }>(`/procurement/items/${itemId}/link-quotes`, { quoteIds })
    return res.data.data
  },

  getSummary: async (projectId?: string): Promise<ProcurementSummary> => {
    const res = await api.get<{ data: ProcurementSummary }>('/procurement/summary', { params: { projectId: projectId || undefined } })
    return res.data.data
  },

  // ── Purchase orders ──
  getOrders: async (params?: OrderParams): Promise<OrderListResult> => {
    const res = await api.get<BackendPaginated<PurchaseOrder>>('/procurement/orders', {
      params: {
        status: params?.status || undefined,
        projectId: params?.projectId || undefined,
        vendorId: params?.vendorId || undefined,
        page: params?.page,
        limit: params?.limit,
      },
    })
    return {
      data: res.data.data,
      summary: res.data.summary,
      page: res.data.pagination.page,
      limit: res.data.pagination.limit,
      total: res.data.pagination.total,
      totalPages: res.data.pagination.totalPages,
    }
  },
  getOrder: async (id: string): Promise<PurchaseOrder> => {
    const res = await api.get<{ data: PurchaseOrder }>(`/procurement/orders/${id}`)
    return res.data.data
  },
  getOrderByToken: async (token: string): Promise<PurchaseOrder> => {
    const res = await publicApi.get<{ data: PurchaseOrder }>(`/procurement/orders/share/${token}`)
    return res.data.data
  },
  acknowledgeOrder: async (token: string): Promise<string> => {
    const res = await publicApi.post<{ data: { vendorAcknowledgedAt: string } }>(`/procurement/orders/share/${token}/acknowledge`)
    return res.data.data.vendorAcknowledgedAt
  },
  getNextOrderNumber: async (): Promise<string> => {
    const res = await api.get<{ data: { poNumber: string } }>('/procurement/orders/next-number')
    return res.data.data.poNumber
  },
  createOrder: async (data: OrderData): Promise<PurchaseOrder> => {
    const res = await api.post<{ data: PurchaseOrder }>('/procurement/orders', data)
    return res.data.data
  },
  updateOrder: async (id: string, data: Partial<OrderData>): Promise<PurchaseOrder> => {
    const res = await api.patch<{ data: PurchaseOrder }>(`/procurement/orders/${id}`, data)
    return res.data.data
  },
  receiveOrder: async (id: string, lines: { id: string; receivedQuantity: number }[]): Promise<PurchaseOrder> => {
    const res = await api.patch<{ data: PurchaseOrder }>(`/procurement/orders/${id}/receive`, { lines })
    return res.data.data
  },
  recordOrderPayment: async (id: string, amountPaid: number): Promise<PurchaseOrder> => {
    const res = await api.patch<{ data: PurchaseOrder }>(`/procurement/orders/${id}/payment`, { amountPaid })
    return res.data.data
  },
  deleteOrder: async (id: string): Promise<void> => {
    await api.delete(`/procurement/orders/${id}`)
  },
  shareOrder: async (id: string): Promise<string> => {
    const res = await api.post<{ data: { shareToken: string } }>(`/procurement/orders/${id}/share`)
    return res.data.data.shareToken
  },
}

// API errors carry a readable `error` message; fall back to a generic one.
export function apiErrorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback
}
