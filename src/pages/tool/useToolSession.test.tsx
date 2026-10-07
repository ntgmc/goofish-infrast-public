// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSuccessResponse, LicenseConfig } from '../../lib/types'
import { useToolSession } from './useToolSession'

const baseConfig = {
  layout: '2-4-3',
  desc: 'base',
  schedule_mode: 'maa',
  dormitory_rule: 'fixed',
  trading_stations_count: 2,
  manufacturing_stations_count: 4,
  product_requirements: { trading_stations: { gold: 2 }, manufacturing_stations: { gold: 2, exp: 2 } },
} as LicenseConfig

function authPayload(config: LicenseConfig, profileId = 'profile-1'): AuthSuccessResponse {
  return {
    user: { id: 'user-1' },
    profiles: [{ id: profileId, kind: 'cdk' }],
    active_profile: { id: profileId, kind: 'cdk' },
    workspace: { profile_id: profileId, operators: [], config, elite_overrides: {}, saved_configs: [], result_history: [] },
    announcement_unread_count: 0,
  } as unknown as AuthSuccessResponse
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: `auth failure ${status}` }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useToolSession config synchronization', () => {
  beforeEach(() => { vi.useRealTimers(); window.localStorage.clear() })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('restores the last v2 profile before exposing the authenticated workspace and remembers switches', async () => {
    window.localStorage.setItem('maatool:v2:last-profile:user-1', 'profile-2')
    const requestedUrls: string[] = []
    let restore!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { restore = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me?profile_id=profile-2') return pending
      if (url === '/api/auth/me') return jsonResponse(authPayload(baseConfig))
      if (url === '/api/user/workspace?profile_id=profile-3') return jsonResponse(authPayload(baseConfig, 'profile-3'))
      throw new Error(`Unexpected request: ${url}`)
    }))
    const { result, unmount } = renderHook(() => useToolSession(null, true))
    await waitFor(() => expect(requestedUrls).toContain('/api/auth/me?profile_id=profile-2'))
    expect(result.current.authStatus).toBe('loading')
    expect(result.current.activeProfile).toBeNull()
    await act(async () => restore(jsonResponse(authPayload(baseConfig, 'profile-2'))))
    await waitFor(() => expect(result.current.activeProfile?.id).toBe('profile-2'))
    expect(window.localStorage.getItem('maatool:v2:last-profile:user-1')).toBe('profile-2')
    await act(async () => result.current.refreshProfileWorkspace(authPayload(baseConfig, 'profile-3').active_profile!))
    expect(window.localStorage.getItem('maatool:v2:last-profile:user-1')).toBe('profile-3')
    unmount()
  })

  it('ignores an outstanding remembered-profile load after navigating to an explicit profile', async () => {
    window.localStorage.setItem('maatool:v2:last-profile:user-1', 'profile-2')
    let restore!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { restore = resolve })
    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url.endsWith('profile_id=profile-2')) return pending
      return jsonResponse(authPayload(baseConfig, url.includes('profile_id=') ? 'profile-3' : 'profile-1'))
    }))
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useToolSession(id, true), { initialProps: { id: null as string | null } })
    await waitFor(() => expect(requestedUrls).toContain('/api/auth/me?profile_id=profile-2'))
    rerender({ id: 'profile-3' })
    await waitFor(() => expect(result.current.activeProfile?.id).toBe('profile-3'))
    await act(async () => restore(jsonResponse(authPayload(baseConfig, 'profile-2'))))
    expect(result.current.activeProfile?.id).toBe('profile-3')
    expect(window.localStorage.getItem('maatool:v2:last-profile:user-1')).toBe('profile-3')
  })

  it('falls back to an available profile when the remembered profile is archived', async () => {
    window.localStorage.setItem('maatool:v2:last-profile:user-1', 'archived')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      const payload = authPayload(baseConfig, url.endsWith('profile_id=profile-2') ? 'profile-2' : 'profile-1')
      if (url.endsWith('profile_id=archived')) {
        payload.active_profile = { ...payload.active_profile!, id: 'archived', archived_at: '2026-01-01' }
        payload.profiles = [payload.active_profile, authPayload(baseConfig, 'profile-2').active_profile!]
      }
      return jsonResponse(payload)
    }))
    const { result } = renderHook(() => useToolSession(null, true))
    await waitFor(() => expect(result.current.authStatus).toBe('authenticated'))
    expect(result.current.activeProfile?.id).toBe('profile-2')
    expect(window.localStorage.getItem('maatool:v2:last-profile:user-1')).toBe('profile-2')
  })

  it.each(['missing-profile', 'merged-preview'])('replaces a stale v2 preference with the server-selected profile (%s)', async (remembered) => {
    window.localStorage.setItem('maatool:v2:last-profile:user-1', remembered)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/announcement') return new Response(null, { status: 204 })
      return jsonResponse(authPayload(baseConfig, String(input).includes('profile_id=') ? 'profile-2' : 'profile-1'))
    }))
    const { result } = renderHook(() => useToolSession(null, true))
    await waitFor(() => expect(result.current.authStatus).toBe('authenticated'))
    expect(result.current.activeProfile?.id).toBe('profile-2')
    expect(window.localStorage.getItem('maatool:v2:last-profile:user-1')).toBe('profile-2')
  })

  it.each([true, false])('gives a URL profile priority and keeps memory opt-in (%s)', async (remember) => {
    window.localStorage.setItem('maatool:v2:last-profile:user-1', 'profile-2')
    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      if (String(input) === '/api/announcement') return new Response(null, { status: 204 })
      return jsonResponse(authPayload(baseConfig, 'profile-3'))
    }))
    const { result } = renderHook(() => useToolSession('profile-3', remember))
    await waitFor(() => expect(result.current.authStatus).toBe('authenticated'))
    expect(requestedUrls).toEqual(expect.arrayContaining(['/api/auth/me?profile_id=profile-3']))
    expect(requestedUrls).not.toContain('/api/auth/me?profile_id=profile-2')
    expect(window.localStorage.getItem('maatool:v2:last-profile:user-1')).toBe(remember ? 'profile-3' : 'profile-2')
  })

  it('isolates v2 preferences by login account and tolerates unavailable storage', async () => {
    window.localStorage.setItem('maatool:v2:last-profile:other-user', 'foreign-profile')
    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      if (String(input) === '/api/announcement') return new Response(null, { status: 204 })
      return jsonResponse(authPayload(baseConfig))
    }))
    const first = renderHook(() => useToolSession(null, true))
    await waitFor(() => expect(first.result.current.authStatus).toBe('authenticated'))
    expect(requestedUrls).not.toContain('/api/auth/me?profile_id=foreign-profile')
    expect(window.localStorage.getItem('maatool:v2:last-profile:other-user')).toBe('foreign-profile')
    first.unmount()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const second = renderHook(() => useToolSession(null, true))
    await waitFor(() => expect(second.result.current.authStatus).toBe('authenticated'))
    expect(second.result.current.activeProfile?.id).toBe('profile-1')
  })

  it('requests the profile selected by the URL when restoring the session', async () => {
    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me?profile_id=profile-2') return jsonResponse(authPayload(baseConfig, 'profile-2'))
      throw new Error(`Unexpected request: ${url}`)
    }))

    const { result } = renderHook(() => useToolSession('profile-2'))

    await waitFor(() => expect(result.current.authLoading).toBe(false))
    expect(requestedUrls).toContain('/api/auth/me?profile_id=profile-2')
    expect(result.current.activeProfile?.id).toBe('profile-2')
    expect(result.current.authStatus).toBe('authenticated')
  })

  it('treats only a successful null-user response as anonymous', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me') return jsonResponse({
        user: null,
        profiles: [],
        active_profile: null,
        workspace: null,
      })
      throw new Error(`Unexpected request: ${url}`)
    }))

    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authStatus).toBe('anonymous'))
    expect(result.current.authError).toBeNull()
    expect(result.current.user).toBeNull()
  })

  it.each([false, true])('rejects a successful response that omits the user field (restoring: %s)', async (remember) => {
    window.localStorage.setItem('maatool:v2:last-profile:user-1', 'profile-2')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/announcement') return new Response(null, { status: 204 })
      if (remember && String(input) === '/api/auth/me') return jsonResponse(authPayload(baseConfig))
      return jsonResponse({ profiles: [], active_profile: null, workspace: null })
    }))

    const { result } = renderHook(() => useToolSession(null, remember))
    await waitFor(() => expect(result.current.authStatus).toBe('error'))
    expect(result.current.authError).toBeInstanceOf(Error)
    expect(result.current.user).toBeNull()
  })

  it.each([401, 500, 503])('enters auth error for an HTTP %s response', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/announcement') return new Response(null, { status: 204 })
      return errorResponse(status)
    }))

    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authStatus).toBe('error'))
    expect(result.current.authError).toBeInstanceOf(Error)
    expect(result.current.user).toBeNull()
  })

  it('enters auth error for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/announcement') return new Response(null, { status: 204 })
      throw new TypeError('network offline')
    }))

    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authStatus).toBe('error'))
    expect(result.current.authError?.message).toBe('确认登录信息失败')
  })

  it('preserves an authenticated snapshot on failure and restores it after retry', async () => {
    let authRequest = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      authRequest += 1
      if (authRequest === 1) return jsonResponse(authPayload(baseConfig))
      if (authRequest === 2) return errorResponse(503)
      return jsonResponse(authPayload({ ...baseConfig, desc: 'restored' }))
    }))

    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authStatus).toBe('authenticated'))
    const originalUser = result.current.user

    act(() => result.current.retryAuth())
    await waitFor(() => expect(result.current.authStatus).toBe('error'))
    expect(result.current.user).toBe(originalUser)
    expect(result.current.workspace?.config?.desc).toBe('base')

    act(() => result.current.retryAuth())
    await waitFor(() => expect(result.current.authStatus).toBe('authenticated'))
    expect(result.current.authError).toBeNull()
    expect(result.current.workspace?.config?.desc).toBe('restored')
  })

  it('debounces edits and sends only the latest config snapshot', async () => {
    const workspaceRequests: LicenseConfig[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me') return jsonResponse(authPayload(baseConfig))
      const body = JSON.parse(String(init?.body)) as { config: LicenseConfig }
      workspaceRequests.push(body.config)
      return jsonResponse(authPayload(body.config))
    }))

    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authLoading).toBe(false))
    vi.useFakeTimers()
    const first = { ...baseConfig, desc: 'first' }
    const latest = { ...baseConfig, desc: 'latest' }
    act(() => {
      result.current.setConfigOverride(first)
      result.current.setConfigOverride(latest)
      vi.advanceTimersByTime(599)
    })
    expect(workspaceRequests).toHaveLength(0)
    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(workspaceRequests).toEqual([latest])
    expect(result.current.configOverride).toBeNull()
    expect(result.current.configSyncStatus).toBe('idle')
  })

  it.each([false, true])('keeps invalid edits pending and saves after correction (in flight: %s)', async (inFlight) => {
    let resolveFirst!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const workspaceRequests: LicenseConfig[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me') return jsonResponse(authPayload(baseConfig))
      const body = JSON.parse(String(init?.body)) as { config: LicenseConfig }
      workspaceRequests.push(body.config)
      return inFlight && workspaceRequests.length === 1 ? firstResponse : jsonResponse(authPayload(body.config))
    }))

    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authLoading).toBe(false))
    vi.useFakeTimers()
    const first = { ...baseConfig, desc: 'first' }
    if (inFlight) {
      await act(async () => {
        result.current.setConfigOverride(first)
        vi.advanceTimersByTime(600)
      })
      expect(workspaceRequests).toEqual([first])
    }
    const invalid = {
      ...baseConfig,
      product_requirements: { ...baseConfig.product_requirements, manufacturing_stations: { gold: 3, exp: 2 } },
    }
    act(() => result.current.setConfigOverride(invalid))
    await act(async () => {
      vi.advanceTimersByTime(600)
      if (inFlight) resolveFirst(jsonResponse(authPayload(first)))
    })
    let saved: boolean | undefined
    await act(async () => { saved = await result.current.flushConfigSave() })
    expect(saved).toBe(false)
    expect(workspaceRequests).toEqual(inFlight ? [first] : [])
    expect(result.current.configOverride).toEqual(invalid)
    expect(result.current.configSyncStatus).toBe('pending')
    expect(result.current.workspace?.config).toEqual(baseConfig)

    const corrected = { ...baseConfig, desc: 'corrected' }
    await act(async () => {
      result.current.setConfigOverride(corrected)
      vi.advanceTimersByTime(600)
    })
    expect(workspaceRequests).toEqual(inFlight ? [first, corrected] : [corrected])
    expect(result.current.configOverride).toBeNull()
    expect(result.current.configSyncStatus).toBe('idle')
    expect(result.current.workspace?.config).toEqual(corrected)
  })

  it('keeps a newer draft while an older request completes', async () => {
    let resolveFirst!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const workspaceRequests: LicenseConfig[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/announcement') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/auth/me') return Promise.resolve(jsonResponse(authPayload(baseConfig)))
      const body = JSON.parse(String(init?.body)) as { config: LicenseConfig }
      workspaceRequests.push(body.config)
      return workspaceRequests.length === 1 ? firstResponse : Promise.resolve(jsonResponse(authPayload(body.config)))
    }))

    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authLoading).toBe(false))
    vi.useFakeTimers()
    const first = { ...baseConfig, desc: 'first' }
    const latest = { ...baseConfig, desc: 'latest' }
    await act(async () => {
      result.current.setConfigOverride(first)
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })
    act(() => result.current.setConfigOverride(latest))
    await act(async () => {
      resolveFirst(jsonResponse(authPayload(first)))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect((result.current.configOverride ?? result.current.license?.config)?.desc).toBe('latest')
    expect(workspaceRequests).toEqual([first, latest])
  })

  it('preserves pending configuration edits when the same profile data is refreshed', async () => {
    const workspaceRequests: LicenseConfig[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me') return jsonResponse(authPayload(baseConfig))
      const body = JSON.parse(String(init?.body)) as { config: LicenseConfig }
      workspaceRequests.push(body.config)
      return jsonResponse(authPayload(body.config))
    }))
    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authLoading).toBe(false))
    vi.useFakeTimers()
    const latest = { ...baseConfig, desc: 'unsaved edit' }
    act(() => {
      result.current.setConfigOverride(latest)
      result.current.applyAuthPayload(authPayload(baseConfig))
    })
    expect(result.current.configOverride).toEqual(latest)
    expect(result.current.configSyncStatus).toBe('pending')
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(workspaceRequests).toEqual([latest])
    expect(result.current.workspace?.config).toEqual(latest)
    expect(result.current.configSyncStatus).toBe('idle')
  })

  it('keeps configuration edits when a save response omits the user', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me') return jsonResponse(authPayload(baseConfig))
      return jsonResponse({ workspace: { config: baseConfig } })
    }))
    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authLoading).toBe(false))
    vi.useFakeTimers()
    const latest = { ...baseConfig, desc: 'unsaved edit' }
    act(() => { result.current.setConfigOverride(latest) })
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(result.current.configSyncStatus).toBe('failed')
    expect(result.current.configOverride).toEqual(latest)
    expect(result.current.workspace?.config).toEqual(baseConfig)
    let saved: boolean | undefined
    await act(async () => { saved = await result.current.flushConfigSave() })
    expect(saved).toBe(false)
    await act(async () => { await result.current.handleLogout() })
    expect(result.current.user).not.toBeNull()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === '/api/auth/logout')).toBe(false)
  })

  it('waits for the latest in-flight configuration before logging out', async () => {
    let resolveFirst!: (response: Response) => void
    const firstSave = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const requests: string[] = []
    const savedConfigs: LicenseConfig[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me') return jsonResponse(authPayload(baseConfig))
      requests.push(url)
      if (url === '/api/auth/logout') return new Response(null, { status: 204 })
      const body = JSON.parse(String(init?.body)) as { config: LicenseConfig }
      savedConfigs.push(body.config)
      return savedConfigs.length === 1 ? firstSave : jsonResponse(authPayload(body.config))
    }))
    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authLoading).toBe(false))
    vi.useFakeTimers()
    const first = { ...baseConfig, desc: 'first' }
    const latest = { ...baseConfig, desc: 'latest' }
    act(() => { result.current.setConfigOverride(first) })
    let flush!: Promise<boolean>
    await act(async () => {
      flush = result.current.flushConfigSave()
      await Promise.resolve()
    })
    act(() => { result.current.setConfigOverride(latest) })
    let logout!: Promise<void>
    await act(async () => {
      logout = result.current.handleLogout()
      await Promise.resolve()
    })
    expect(requests).toEqual(['/api/user/workspace'])
    await act(async () => {
      resolveFirst(jsonResponse(authPayload(first)))
      await logout
    })
    expect(await flush).toBe(true)
    expect(savedConfigs).toEqual([first, latest])
    expect(requests).toEqual(['/api/user/workspace', '/api/user/workspace', '/api/auth/logout'])
    expect(result.current.user).toBeNull()
  })

  it('ignores a workspace mutation response after switching profiles', async () => {
    let resolveWorkspacePatch!: (response: Response) => void
    const delayedWorkspacePatch = new Promise<Response>((resolve) => { resolveWorkspacePatch = resolve })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/announcement') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/auth/me?profile_id=profile-1') return Promise.resolve(jsonResponse(authPayload(baseConfig, 'profile-1')))
      if (url === '/api/auth/me?profile_id=profile-2') return Promise.resolve(jsonResponse(authPayload({ ...baseConfig, desc: 'profile-2' }, 'profile-2')))
      if (url === '/api/user/workspace') return delayedWorkspacePatch
      throw new Error(`Unexpected request: ${url}`)
    }))

    const { result, rerender } = renderHook(
      ({ profileId }) => useToolSession(profileId),
      { initialProps: { profileId: 'profile-1' } },
    )
    await waitFor(() => expect(result.current.activeProfile?.id).toBe('profile-1'))
    let mutation!: Promise<AuthSuccessResponse | void>
    act(() => {
      mutation = result.current.persistWorkspacePatch({ elite_overrides: {} })
    })

    rerender({ profileId: 'profile-2' })
    await waitFor(() => expect(result.current.activeProfile?.id).toBe('profile-2'))
    await act(async () => {
      resolveWorkspacePatch(jsonResponse(authPayload({ ...baseConfig, desc: 'late-profile-1' }, 'profile-1')))
      await mutation
    })

    expect(result.current.activeProfile?.id).toBe('profile-2')
    expect(result.current.workspace?.config?.desc).toBe('profile-2')
  })

})

describe('useToolSession profile navigation', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('retains pending configuration when navigation adds the already loaded profile to the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url.startsWith('/api/auth/me')) return jsonResponse(authPayload(baseConfig))
      throw new Error(`Unexpected request: ${url}`)
    }))
    const { result, rerender } = renderHook(({ profileId }) => useToolSession(profileId), { initialProps: { profileId: null as string | null } })
    await waitFor(() => expect(result.current.authStatus).toBe('authenticated'))
    vi.useFakeTimers()
    const edited = { ...baseConfig, desc: 'pending changes' }
    act(() => result.current.setConfigOverride(edited))
    rerender({ profileId: 'profile-1' })
    expect(result.current.authStatus).toBe('authenticated')
    expect(result.current.configOverride).toEqual(edited)
    expect(result.current.configSyncStatus).toBe('pending')
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/auth/me'))).toHaveLength(1)
    act(() => result.current.retryAuth())
    await act(async () => { await Promise.resolve() })
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/auth/me'))).toHaveLength(2)
  })
})
