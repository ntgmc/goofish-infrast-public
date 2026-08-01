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
  beforeEach(() => vi.useRealTimers())
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
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

  it('rejects a successful response that omits the user field', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/announcement') return new Response(null, { status: 204 })
      return jsonResponse({ profiles: [], active_profile: null, workspace: null })
    }))

    const { result } = renderHook(() => useToolSession())
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
    expect(result.current.authError?.message).toContain('network offline')
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

  it('keeps an elite override draft and rejects when persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/announcement') return new Response(null, { status: 204 })
      if (url === '/api/auth/me') return jsonResponse(authPayload(baseConfig))
      if (url === '/api/user/workspace') return errorResponse(500)
      throw new Error(`Unexpected request: ${url}`)
    }))

    const { result } = renderHook(() => useToolSession())
    await waitFor(() => expect(result.current.authStatus).toBe('authenticated'))
    let save!: Promise<void>
    act(() => {
      save = result.current.setEliteOverrides({ char_001: 2 })
    })

    await expect(save).rejects.toThrow('auth failure 500')
    expect(result.current.eliteOverrides).toEqual({ char_001: 2 })
  })
})
