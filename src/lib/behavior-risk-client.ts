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
