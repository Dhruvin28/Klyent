import { api } from '@/lib/axios'
import type { DashboardStats, BusinessReport } from '@/types'

export const dashboardApi = {
  getDashboardStats: async (): Promise<DashboardStats> => {
    const res = await api.get<{ data: DashboardStats }>('/dashboard/stats')
    return res.data.data
  },

  // Full export dataset for the business report PDF.
  getBusinessReport: async (): Promise<BusinessReport> => {
    const res = await api.get<{ data: BusinessReport }>('/dashboard/report')
    return res.data.data
  },
}
