import { QueryClient, QueryObserver, isCancelledError } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspaceResultHistoryItem } from '../../../lib/types'
import { fetchCachedResultHistoryDetail, resultHistoryKey } from './result-history-query'
import { fetchResultHistoryDetail } from './optimization-api'

const item = { id: 'result-1', name: 'Saved schedule' } as WorkspaceResultHistoryItem
const clients: QueryClient[] = []

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: Infinity } } })
  clients.push(client)
  let finish!: (response: Response) => void
  let signal!: AbortSignal
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal!
    return new Promise<Response>((resolve, reject) => {
      finish = resolve
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  vi.stubGlobal('fetch', fetch)
  return { client, fetch, signal: () => signal, finish: () => finish(Response.json({ item })) }
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it('keeps a shared history read alive when the page that started it leaves during a profile switch', async () => {
  const { client, fetch, signal, finish } = setup()
  const key = [...resultHistoryKey('user-1', 'profile-1'), 'detail', item.id]
  const page = new QueryObserver(client, { queryKey: key,
    queryFn: ({ signal }) => fetchResultHistoryDetail('profile-1', item.id, signal) })
  const leavePage = page.subscribe(() => undefined)
  const pending = fetchCachedResultHistoryDetail(client, 'user-1', 'profile-1', item.id)
  const outcome = pending.then((value) => value, (error: unknown) => error)
  leavePage()
  const aborted = signal().aborted
  finish()
  expect(await outcome).toEqual(item)
  expect(aborted).toBe(false)
  expect(fetch).toHaveBeenCalledOnce()
  expect(client.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(0)
})

it('cancels an imperative history read when the user cache is removed without recreating it', async () => {
  const { client, signal } = setup()
  const outcome = fetchCachedResultHistoryDetail(client, 'user-1', 'profile-1', item.id).catch((error: unknown) => error)
  client.removeQueries({ queryKey: ['user', 'user-1'] })
  expect(isCancelledError(await outcome)).toBe(true)
  expect(signal().aborted).toBe(true)
  expect(client.getQueryCache().findAll({ queryKey: ['user', 'user-1'] })).toHaveLength(0)
})

it('releases its subscription after a failed read and allows an explicit retry', async () => {
  const { client, fetch } = setup()
  const key = [...resultHistoryKey('user-1', 'profile-1'), 'detail', item.id]
  fetch.mockImplementationOnce(async () => Response.json({ error: 'Saved schedule unavailable' }, { status: 503 }))
  await expect(fetchCachedResultHistoryDetail(client, 'user-1', 'profile-1', item.id)).rejects.toThrow('Saved schedule unavailable')
  expect(client.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(0)
  fetch.mockImplementationOnce(async () => Response.json({ item }))
  await expect(fetchCachedResultHistoryDetail(client, 'user-1', 'profile-1', item.id)).resolves.toEqual(item)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('reuses fresh history details without starting another request', async () => {
  const { client, fetch } = setup()
  const key = [...resultHistoryKey('user-1', 'profile-1'), 'detail', item.id]
  client.setQueryData(key, item)
  await expect(fetchCachedResultHistoryDetail(client, 'user-1', 'profile-1', item.id)).resolves.toEqual(item)
  expect(fetch).not.toHaveBeenCalled()
  expect(client.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(0)
})
