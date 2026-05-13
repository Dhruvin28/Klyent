import { api } from '@/lib/axios'
import type { AuthResponse, User } from '@/types'

export const authApi = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const res = await api.post<AuthResponse>('/auth/login', { email, password })
    return res.data
  },

  register: async (email: string, name: string, password: string): Promise<AuthResponse> => {
    const res = await api.post<AuthResponse>('/auth/register', { email, name, password })
    return res.data
  },

  getMe: async (): Promise<User> => {
    const res = await api.get<User>('/auth/me')
    return res.data
  },
}
