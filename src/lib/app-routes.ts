export type OptimizeSection = 'overview' | 'plans' | 'config' | 'result' | 'lab'

export const ADMIN_SECTIONS = ['overview', 'features', 'ai', 'content', 'queue', 'items', 'cdk', 'risk', 'registration', 'invitation', 'announcement', 'users', 'feedback', 'audit'] as const
export type AdminSection = typeof ADMIN_SECTIONS[number]

const adminPaths: Record<AdminSection, string> = {
  overview: '/admin/overview',
  features: '/admin/features',
  ai: '/admin/ai',
  content: '/admin/content',
  queue: '/admin/queue',
  items: '/admin/items',
  cdk: '/admin/cdk',
  risk: '/admin/risk',
  registration: '/admin/registration',
  invitation: '/admin/invitations',
  announcement: '/admin/announcements',
  users: '/admin/users',
  feedback: '/admin/feedback',
  audit: '/admin/audit',
}

const standaloneAppPaths = new Set([
  '/',
  '/account-safety',
  '/admin',
  '/admin/setup',
  '/announcements',
  '/cancel-account-deletion',
  '/changelog',
  '/disclaimer',
  '/faq',
  '/login',
  '/register',
  '/forgot-password',
  '/pricing',
  '/privacy',
  '/reset-password',
  '/status',
  '/support',
  '/terms',
  '/thanks',
  '/tool',
  '/tools/depot-value',
  '/tools/manual-schedule',
  '/tools/cultivation-plan',
  '/tools/thanks-recruitment',
  '/tools/training-ratio',
  '/verify-email',
  '/v1',
  '/v2',
  '/v2/benchmarks',
])

const retiredToolPaths = new Set([
  '/tool/profiles', '/tool/commercial', '/tool/tools', '/tool/redeem', '/tool/invitations',
  '/tool/inventory', '/tool/balance', '/tool/announcements', '/tool/settings',
  '/tool/setup/operators', '/tool/setup/config', '/tool/setup/cdk',
  '/tool/optimize/overview', '/tool/optimize/plans', '/tool/optimize/config', '/tool/optimize/result', '/tool/optimize/lab',
])

export function adminPath(section: AdminSection): string {
  return adminPaths[section]
}

export function resolveAdminSection(pathname: string): AdminSection | null {
  return entryForValue(adminPaths, normalizePath(pathname))
}

export function fallbackAdminPath(): string {
  return adminPath('overview')
}

export function isAppRoutePath(pathname: string): boolean {
  const path = normalizePath(pathname)
  return standaloneAppPaths.has(path) || retiredToolPaths.has(path) || resolveAdminSection(path) !== null
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

function entryForValue<Key extends string>(record: Record<Key, string>, value: string): Key | null {
  const entry = (Object.entries(record) as Array<[Key, string]>).find(([, path]) => path === value)
  return entry?.[0] ?? null
}
