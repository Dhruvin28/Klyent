import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { profileApi } from '@/api/profile'
import { useAuthStore } from '@/store/auth.store'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: profileApi.getMe,
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  const { user, setAuth } = useAuthStore()
  const token = useAuthStore((s) => s.token)
  return useMutation({
    mutationFn: profileApi.updateProfile,
    onSuccess: (updated) => {
      qc.setQueryData(['me'], updated)
      if (token) setAuth(token, updated)
    },
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: profileApi.changePassword,
  })
}
