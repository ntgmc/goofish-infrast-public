export const DASHBOARD_SECTIONS = ['profiles', 'tools', 'redeem', 'announcements', 'settings'] as const
export type DashboardSection = typeof DASHBOARD_SECTIONS[number]

export const WORKSPACE_SETUP_SECTIONS = ['operators', 'config', 'cdk'] as const
export type WorkspaceSetupSection = typeof WORKSPACE_SETUP_SECTIONS[number]

export const OPTIMIZE_ROUTE_SECTIONS = ['overview', 'plans', 'config', 'result', 'lab'] as const
export type OptimizeSection = typeof OPTIMIZE_ROUTE_SECTIONS[number]

export const ADMIN_SECTIONS = ['overview', 'cdk', 'risk', 'announcement', 'users'] as const
export type AdminSection = typeof ADMIN_SECTIONS[number]

export type ToolRoute =
  | { kind: 'dashboard'; section: DashboardSection }
  | { kind: 'setup'; section: WorkspaceSetupSection }
  | { kind: 'optimize'; section: OptimizeSection }

const dashboardPaths: Record<DashboardSection, string> = {
  profiles: '/tool/profiles',
  tools: '/tool/tools',
  redeem: '/tool/redeem',
  announcements: '/tool/announcements',
  settings: '/tool/settings',
}

const setupPaths: Record<WorkspaceSetupSection, string> = {
  operators: '/tool/setup/operators',
  config: '/tool/setup/config',
  cdk: '/tool/setup/cdk',
}

const optimizePaths: Record<OptimizeSection, string> = {
  overview: '/tool/optimize/overview',
  plans: '/tool/optimize/plans',
  config: '/tool/optimize/config',
  result: '/tool/optimize/result',
  lab: '/tool/optimize/lab',
}

const adminPaths: Record<AdminSection, string> = {
  overview: '/admin/overview',
  cdk: '/admin/cdk',
  risk: '/admin/risk',
  announcement: '/admin/announcements',
  users: '/admin/users',
}

export function dashboardPath(section: DashboardSection): string {
  return dashboardPaths[section]
}

export function workspaceSetupPath(section: WorkspaceSetupSection): string {
  return setupPaths[section]
}

export function optimizePath(section: OptimizeSection): string {
  return optimizePaths[section]
}

export function adminPath(section: AdminSection): string {
  return adminPaths[section]
}

export function resolveToolRoute(pathname: string): ToolRoute | null {
  const path = normalizePath(pathname)
  const dashboardSection = entryForValue(dashboardPaths, path)
  if (dashboardSection) return { kind: 'dashboard', section: dashboardSection }

  const setupSection = entryForValue(setupPaths, path)
  if (setupSection) return { kind: 'setup', section: setupSection }

  const optimizeSection = entryForValue(optimizePaths, path)
  if (optimizeSection) return { kind: 'optimize', section: optimizeSection }

  return null
}

export function fallbackToolPath(pathname: string): string {
  const path = normalizePath(pathname)
  if (path === '/tool/setup' || path.startsWith('/tool/setup/')) return workspaceSetupPath('operators')
  if (path === '/tool/optimize' || path.startsWith('/tool/optimize/')) return optimizePath('overview')
  return dashboardPath('profiles')
}

export function resolveAdminSection(pathname: string): AdminSection | null {
  return entryForValue(adminPaths, normalizePath(pathname))
}

export function fallbackAdminPath(): string {
  return adminPath('overview')
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

function entryForValue<Key extends string>(record: Record<Key, string>, value: string): Key | null {
  const entry = (Object.entries(record) as Array<[Key, string]>).find(([, path]) => path === value)
  return entry?.[0] ?? null
}
