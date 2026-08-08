// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

import BalanceSection from './BalanceSection'
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
    mocks.apiJson.mockRejectedValueOnce(new Error('积分服务不可用'))

    const user = userEvent.setup()
    render(<BalanceSection redemptionEnabled />)

    expect(await screen.findByRole('alert')).toHaveTextContent('积分服务不可用')
    expect(screen.queryByText('0.00')).not.toBeInTheDocument()
    expect(screen.queryByText('暂无积分变动记录。')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.apiJson).toHaveBeenCalledTimes(2)
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
    expect(screen.getByText('+12.30')).toBeInTheDocument()
    expect(screen.getByText('12000')).toBeInTheDocument()
    expect(screen.getByText('1200 积分/成功主排班')).toBeInTheDocument()
    expect(screen.getByText('Lv1 · 1350 积分/成功主排班')).toBeInTheDocument()
    expect(screen.getByText('还差 38000 积分（门槛 50000）')).toBeInTheDocument()
    expect(screen.queryByText(/\.00/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '加载更多' }))

    await waitFor(() => expect(mocks.apiJson).toHaveBeenNthCalledWith(2, '/api/user/balance?cursor=next%20page'))
    expect(await screen.findByText('-2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
  })

  it('shows pending recovery only when the account has debt', async () => {
    mocks.apiJson.mockResolvedValueOnce({ ...firstPage, next_cursor: null })

    const { unmount } = render(<BalanceSection redemptionEnabled />)

    await screen.findByText('12.30')
    expect(screen.queryByText('待追偿')).not.toBeInTheDocument()
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

    expect(await screen.findByText('待追偿')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Lv1 · 已暂停，待追偿 25 积分')).toBeInTheDocument()
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
    const input = screen.getByPlaceholderText('输入余额 CDK')
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

    await user.type(screen.getByPlaceholderText('输入余额 CDK'), 'account-code')
    await user.click(screen.getByRole('button', { name: '确认兑换' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('该 CDK 应在账号兑换页使用')
    expect(screen.getByRole('link', { name: '前往账号兑换页' })).toHaveAttribute('href', '/tool/redeem')
  })
})
