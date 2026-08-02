// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpgradeSuggestion, UpgradeTrainingCostBucket } from '../lib/types'
import UpgradeSuggestions from './UpgradeSuggestions'

const emptyBucket = (): UpgradeTrainingCostBucket => ({
  cash: 0,
  exp: 0,
  materials: [],
  equivalent_sanity: 0,
})

afterEach(cleanup)

describe('UpgradeSuggestions', () => {
  it('shows partial warnings and never labels incomplete costs as stocked', async () => {
    const user = userEvent.setup()
    renderComponent([suggestion('upgrade-a', '干员 A', true)])

    const card = screen.getByRole('article')
    expect(within(card).getAllByText('成本不完整')).toHaveLength(2)
    expect(within(card).queryByText('材料已够')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看解释' }))
    expect(screen.getByText('目标干员数据不完整。')).toBeInTheDocument()
    expect(screen.getByText(/未定价材料：测试材料/)).toBeInTheDocument()
    expect(screen.getByText(/价格来源：stale/)).toBeInTheDocument()
  })

  it('prunes selected and expanded ids when suggestions are replaced', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const { rerender } = render(<UpgradeSuggestions {...props} suggestions={[suggestion('upgrade-a', '干员 A')]} />)

    await user.click(screen.getByRole('checkbox', { name: '选择 干员 A' }))
    await user.click(screen.getByRole('button', { name: '查看解释' }))
    expect(screen.getByRole('button', { name: /应用建议/ })).toBeEnabled()

    rerender(<UpgradeSuggestions {...props} suggestions={[suggestion('upgrade-b', '干员 B')]} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /应用建议/ })).toBeDisabled())
    expect(screen.getByRole('checkbox', { name: '选择 干员 B' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '查看解释' })).toHaveAttribute('aria-expanded', 'false')
  })
})

function renderComponent(suggestions: UpgradeSuggestion[]) {
  return render(<UpgradeSuggestions {...baseProps()} suggestions={suggestions} />)
}

function baseProps() {
  return {
    onApply: vi.fn(),
    loading: false,
    onReset: vi.fn(),
  }
}

function suggestion(id: string, name: string, partial = false): UpgradeSuggestion {
  return {
    suggestion_id: id,
    type: 'single',
    id: `char-${id}`,
    name,
    current: 0,
    target: 1,
    gain: 0.1,
    training_cost: partial ? {
      status: 'partial',
      totals: emptyBucket(),
      available: emptyBucket(),
      missing: emptyBucket(),
      equivalent_sanity: null,
      unpriced_items: [{ id: 'material-1', name: '测试材料', count: 1 }],
      sources: {
        skland: 'ok',
        yituliu: 'stale',
        pricing_snapshot_id: 'snapshot-1',
        pricing_fetched_at: '2026-07-31T00:00:00.000Z',
        pricing_age_ms: 1,
        valuation_version: 'depot-v2:test:snapshot-1',
        lmd_exp: 'fixed_lmd_trade_gold_net_exp_36_per_10000',
      },
      warnings: ['目标干员数据不完整。'],
      operators: [{
        status: 'unavailable',
        error_code: 'operator_not_found',
        id: `char-${id}`,
        name,
        current_elite: 0,
        target_elite: 1,
        current_level: 1,
        target_level: 1,
        totals: emptyBucket(),
        missing: emptyBucket(),
        warnings: ['目标干员数据不完整。'],
      }],
    } : undefined,
  }
}
