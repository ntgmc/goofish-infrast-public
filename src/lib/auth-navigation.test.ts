// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { authPath, readAuthReturn, rememberAuthReturn, safeAuthBack, safeAuthReturn } from './auth-navigation'

afterEach(() => sessionStorage.clear())

describe('authentication return paths', () => {
  it.each(['https://outside.test', '//outside.test', '/\\outside.test', '/login', '/login/', '/register', '/forgot-password', '/verify-email?token=secret', '/reset-password?token=secret', '/admin/users', '/tool/profiles', '/v1', '/missing', '/v2\n'])('rejects an external, authentication, or unavailable destination: %s', (path) => {
    expect(safeAuthReturn(path)).toBe('/v2')
  })
  it.each(['profiles', 'add-account', 'plans', 'lab', 'skland', 'inventory', 'commercial', 'balance'])('allows cancellation without returning an anonymous user to the protected %s section', (section) => {
    const target = `/v2?section=${section}&profile_id=profile-1`
    expect(safeAuthReturn(target)).toBe(target)
    expect(safeAuthBack(target)).toBe('/v2')
  })
  it('preserves public task context and removes an action that would immediately reopen authentication', () => {
    expect(safeAuthBack('/v2?section=generation')).toBe('/v2?section=generation')
    expect(safeAuthBack('/v2?section=depot&profile_id=profile-1#data')).toBe('/v2?section=depot&profile_id=profile-1#data')
    expect(safeAuthBack('/v2?section=tools&feedback=new')).toBe('/v2?section=tools')
    expect(safeAuthBack('/v2?feedback=new')).toBe('/v2')
    expect(safeAuthBack('//outside.test')).toBe('/v2')
    expect(safeAuthBack('/account-safety')).toBe('/v2')
  })
  it('preserves separate cancellation and completion destinations through every authentication mode', () => {
    for (const mode of ['login', 'register', 'forgot'] as const) {
      const url = new URL(authPath(mode, '/v2?section=generation', undefined, '/v2?section=tools'), 'https://example.test')
      expect(url.searchParams.get('return_to')).toBe('/v2?section=generation')
      expect(url.searchParams.get('back_to')).toBe('/v2?section=tools')
    }
  })
  it('preserves the task, profile, query parameters, and anchor through all authentication modes', () => {
    const target = '/v2?section=add-account&profile_id=profile-1&mode=cdk#redeem'
    for (const mode of ['login', 'register', 'forgot'] as const) {
      const url = new URL(authPath(mode, target, '12AB34CD5E6F7G8H'), 'https://example.test')
      expect(url.searchParams.get('return_to')).toBe(target)
      expect(url.searchParams.get('invite')).toBe('12AB34CD5E6F7G8H')
    }
    rememberAuthReturn(target)
    expect(readAuthReturn()).toBe(target)
    expect(authPath()).toBe('/login')
  })
})
