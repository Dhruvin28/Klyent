import { api } from '@/lib/axios'
import type { User } from '@/types'

export interface UpdateProfileData {
  name: string
  email: string
  companyName?: string | null
  companyPhone?: string | null
  companyAddress?: string | null
  companyWebsite?: string | null
  companyGstin?: string | null
}

export const profileApi = {
  getMe: async (): Promise<User> => {
    const res = await api.get<{ user: User }>('/auth/me')
    return res.data.user
  },

  updateProfile: async (data: UpdateProfileData): Promise<User> => {
    const res = await api.patch<{ user: User }>('/auth/me', data)
    return res.data.user
  },

  uploadLogo: async (file: File): Promise<User> => {
    const fd = new FormData()
    fd.append('logo', file)
    const res = await api.post<{ user: User }>('/auth/me/logo', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data.user
  },

  changePassword: async (data: { currentPassword: string; newPassword: string }): Promise<void> => {
    await api.patch('/auth/me/password', data)
  },
}
