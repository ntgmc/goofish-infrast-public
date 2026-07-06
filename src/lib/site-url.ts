export function getCurrentSiteUrl(): string {
  if (typeof window === 'undefined' || !window.location.origin) return '/'
  return `${window.location.origin}/`
}
