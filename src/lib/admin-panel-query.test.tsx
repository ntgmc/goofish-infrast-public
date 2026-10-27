// @vitest-environment jsdom
import { useCallback, useState, type ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const createTestQueryClient = () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminQueryScope } from './private-query-scope'
import { useAdminPanelQuery } from './admin-panel-query'
import { useAdminDraftQuery } from './admin-draft-query'

const api = vi.hoisted(() => vi.fn())
vi.mock('./admin-api-client', () => ({ adminApiJson: api }))
beforeEach(() => { api.mockReset() })
afterEach(cleanup)

it('shares reads and retains a local draft until an explicit reload applies the new snapshot', async () => {
  let value = 'first'
  api.mockImplementation(async () => ({ value }))
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AdminQueryScope.Provider value={{ username: 'alice', capabilities: ['admin_manage'], active: true }}>{children}</AdminQueryScope.Provider></QueryClientProvider>
  const hook = renderHook(() => {
    const [draft, setDraft] = useState('')
    const apply = useCallback((data: { value: string }) => setDraft(data.value), [])
    return { query: useAdminDraftQuery('settings', '/settings', apply), draft, setDraft }
  }, { wrapper })
  const other = renderHook(() => useAdminPanelQuery<{ value: string }>('settings', '/settings'), { wrapper })
  await waitFor(() => expect(hook.result.current.draft).toBe('first'))
  expect(api).toHaveBeenCalledTimes(1)
  act(() => hook.result.current.setDraft('editing'))
  value = 'second'
  await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'alice'] }) })
  await waitFor(() => expect(other.result.current.data?.value).toBe('second'))
  expect(hook.result.current.draft).toBe('editing')
  await act(async () => hook.result.current.query.load())
  expect(hook.result.current.draft).toBe('second')
})

it('cancels an old GET before accepting a saved snapshot and does not recreate cleared caches', async () => {
  let resolve!: (data: { revision: number }) => void
  api.mockReturnValue(new Promise((done) => { resolve = done }))
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AdminQueryScope.Provider value={{ username: 'alice', capabilities: ['admin_manage'], active: true }}>{children}</AdminQueryScope.Provider></QueryClientProvider>
  const hook = renderHook(() => useAdminPanelQuery<{ revision: number }>('settings', '/settings'), { wrapper })
  const signal = api.mock.calls[0][1].signal as AbortSignal
  await act(async () => hook.result.current.write({ revision: 2 }))
  await waitFor(() => expect(hook.result.current.data?.revision).toBe(2))
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ revision: 1 }))
  expect(hook.result.current.data?.revision).toBe(2)
  const write = hook.result.current.write
  hook.unmount()
  client.removeQueries({ queryKey: ['admin'] })
  await write({ revision: 3 })
  expect(client.getQueryCache().getAll()).toHaveLength(0)
})

it('isolates administrators and permissions and detaches inactive reads, including manual refresh', async () => {
  let owner = { username: 'alice', capabilities: ['admin_manage'] as ('admin_manage' | 'usage_view')[], active: true }
  let resolve!: (data: { value: string }) => void
  api.mockResolvedValueOnce({ value: 'alice' }).mockReturnValueOnce(new Promise((done) => { resolve = done })).mockResolvedValue({ value: 'bob' })
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AdminQueryScope.Provider value={owner}>{children}</AdminQueryScope.Provider></QueryClientProvider>
  const hook = renderHook(() => useAdminPanelQuery<{ value: string }>('settings', '/settings'), { wrapper })
  await waitFor(() => expect(hook.result.current.data?.value).toBe('alice'))
  const oldRefresh = hook.result.current.refetch
  owner = { ...owner, capabilities: ['usage_view'] }
  hook.rerender()
  expect(hook.result.current.data).toBeUndefined()
  const signal = api.mock.calls[1][1].signal as AbortSignal
  owner = { ...owner, active: false }
  hook.rerender()
  expect(signal.aborted).toBe(true)
  const calls = api.mock.calls.length
  await act(async () => { await hook.result.current.refetch(); await oldRefresh() })
  expect(api).toHaveBeenCalledTimes(calls)
  await act(async () => resolve({ value: 'obsolete' }))
  expect(hook.result.current.data).toBeUndefined()
  owner = { ...owner, username: 'bob', active: true }
  hook.rerender()
  expect(hook.result.current.data).toBeUndefined()
  await waitFor(() => expect(hook.result.current.data?.value).toBe('bob'))
})
