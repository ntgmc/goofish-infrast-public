// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAdminDetailQuery } from './useAdminDetailQuery'

afterEach(cleanup)

it('cancels an obsolete selection and isolates the next administrator', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  let finish!: (data: { id: string }) => void
  const read = vi.fn((id: string, _signal: AbortSignal) => id === 'first' ? new Promise<{ id: string }>((resolve) => { finish = resolve }) : Promise.resolve({ id }))
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(({ username }) => useAdminDetailQuery({ username, capabilities: ['user_view'], active: true, name: 'user', read, identify: (data: { id: string }) => data.id }), { wrapper, initialProps: { username: 'alice' } })
  let first!: Promise<unknown>
  act(() => { first = hook.result.current.load('first') })
  const signal = read.mock.calls[0][1]
  await act(async () => { await hook.result.current.load('second') })
  await waitFor(() => expect(hook.result.current.data?.id).toBe('second'))
  expect(signal.aborted).toBe(true)
  await act(async () => { finish({ id: 'first' }); expect(await first).toBeNull() })
  expect(hook.result.current.data?.id).toBe('second')
  hook.rerender({ username: 'bob' })
  expect(hook.result.current.data).toBeNull()
  await waitFor(() => expect(hook.result.current.data?.id).toBe('second'))
  expect(client.getQueryCache().findAll({ queryKey: ['admin', 'bob'] }).length).toBeGreaterThan(0)
  hook.unmount(); client.clear()
})

it('does not recreate cleared private details through a late mutation callback or refresh', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  const read = vi.fn(async (id: string) => ({ id }))
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useAdminDetailQuery({ username: 'alice', capabilities: ['user_view'], active: true, name: 'user', read, identify: (data: { id: string }) => data.id }), { wrapper })
  await act(async () => { await hook.result.current.load('first') })
  await waitFor(() => expect(hook.result.current.data?.id).toBe('first'))
  const { setData, load } = hook.result.current
  hook.unmount(); client.clear()
  setData({ id: 'first' })
  expect(await load('second')).toBeNull()
  expect(client.getQueryCache().getAll()).toHaveLength(0)
  expect(read).toHaveBeenCalledTimes(1)
})
