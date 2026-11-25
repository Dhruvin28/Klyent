import { useQuery, useQueryClient } from '@tanstack/react-query'
import { procurementApi, type OrderParams } from '@/api/procurement'

// Everything under ['procurement'] is invalidated together after a write:
// approving a quote or receiving goods changes items, orders and the summary.
export function useInvalidateProcurement() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['procurement'] })
}

export function useVendors(q?: string) {
  return useQuery({ queryKey: ['procurement', 'vendors', q ?? ''], queryFn: () => procurementApi.getVendors(q) })
}

export function useProducts(params: { q?: string; vendorId?: string; category?: string; includeInactive?: boolean }, enabled = true) {
  return useQuery({
    queryKey: ['procurement', 'products', params],
    queryFn: () => procurementApi.getProducts(params),
    enabled,
  })
}

export function useProductCategories() {
  return useQuery({ queryKey: ['procurement', 'categories'], queryFn: procurementApi.getCategories })
}

export function useProductPrices(id: string | null) {
  return useQuery({
    queryKey: ['procurement', 'product-prices', id],
    queryFn: () => procurementApi.getProductPrices(id!),
    enabled: !!id,
  })
}

export function useProcurementItems(params: { projectId?: string; status?: string; ids?: string[] }, enabled = true) {
  return useQuery({
    queryKey: ['procurement', 'items', params],
    queryFn: () => procurementApi.getItems(params),
    enabled,
  })
}

export function useProcurementItem(id?: string) {
  return useQuery({
    queryKey: ['procurement', 'item', id],
    queryFn: () => procurementApi.getItem(id!),
    enabled: !!id,
  })
}

export function useUnlinkedQuotes(projectId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['procurement', 'unlinked-quotes', projectId ?? ''],
    queryFn: () => procurementApi.getUnlinkedQuotes(projectId),
    enabled,
  })
}

export function useProcurementSummary(projectId?: string) {
  return useQuery({
    queryKey: ['procurement', 'summary', projectId ?? ''],
    queryFn: () => procurementApi.getSummary(projectId),
  })
}

export function usePurchaseOrders(params: OrderParams) {
  return useQuery({ queryKey: ['procurement', 'orders', params], queryFn: () => procurementApi.getOrders(params) })
}

export function usePurchaseOrder(id?: string | null) {
  return useQuery({
    queryKey: ['procurement', 'order', id],
    queryFn: () => procurementApi.getOrder(id!),
    enabled: !!id,
  })
}
