import { api } from '@/lib/axios'
import type { DashboardStats } from '@/types'

export const dashboardApi = {
  getDashboardStats: async (): Promise<DashboardStats> => {
    const res = await api.get<{ data: DashboardStats }>('/dashboard/stats')
    return res.data.data
  },
}
