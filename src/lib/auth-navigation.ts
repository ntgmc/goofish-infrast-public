import { isAppRoutePath } from './app-routes'
import { V2_GUEST_SECTIONS, v2Section } from '../pages/v2/navigation'

export type AuthMode = 'login' | 'register' | 'forgot'
export const USER_SESSION_EXPIRED_EVENT = 'maatool:user-session-expired'
export const USER_LOGOUT_EVENT = 'maatool:user-logout'
const RETURN_KEY = 'maatool:auth:return'
const paths: Record<AuthMode, string> = { login: '/login', register: '/register', forgot: '/forgot-password' }

export function authModeForPath(pathname: string): AuthMode | null {
  return (Object.keys(paths) as AuthMode[]).find((mode) => paths[mode] === (pathname.replace(/\/+$/, '') || '/')) ?? null
}

export function safeAuthReturn(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/v2'
  const url = new URL(value, 'https://auth.internal')
  if (!isAppRoutePath(url.pathname) || authModeForPath(url.pathname) || /^\/(?:admin|tool(?:\/|$)|v1(?:\/|$)|verify-email|reset-password|cancel-account-deletion)/.test(url.pathname)) return '/v2'
  return `${url.pathname}${url.search}${url.hash}`
}

export function safeAuthBack(value: string | null | undefined): string {
  const url = new URL(safeAuthReturn(value), 'https://auth.internal')
  if (url.pathname === '/account-safety') return '/v2'
  if (url.pathname === '/v2' || url.pathname.startsWith('/v2/')) {
    if (!V2_GUEST_SECTIONS.includes(v2Section(url.searchParams, url.hash, url.pathname))) return '/v2'
    url.searchParams.delete('feedback')
  }
  return `${url.pathname}${url.search}${url.hash}`
}

export function authPath(mode: AuthMode = 'login', returnTo?: string, invite?: string, backTo?: string): string {
  const params = new URLSearchParams()
  if (returnTo) params.set('return_to', safeAuthReturn(returnTo))
  if (invite) params.set('invite', invite)
  if (backTo) params.set('back_to', safeAuthBack(backTo))
  return `${paths[mode]}${params.size ? `?${params}` : ''}`
}

export function rememberAuthReturn(path: string): void {
  try { sessionStorage.setItem(RETURN_KEY, safeAuthReturn(path)) } catch { /* The URL still carries the return path when storage is unavailable. */ }
}

export function readAuthReturn(): string {
  try { return safeAuthReturn(sessionStorage.getItem(RETURN_KEY)) } catch { return '/v2' }
}
