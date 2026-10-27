// @vitest-environment jsdom
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, screen, waitFor } from '../../../test/query-render'
import type { BalancePage } from '../../../lib/balance-contracts'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
}))

vi.mock('../../../lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly data: unknown) { super(message) }
  },
  apiJson: mocks.apiJson,
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}))

import BalanceSectionView, { useBalance } from './BalanceSection'

function BalanceSection({ redemptionEnabled }: { redemptionEnabled: boolean }) {
  return <BalanceSectionView userId="user" activeProfileId="profile-1" redemptionEnabled={redemptionEnabled} />
}
import { ApiError } from '../../../lib/api-client'

const firstPage = {
  balance: {
    currency: 'points' as const,
    available: '12.30',
    reserved: '0.00',
    lifetime_credited: '12000.00',
    qualification_reversed: '0.00',
    debt: '0.00',
    commercial: {
      eligible: true,
      level: 1 as const,
      threshold_points: '10000.00',
      discount_bps: 9000,
      charge_points: '1350.00',
      next_threshold_points: '50000.00',
      points_to_next_level: '38000.00',
    },
  },
  transactions: [{
    id: 'tx-1',
    kind: 'cdk_credit' as const,
    amount: '12.30',
    balance_after: '12.30',
    created_at: '2026-07-29T01:00:00.000Z',
  }],
  next_cursor: 'next page',
  as_of: '2026-07-29T01:00:00.000Z',
}

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'balance-request-key') })
  mocks.apiJson.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BalanceSection', () => {
  it('shows a dedicated retry state instead of zero assets when the initial load fails', async () => {
    mocks.apiJson.mockRejectedValueOnce(new Error('积分服务不可用')).mockResolvedValueOnce({ ...firstPage, next_cursor: null })

    const user = userEvent.setup()
    render(<BalanceSection redemptionEnabled />)

    expect(await screen.findByRole('alert')).toHaveTextContent('积分服务不可用')
    expect(screen.queryByText('0.00')).not.toBeInTheDocument()
    expect(screen.queryByText('暂无积分变动记录。')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.apiJson).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('12.30')).toBeInTheDocument()
  })

  it('loads the balance and appends cursor-paginated transactions', async () => {
    mocks.apiJson
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({
        balance: firstPage.balance,
        transactions: [{
          id: 'tx-2',
          kind: 'admin_debit' as const,
          amount: '-2.00',
          balance_after: '10.30',
          created_at: '2026-07-28T01:00:00.000Z',
        }],
        next_cursor: null,
      })

    const user = userEvent.setup()
    render(<BalanceSection redemptionEnabled />)

    expect(await screen.findByText('12.30')).toBeInTheDocument()
    const historyToggle = screen.getByText('积分明细').closest('summary')!
    const history = historyToggle.closest('details')!
    expect(history).not.toHaveAttribute('open')
    await user.click(historyToggle)
    expect(history).toHaveAttribute('open')
    expect(screen.getByText('+12.30')).toBeInTheDocument()
    expect(screen.getByText('12000')).toBeInTheDocument()
    expect(screen.getByText('1000 积分/每次成功生成')).toBeInTheDocument()
    expect(screen.getByText('Lv1 · 1350 积分/每次成功生成')).toBeInTheDocument()
    expect(screen.getByText('还差 38000 积分（门槛 50000）')).toBeInTheDocument()
    expect(screen.queryByText(/\.00/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看更多记录' }))

    await waitFor(() => expect(mocks.apiJson).toHaveBeenNthCalledWith(2, '/api/user/balance?cursor=next%20page', expect.objectContaining({ signal: expect.any(AbortSignal) })))
    expect(await screen.findByText('-2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看更多记录' })).not.toBeInTheDocument()
    expect(history).toHaveAttribute('open')
    await user.click(historyToggle)
    expect(history).not.toHaveAttribute('open')
  })

  it('shows pending recovery only when the account has debt', async () => {
    mocks.apiJson.mockResolvedValueOnce({ ...firstPage, next_cursor: null })

    const { unmount } = render(<BalanceSection redemptionEnabled />)

    await screen.findByText('12.30')
    expect(screen.queryByText('待补扣积分')).not.toBeInTheDocument()
    unmount()

    mocks.apiJson.mockResolvedValueOnce({
      ...firstPage,
      balance: {
        ...firstPage.balance,
        debt: '25.00',
        commercial: { ...firstPage.balance.commercial, eligible: false },
      },
      next_cursor: null,
    })
    render(<BalanceSection redemptionEnabled />)

    expect(await screen.findByText('待补扣积分')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Lv1 · 已暂停，待补扣 25 积分')).toBeInTheDocument()
  })

  it('reuses the idempotency key after an unknown result and refreshes after success', async () => {
    mocks.apiJson
      .mockResolvedValueOnce({ ...firstPage, next_cursor: null })
      .mockRejectedValueOnce(new Error('网络结果未知'))
      .mockResolvedValueOnce({
        balance: { currency: 'points', available: '22.30' },
        transaction: { id: 'tx-2', kind: 'cdk_credit', amount: '10.00', balance_after: '22.30', created_at: '2026-07-29T02:00:00.000Z' },
        cdk: { cdk_type: 'balance', amount: '10.00' },
        replayed: true,
      })
      .mockResolvedValueOnce({
        balance: { currency: 'points', available: '22.30' },
        transactions: [],
        next_cursor: null,
      })

    const user = userEvent.setup()
    render(<BalanceSection redemptionEnabled />)
    await screen.findByText('+12.30')
    const input = screen.getByPlaceholderText('输入积分 CDK')
    await user.type(input, 'balance-code')
    await user.click(screen.getByRole('button', { name: '确认兑换' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络结果未知')

    await user.click(screen.getByRole('button', { name: '确认兑换' }))
    expect(await screen.findByText(/兑换成功：\+10 积分/)).toBeInTheDocument()
    expect(await screen.findByText('22.30')).toBeInTheDocument()

    const redeemCalls = mocks.apiJson.mock.calls.filter(([url]) => url === '/api/user/balance/redeem')
    expect(redeemCalls).toHaveLength(2)
    expect(redeemCalls[0]?.[1]?.json).toEqual({ cdk: 'BALANCE-CODE', idempotency_key: 'balance-request-key' })
    expect(redeemCalls[1]?.[1]?.json).toEqual(redeemCalls[0]?.[1]?.json)
  })

  it('keeps the successful redemption notice when the following balance refresh fails', async () => {
    mocks.apiJson
      .mockResolvedValueOnce({ ...firstPage, next_cursor: null })
      .mockResolvedValueOnce({ cdk: { amount: '10.00' } })
      .mockRejectedValueOnce(new Error('账单刷新失败'))
    const user = userEvent.setup()
    render(<BalanceSection redemptionEnabled />)
    await screen.findByText('+12.30')
    await user.type(screen.getByPlaceholderText('输入积分 CDK'), 'balance-code')
    await user.click(screen.getByRole('button', { name: '确认兑换' }))
    expect(await screen.findByText(/兑换成功：\+10 积分/)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('账单刷新失败')
    expect(mocks.apiJson.mock.calls.filter(([url]) => url === '/api/user/balance/redeem')).toHaveLength(1)
    expect(screen.getByPlaceholderText('输入积分 CDK')).toHaveValue('')
  })

  it('shows only the allowlisted account redemption target for a mismatched CDK', async () => {
    mocks.apiJson
      .mockResolvedValueOnce({ ...firstPage, next_cursor: null })
      .mockRejectedValueOnce(new ApiError(
        '该 CDK 应在账号兑换页使用',
        409,
        { code: 'cdk_type_mismatch', target: '/tool/redeem' },
        '/api/user/balance/redeem',
      ))
    const user = userEvent.setup()
    render(<BalanceSection redemptionEnabled />)
    await screen.findByText('+12.30')

    await user.type(screen.getByPlaceholderText('输入积分 CDK'), 'account-code')
    await user.click(screen.getByRole('button', { name: '确认兑换' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('该 CDK 应在账号兑换页使用')
    expect(screen.getByRole('link', { name: '前往账号兑换页' })).toHaveAttribute('href', '/tool/redeem')
  })
})

describe('balance query lifecycle', () => {
  it('deduplicates ledger pages and refreshes them using the latest cursors', async () => {
    const older = { ...firstPage.transactions[0], id: 'tx-older' }
    mocks.apiJson
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({ ...firstPage, transactions: [firstPage.transactions[0], older], next_cursor: null })
      .mockResolvedValueOnce({ ...firstPage, next_cursor: 'new cursor' })
      .mockResolvedValueOnce({ ...firstPage, balance: { ...firstPage.balance, available: '22.30' }, transactions: [older], next_cursor: null })
    const { result } = renderHook(() => useBalance('user', 'profile-1'))
    await waitFor(() => expect(result.current.page).not.toBeNull())
    await act(async () => { await result.current.loadMore() })
    await waitFor(() => expect(result.current.page?.transactions).toHaveLength(2))
    await act(async () => { await result.current.load() })
    await waitFor(() => expect(result.current.page?.balance.available).toBe('22.30'))
    expect(mocks.apiJson.mock.calls.map(([url]) => url)).toEqual([
      '/api/user/balance', '/api/user/balance?cursor=next%20page', '/api/user/balance', '/api/user/balance?cursor=new%20cursor',
    ])
  })

  it('cancels obsolete user and profile reads and discards their late responses', async () => {
    const requests: Array<{ signal: AbortSignal; finish: (value: BalancePage) => void }> = []
    mocks.apiJson.mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((resolve) => {
      requests.push({ signal: init.signal, finish: resolve })
    }))
    const { result, rerender } = renderHook(({ userId, profileId }) => useBalance(userId, profileId), {
      initialProps: { userId: 'user-a', profileId: 'profile-1' },
    })
    rerender({ userId: 'user-a', profileId: 'profile-2' })
    expect(requests[0].signal.aborted).toBe(true)
    expect(result.current.page).toBeNull()
    rerender({ userId: 'user-b', profileId: 'profile-2' })
    expect(requests[1].signal.aborted).toBe(true)
    await act(async () => {
      requests[0].finish(firstPage)
      requests[1].finish(firstPage)
      requests[2].finish({ ...firstPage, balance: { ...firstPage.balance, available: '99.00' } })
    })
    await waitFor(() => expect(result.current.page?.balance.available).toBe('99.00'))
  })

  it('reads a fresh balance when revisiting a cached profile and invalidates all profile balances after redemption', async () => {
    mocks.apiJson.mockResolvedValue({ ...firstPage, next_cursor: null })
    const { result, rerender } = renderHook(({ profileId }) => ({
      balance: useBalance('user', profileId), client: useQueryClient(),
    }), { initialProps: { profileId: 'profile-1' } })
    await waitFor(() => expect(result.current.balance.page).not.toBeNull())
    rerender({ profileId: 'profile-2' })
    await waitFor(() => expect(result.current.balance.page).not.toBeNull())
    rerender({ profileId: 'profile-1' })
    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledTimes(3))
    act(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledTimes(4))
    mocks.apiJson.mockImplementation(async (_url: string, init?: { method?: string }) => init?.method === 'POST'
      ? { cdk: { amount: '10.00' } }
      : { ...firstPage, balance: { ...firstPage.balance, available: '22.30' }, next_cursor: null })
    act(() => result.current.balance.setCdk('balance-code'))
    await act(async () => { await result.current.balance.redeem({ preventDefault: vi.fn() } as unknown as FormEvent) })
    await waitFor(() => expect(result.current.balance.page?.balance.available).toBe('22.30'))
    expect(result.current.client.getQueryState(['user', 'user', 'profile-2', 'balance'])?.isInvalidated).toBe(true)
  })
})
