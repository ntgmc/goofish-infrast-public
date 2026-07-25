export const BEHAVIOR_RISK_BROWSER_HEADER = 'X-Maa-Behavior-Instance'
const STORAGE_KEY = 'maa:behavior-instance:v1'

export type BehaviorRiskPageCategory =
  | 'landing'
  | 'auth'
  | 'profiles'
  | 'workspace'
  | 'optimizer'
  | 'result'
  | 'account'
  | 'public_info'
  | 'other'

let memoryInstanceId: string | null = null

export function getBehaviorRiskBrowserInstance(): string | null {
  if (memoryInstanceId) return memoryInstanceId
  if (typeof window === 'undefined' || !window.crypto) return null
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) {
      memoryInstanceId = existing
      return existing
    }
    const created = window.crypto.randomUUID()
    window.localStorage.setItem(STORAGE_KEY, created)
    memoryInstanceId = created
    return created
  } catch {
    try {
      memoryInstanceId = window.crypto.randomUUID()
      return memoryInstanceId
    } catch {
      return null
    }
  }
}

export function categorizeBehaviorRiskPath(pathname: string): BehaviorRiskPageCategory {
  if (pathname === '/') return 'landing'
  if (pathname.startsWith('/tool/profiles')) return 'profiles'
  if (pathname.startsWith('/tool/setup')) return 'workspace'
  if (pathname.startsWith('/tool/optimize/result')) return 'result'
  if (pathname.startsWith('/tool/optimize')) return 'optimizer'
  if (pathname.startsWith('/tool/account') || pathname === '/account-safety') return 'account'
  if (pathname.startsWith('/tool')) return 'workspace'
  if (pathname === '/reset-password' || pathname === '/verify-email' || pathname === '/cancel-account-deletion') return 'auth'
  if (['/privacy', '/terms', '/disclaimer', '/faq', '/support', '/pricing', '/changelog', '/announcements'].includes(pathname)) return 'public_info'
  return 'other'
}
