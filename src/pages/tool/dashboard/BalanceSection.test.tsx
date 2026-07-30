// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
}))

vi.mock('../../../lib/api-client', () => ({
  apiJson: mocks.apiJson,
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}))

import BalanceSection from './BalanceSection'

const firstPage = {
  balance: { currency: 'points' as const, available: '12.30' },
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
    await user.click(screen.getByRole('button', { name: '加载更多' }))

    await waitFor(() => expect(mocks.apiJson).toHaveBeenNthCalledWith(2, '/api/user/balance?cursor=next%20page'))
    expect(await screen.findByText('-2.00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
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
    expect(await screen.findByText(/兑换成功：\+10\.00 积分/)).toBeInTheDocument()
    expect(await screen.findByText('22.30')).toBeInTheDocument()

    const redeemCalls = mocks.apiJson.mock.calls.filter(([url]) => url === '/api/user/balance/redeem')
    expect(redeemCalls).toHaveLength(2)
    expect(redeemCalls[0]?.[1]?.json).toEqual({ cdk: 'BALANCE-CODE', idempotency_key: 'balance-request-key' })
    expect(redeemCalls[1]?.[1]?.json).toEqual(redeemCalls[0]?.[1]?.json)
  })
})
