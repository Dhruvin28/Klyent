import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { fetchLogoAsDataUrl } from '@/lib/logoProxy'

export function useLogoDataUrl() {
  const logoUrl = useAuthStore((s) => s.user?.companyLogoUrl)
  const { data = null } = useQuery({
    queryKey: ['logo-data-url', logoUrl],
    queryFn: () => fetchLogoAsDataUrl(logoUrl),
    enabled: !!logoUrl,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return data
}
