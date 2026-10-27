// @vitest-environment jsdom
import { useQueryClient } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '../test/query-render'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiJson, apiVoid } from './api-client'
import { useInventoryQuery } from './inventory-query'
import type { AuthSuccessResponse } from './types'
import type { InventoryResponse } from './inventory-contracts'
import { useToolSession } from '../pages/tool/useToolSession'

vi.mock('./api-client', () => ({ apiJson: vi.fn(), apiJsonOrNull: vi.fn(), apiVoid: vi.fn() }))

afterEach(() => { cleanup(); vi.resetAllMocks() })

const inventory: InventoryResponse = { stacks: [], capacities: [], recent_events: [] }
const auth = { user: { id: 'user-a' }, profiles: [], active_profile: null, workspace: null } as unknown as AuthSuccessResponse

describe('private query lifecycle', () => {
  it('shares an inventory request between consumers and reuses its fresh result', async () => {
    vi.mocked(apiJson).mockResolvedValue(inventory)
    const { result, rerender } = renderHook(() => ({
      first: useInventoryQuery('user-a', 'profile-a'),
      second: useInventoryQuery('user-a', 'profile-a'),
    }))
    await waitFor(() => expect(result.current.first.data).toEqual(inventory))
    expect(result.current.second.data).toBe(result.current.first.data)
    expect(apiJson).toHaveBeenCalledTimes(1)
    rerender()
    expect(apiJson).toHaveBeenCalledTimes(1)
  })

  it('isolates both user and profile changes and discards late responses even if the transport ignores cancellation', async () => {
    const requests: Array<{ signal?: AbortSignal | null; finish: (value: InventoryResponse) => void }> = []
    vi.mocked(apiJson).mockImplementation((_url, options) => new Promise((resolve) => {
      requests.push({ signal: options?.signal, finish: resolve })
    }))
    const { result, rerender } = renderHook(({ userId, profileId }) => ({
      query: useInventoryQuery(userId, profileId),
      client: useQueryClient(),
    }), { initialProps: { userId: 'user-a', profileId: 'profile-a' } })
    rerender({ userId: 'user-a', profileId: 'profile-b' })
    expect(requests[0].signal?.aborted).toBe(true)
    expect(result.current.query.data).toBeUndefined()
    rerender({ userId: 'user-b', profileId: 'profile-b' })
    expect(requests[1].signal?.aborted).toBe(true)
    await act(async () => {
      requests[0].finish(inventory)
      requests[1].finish(inventory)
      requests[2].finish({ ...inventory, capacities: [] })
    })
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
    expect(result.current.client.getQueryData(['user', 'user-a', 'profile-a', 'inventory'])).toBeUndefined()
    expect(result.current.client.getQueryData(['user', 'user-a', 'profile-b', 'inventory'])).toBeUndefined()
  })

  it('keeps the current user cache during workspace updates and clears it on account changes and logout', async () => {
    vi.mocked(apiJson).mockResolvedValue(auth)
    vi.mocked(apiVoid).mockResolvedValue(undefined)
    const { result } = renderHook(() => ({
      session: useToolSession(null, false, false),
      client: useQueryClient(),
    }))
    await waitFor(() => expect(result.current.session.user?.id).toBe('user-a'))
    const key = ['user', 'user-a', 'profile-a', 'inventory']
    result.current.client.setQueryData(key, inventory)
    act(() => result.current.session.applyAuthPayload(auth))
    expect(result.current.client.getQueryData(key)).toEqual(inventory)
    act(() => result.current.session.applyAuthPayload({ ...auth, user: { ...auth.user, id: 'user-b' } }))
    expect(result.current.client.getQueryData(key)).toBeUndefined()

    const pendingKey = ['user', 'user-b', 'profile-b', 'inventory']
    let finish!: (value: InventoryResponse) => void
    let signal!: AbortSignal
    const pending = result.current.client.fetchQuery({
      queryKey: pendingKey,
      queryFn: (context) => {
        signal = context.signal
        return new Promise<InventoryResponse>((resolve) => { finish = resolve })
      },
    }).catch(() => undefined)
    result.current.client.setQueryData(['admin', 'operator', 'users'], ['separate-session'])
    await act(async () => { await result.current.session.handleLogout() })
    expect(signal.aborted).toBe(true)
    expect(result.current.client.getQueryCache().findAll({ queryKey: ['user'] })).toHaveLength(0)
    await act(async () => { finish(inventory); await pending })
    expect(result.current.client.getQueryData(pendingKey)).toBeUndefined()
    expect(result.current.client.getQueryData(['admin', 'operator', 'users'])).toEqual(['separate-session'])
  })
})
