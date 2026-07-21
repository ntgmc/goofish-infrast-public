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
})
