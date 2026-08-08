import { describe, expect, it } from 'vitest'
import {
  ADMIN_SECTIONS,
  DASHBOARD_SECTIONS,
  OPTIMIZE_ROUTE_SECTIONS,
  WORKSPACE_SETUP_SECTIONS,
  adminPath,
  dashboardPath,
  fallbackAdminPath,
  fallbackToolPath,
  isAppRoutePath,
  optimizePath,
  profileScopedPath,
  resolveAdminSection,
  resolveToolRoute,
  workspaceSetupPath,
} from './app-routes'

describe('app route contract', () => {
  it('round-trips every tool section through its semantic URL', () => {
    for (const section of DASHBOARD_SECTIONS) {
      expect(resolveToolRoute(dashboardPath(section))).toEqual({ kind: 'dashboard', section })
    }
    for (const section of WORKSPACE_SETUP_SECTIONS) {
      expect(resolveToolRoute(workspaceSetupPath(section))).toEqual({ kind: 'setup', section })
    }
    for (const section of OPTIMIZE_ROUTE_SECTIONS) {
      expect(resolveToolRoute(optimizePath(section))).toEqual({ kind: 'optimize', section })
    }
  })

  it('round-trips every admin section and preserves the announcements slug mapping', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(resolveAdminSection(adminPath(section))).toBe(section)
    }
    expect(adminPath('announcement')).toBe('/admin/announcements')
    expect(adminPath('queue')).toBe('/admin/queue')
  })

  it('normalizes legacy and invalid tool paths to the nearest group default', () => {
    expect(fallbackToolPath('/tool')).toBe('/tool/profiles')
    expect(fallbackToolPath('/tool/unknown')).toBe('/tool/profiles')
    expect(fallbackToolPath('/tool/setup')).toBe('/tool/setup/operators')
    expect(fallbackToolPath('/tool/setup/unknown')).toBe('/tool/setup/operators')
    expect(fallbackToolPath('/tool/optimize')).toBe('/tool/optimize/overview')
    expect(fallbackToolPath('/tool/optimize/unknown')).toBe('/tool/optimize/overview')
  })

  it('builds profile-scoped paths without dropping existing query parameters', () => {
    expect(profileScopedPath('/tool/profiles')).toBe('/tool/profiles')
    expect(profileScopedPath('/tool/profiles', 'profile 1')).toBe('/tool/profiles?profile_id=profile+1')
    expect(profileScopedPath('/tool/profiles?source=breadcrumb', 'profile-1')).toBe('/tool/profiles?source=breadcrumb&profile_id=profile-1')
  })

  it('normalizes admin paths without treating the standalone setup page as a section', () => {
    expect(fallbackAdminPath()).toBe('/admin/overview')
    expect(resolveAdminSection('/admin')).toBeNull()
    expect(resolveAdminSection('/admin/setup')).toBeNull()
    expect(resolveAdminSection('/admin/unknown')).toBeNull()
  })

  it('accepts trailing slashes without changing the route identity', () => {
    expect(resolveToolRoute('/tool/setup/config/')).toEqual({ kind: 'setup', section: 'config' })
    expect(resolveAdminSection('/admin/users/')).toBe('users')
  })

  it('identifies real client-side routes without accepting similar resource paths', () => {
    expect(isAppRoutePath('/tool/inventory')).toBe(true)
    expect(isAppRoutePath('/tool/inventory/')).toBe(true)
    expect(isAppRoutePath('/announcements')).toBe(true)
    expect(isAppRoutePath('/tools/depot-value')).toBe(true)
    expect(isAppRoutePath('/tool/inventory/export')).toBe(false)
    expect(isAppRoutePath('/api/user/inventory')).toBe(false)
  })
})
