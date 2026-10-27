// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '../../../test/query-render'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAdminUserBalance } from './balance-actions'
import type { BalancePage, AdminBalanceTransaction } from '../../../lib/balance-contracts'

const api = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: api }))
vi.mock('../../../lib/site-features', () => ({ METERED_BILLING_AVAILABLE: true }))
beforeEach(() => { api.mockReset() })
afterEach(cleanup)
const page = { balance: { available: '12.00' }, transactions: [], next_cursor: null, as_of: '2026-10-27T00:00:00Z' } as unknown as BalancePage<AdminBalanceTransaction>
const callbacks = () => ({ setBusyAction: vi.fn(), setError: vi.fn(), setNotice: vi.fn(), refreshUsers: vi.fn().mockResolvedValue(undefined) })

it('keeps a successful adjustment separate from failed reads and never repeats the adjustment on a read retry', async () => {
  let written = false
  api.mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') { written = true; return {} }
    if (written) throw new Error('read failed')
    return page
  })
  const effects = callbacks()
  const hook = renderHook(() => useAdminUserBalance({ username: 'alice', capabilities: ['user_manage'], userId: 'user-1', active: true, ...effects }))
  await waitFor(() => expect(hook.result.current.balance?.balance.available).toBe('12.00'))
  await act(async () => { expect(await hook.result.current.handleAdjustUserBalance('credit', '1.00', 'audit reason', 'same-key', 'root-secret')).toBe(true) })
  expect(effects.setNotice).toHaveBeenCalledWith('已增加 1.00 积分')
  expect(effects.setError).toHaveBeenLastCalledWith('积分调整已成功，数据刷新失败，请手动刷新。')
  expect(hook.result.current.balance?.balance.available).toBe('12.00')
  hook.unmount()
  const next = renderHook(() => useAdminUserBalance({ username: 'alice', capabilities: ['user_manage'], userId: 'user-1', active: true, ...effects }))
  await waitFor(() => expect(next.result.current.error).not.toBeNull())
  expect(api.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
})

it('does not apply an old adjustment result to the next selected user', async () => {
  let finish!: (value: unknown) => void
  api.mockImplementation((_url, init) => init?.method === 'POST' ? new Promise((resolve) => { finish = resolve }) : Promise.resolve(page))
  const effects = callbacks()
  const hook = renderHook(({ id }) => useAdminUserBalance({ username: 'alice', capabilities: ['user_manage'], userId: id, active: true, ...effects }), { initialProps: { id: 'first' } })
  await waitFor(() => expect(hook.result.current.balance).not.toBeNull())
  let write!: Promise<boolean>
  act(() => { write = hook.result.current.handleAdjustUserBalance('credit', '1.00', 'audit reason', 'same-key', 'root-secret') })
  hook.rerender({ id: 'second' })
  expect(hook.result.current.balance).toBeNull()
  await act(async () => { finish({}); expect(await write).toBe(true) })
  expect(effects.setNotice).toHaveBeenCalledTimes(1)
  expect(effects.setNotice).toHaveBeenCalledWith(null)
  expect(effects.refreshUsers).not.toHaveBeenCalled()
  const release = effects.setBusyAction.mock.lastCall![0]
  expect(release('user-balance:first')).toBeNull()
  expect(release('another-operation')).toBe('another-operation')
})
