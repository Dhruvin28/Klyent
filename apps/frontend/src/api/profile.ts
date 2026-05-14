import { api } from '@/lib/axios'
import type { User } from '@/types'

export const profileApi = {
  getMe: async (): Promise<User> => {
    const res = await api.get<{ user: User }>('/auth/me')
    return res.data.user
  },

  updateProfile: async (data: { name: string; email: string }): Promise<User> => {
    const res = await api.patch<{ user: User }>('/auth/me', data)
    return res.data.user
  },

  changePassword: async (data: { currentPassword: string; newPassword: string }): Promise<void> => {
    await api.patch('/auth/me/password', data)
  },
}
