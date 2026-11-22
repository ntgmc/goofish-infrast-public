// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createGainClockPreview, createValueClockPreview } from './value-clock-preview'
import { useGainClockQuery, useValueClockQuery } from './value-clock-query'

const api = vi.hoisted(() => vi.fn())
vi.mock('./api-client', () => ({ apiJson: api }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('isolates local preview data from the public query and reads the API when switched to live', async () => {
  const live = { ...createValueClockPreview(0), series_id: 'production-v1', active_accounts: 1 }
  api.mockResolvedValue(live)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const page = renderHook(({ preview }) => useValueClockQuery(preview), { wrapper, initialProps: { preview: true } })
  try {
    await waitFor(() => expect(page.result.current.data?.snapshot.active_accounts).toBe(905))
    expect(api).not.toHaveBeenCalled()
    page.rerender({ preview: false })
    expect(page.result.current.data).toBeUndefined()
    await waitFor(() => expect(page.result.current.data?.snapshot.active_accounts).toBe(1))
    expect(api).toHaveBeenCalledWith('/api/site/value-clock?view=production', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(client.getQueryData(['public', 'value-clock', 'preview', null, null])).toMatchObject({ snapshot: { active_accounts: 905 } })
    expect(client.getQueryData(['public', 'value-clock', 'production', null, null])).toMatchObject({ snapshot: { active_accounts: 1 } })
  } finally { page.unmount(); client.clear() }
})

it('keeps gain evidence and examples separate from production and rejects the wrong view', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  api.mockResolvedValue(createValueClockPreview(0))
  const page = renderHook(({ preview }) => useGainClockQuery(preview), { wrapper, initialProps: { preview: true } })
  try {
    await waitFor(() => expect(page.result.current.data?.snapshot.view).toBe('gain'))
    expect(api).not.toHaveBeenCalled()
    page.rerender({ preview: false })
    await waitFor(() => expect(page.result.current.isError).toBe(true))
    expect(page.result.current.data).toBeUndefined()
    api.mockResolvedValue(createGainClockPreview(0))
    await act(async () => { await page.result.current.refetch() })
    await waitFor(() => expect(page.result.current.data?.snapshot.comparison.active_comparable_accounts).toBe(714))
    expect(api).toHaveBeenCalledWith('/api/site/value-clock?view=gain', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(client.getQueryData(['public', 'value-clock', 'production', null, null])).toBeUndefined()
    expect(client.getQueryData(['public', 'value-clock', 'gain-preview', null, null])).toBeDefined()
  } finally { page.unmount(); client.clear() }
})
