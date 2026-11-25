import { useMutation, useQuery } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/auth.store'

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: (data) => {
      setAuth(data.token, data.user)
    },
  })
}

export function useRegister() {
  const setAuth = useAuthStore((s) => s.setAuth)
  return useMutation({
    mutationFn: ({ email, name, password }: { email: string; name: string; password: string }) =>
      authApi.register(email, name, password),
    onSuccess: (data) => {
      setAuth(data.token, data.user)
    },
  })
}

export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: ['me'],
    queryFn: authApi.getMe,
    enabled: isAuthenticated,
  })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) => authApi.forgotPassword(email),
  })
}

export function useVerifyOtp() {
  return useMutation({
    mutationFn: ({ email, otp }: { email: string; otp: string }) => authApi.verifyOtp(email, otp),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ resetToken, newPassword }: { resetToken: string; newPassword: string }) =>
      authApi.resetPassword(resetToken, newPassword),
  })
}
