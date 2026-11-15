// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { authPath, readAuthReturn, rememberAuthReturn, safeAuthReturn } from './auth-navigation'

afterEach(() => sessionStorage.clear())

describe('authentication return paths', () => {
  it.each(['https://outside.test', '//outside.test', '/\\outside.test', '/login', '/login/', '/register', '/forgot-password', '/verify-email?token=secret', '/reset-password?token=secret', '/admin/users', '/tool/profiles', '/v1', '/missing', '/v2\n'])('rejects an external, authentication, or unavailable destination: %s', (path) => {
    expect(safeAuthReturn(path)).toBe('/v2')
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
