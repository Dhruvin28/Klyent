import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/api/dashboard'

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.getDashboardStats,
  })
}
