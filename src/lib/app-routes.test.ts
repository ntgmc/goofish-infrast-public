import { describe, expect, it } from 'vitest'
import {
  ADMIN_SECTIONS,
  adminPath,
  fallbackAdminPath,
  isAppRoutePath,
  resolveAdminSection,
} from './app-routes'

describe('app route contract', () => {
  it('round-trips every admin section and preserves the announcements slug mapping', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(resolveAdminSection(adminPath(section))).toBe(section)
    }
    expect(adminPath('announcement')).toBe('/admin/announcements')
    expect(adminPath('queue')).toBe('/admin/queue')
  })

  it('normalizes admin paths without treating the standalone setup page as a section', () => {
    expect(fallbackAdminPath()).toBe('/admin/overview')
    expect(resolveAdminSection('/admin')).toBeNull()
    expect(resolveAdminSection('/admin/setup')).toBeNull()
    expect(resolveAdminSection('/admin/unknown')).toBeNull()
  })

  it('accepts trailing slashes without changing the route identity', () => {
    expect(resolveAdminSection('/admin/users/')).toBe('users')
  })

  it('identifies real client-side routes without accepting similar resource paths', () => {
    expect(isAppRoutePath('/tool/inventory')).toBe(true)
    expect(isAppRoutePath('/tool/inventory/')).toBe(true)
    expect(isAppRoutePath('/announcements')).toBe(true)
    expect(isAppRoutePath('/tools/depot-value')).toBe(true)
    expect(isAppRoutePath('/tools/manual-schedule')).toBe(true)
    expect(isAppRoutePath('/tools/thanks-recruitment')).toBe(true)
    expect(isAppRoutePath('/v1')).toBe(true)
    expect(isAppRoutePath('/v1/')).toBe(true)
    expect(isAppRoutePath('/v2')).toBe(true)
    expect(isAppRoutePath('/v2/')).toBe(true)
    expect(isAppRoutePath('/v2/benchmarks')).toBe(true)
    expect(isAppRoutePath('/v2/benchmarks/')).toBe(true)
    expect(isAppRoutePath('/tool/inventory/export')).toBe(false)
    expect(isAppRoutePath('/api/user/inventory')).toBe(false)
    expect(isAppRoutePath('/v1/not-a-page')).toBe(false)
    expect(isAppRoutePath('/v2/not-a-page')).toBe(false)
  })
})
