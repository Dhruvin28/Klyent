const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

export async function fetchLogoAsDataUrl(logoUrl: string | null | undefined): Promise<string | null> {
  if (!logoUrl) return null
  const match = logoUrl.match(/logos\/[^?#]+/)
  if (!match) return logoUrl
  const key = match[0]
  try {
    const res = await fetch(`${API_BASE}/auth/logo-proxy?key=${encodeURIComponent(key)}`)
    if (!res.ok) return logoUrl
    const blob = await res.blob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(logoUrl)
      reader.readAsDataURL(blob)
    })
  } catch {
    return logoUrl
  }
}
