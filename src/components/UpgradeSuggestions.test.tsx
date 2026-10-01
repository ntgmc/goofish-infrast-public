// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { UpgradeSuggestion, UpgradeTrainingCost, UpgradeTrainingCostBucket } from '../lib/types'
import UpgradeSuggestions from './UpgradeSuggestions'

const emptyBucket = (): UpgradeTrainingCostBucket => ({
  cash: 0,
  exp: 0,
  materials: [],
  equivalent_sanity: 0,
})

afterEach(cleanup)

describe('UpgradeSuggestions', () => {
  it.each([
    ['available', 1727, 18.9, '约 91.4 天'],
    ['available', 0, 18.9, '0 天'],
    ['partial', 0, 18.9, '暂不可算'],
    ['unavailable', 0, 18.9, '暂不可算'],
    ['available', null, 18.9, '暂不可算'],
    ['available', -1, 18.9, '暂不可算'],
    ['available', 1727, 0, '暂不可算'],
    ['available', 1727, -1, '暂不可算'],
    ['available', 1727, null, '暂不可算'],
    ['available', 1727, Number.POSITIVE_INFINITY, '暂不可算'],
  ] as const)('recalculates payback for %s costs, %s missing sanity and %s daily gain', (status, missing, gain, expected) => {
    const item = paybackSuggestion('巫恋 + 柏喙 + 龙舌兰', missing, gain)
    item.training_cost!.status = status
    renderComponent([item])
    const metric = screen.getByText('预计回本').parentElement!
    expect(within(metric).getByText(expected)).toBeInTheDocument()
  })

  it('sorts by recalculated payback instead of stale optimizer values', async () => {
    const user = userEvent.setup()
    const slow = paybackSuggestion('慢回本', 100, 10)
    const fast = paybackSuggestion('快回本', 100, 20)
    fast.roi!.payback_days = 99
    renderComponent([slow, fast])
    expect(within(screen.getAllByRole('article')[0]).getByText('快回本')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '材料已够' }))
    expect(within(screen.getAllByRole('article')[0]).getByText('快回本')).toBeInTheDocument()
  })

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

  it('renders suggestions without selection or apply controls', () => {
    renderComponent([suggestion('upgrade-a', '干员 A')])

    expect(screen.queryByRole('checkbox', { name: '选择 干员 A' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /应用建议/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '只看单人提升' })).toBeInTheDocument()
  })

  it('distinguishes craftable materials from remaining shortages', () => {
    const base = suggestion('upgrade-a', '干员 A')
    const material = { id: '30013', name: '源岩', count: 1 }
    const cost: NonNullable<UpgradeSuggestion['training_cost']> = {
      status: 'available',
      totals: { ...emptyBucket(), materials: [material] },
      available: emptyBucket(),
      missing: emptyBucket(),
      equivalent_sanity: 0,
      unpriced_items: [],
      sources: {
        skland: 'ok', yituliu: 'fresh', pricing_snapshot_id: null,
        pricing_fetched_at: null, pricing_age_ms: null, valuation_version: null,
        lmd_exp: 'fixed_lmd_trade_gold_net_exp_36_per_10000',
      },
      warnings: [],
      operators: [],
    }
    const { rerender } = renderComponent([{ ...base, training_cost: cost }])
    expect(screen.getAllByText('材料可合成')).toHaveLength(2)
    rerender(<UpgradeSuggestions suggestions={[{ ...base, training_cost: {
      ...cost, missing: { ...emptyBucket(), materials: [material] },
    } }]} />)
    expect(screen.getAllByText('仍有缺口')).toHaveLength(2)
  })

  it('keeps optimizer scores out of suggestion metrics and partial outcomes', async () => {
    const user = userEvent.setup()
    renderComponent([{
      type: 'bundle',
      name: '组合建议',
      gain: 37,
      ops: [{ name: '干员 A' }, { name: '干员 B' }],
      roi: { efficiency_gain: 37, daily_sanity_gain: 4, payback_days: 10, payback_basis: 'missing_sanity' },
      impact: { rooms: [{
        room_name: '制造站',
        room_type: 'manufacture',
        product: 'Battle Record',
        rule_description: '测试规则',
        operators: ['干员 A'],
        missing_operators: ['干员 B'],
        estimated_gain: 38,
      }] },
      partial_outcomes: [{
        missing_operator: { name: '干员 B' },
        remaining_ops: [{ name: '干员 A' }],
        efficiency_gain: 37,
        daily_sanity_gain: 2,
        has_benefit: true,
        rooms: '制造站',
      }],
    }])

    expect(screen.queryByText('排班得分变化')).not.toBeInTheDocument()
    expect(screen.getByText('每日理智收益')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看解释' }))
    expect(screen.getByText(/作战记录 · 测试规则/)).toBeInTheDocument()
    expect(screen.queryByText(/Battle Record/)).not.toBeInTheDocument()
    expect(screen.getByText(/剩余.*\+2/)).toBeInTheDocument()
    expect(screen.queryByText(/\+37%/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\+38%/)).not.toBeInTheDocument()
  })

  it('prunes expanded ids when suggestions are replaced', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const { rerender } = render(<UpgradeSuggestions {...props} suggestions={[suggestion('upgrade-a', '干员 A')]} />)

    await user.click(screen.getByRole('button', { name: '查看解释' }))

    rerender(<UpgradeSuggestions {...props} suggestions={[suggestion('upgrade-b', '干员 B')]} />)

    await waitFor(() => expect(screen.getByRole('button', { name: '查看解释' })).toHaveAttribute('aria-expanded', 'false'))
  })
})

function renderComponent(suggestions: UpgradeSuggestion[]) {
  return render(<UpgradeSuggestions {...baseProps()} suggestions={suggestions} />)
}

function baseProps() {
  return {}
}

function paybackSuggestion(name: string, missing: number | null, gain: number | null): UpgradeSuggestion {
  const cost: UpgradeTrainingCost = {
    status: 'available',
    totals: { ...emptyBucket(), equivalent_sanity: 8912 },
    available: { ...emptyBucket(), equivalent_sanity: 6591 },
    missing: { ...emptyBucket(), equivalent_sanity: missing },
    equivalent_sanity: 8912,
    unpriced_items: [],
    sources: {
      skland: 'ok', yituliu: 'fresh', pricing_snapshot_id: null, pricing_fetched_at: null,
      pricing_age_ms: null, valuation_version: null, lmd_exp: 'fixed_lmd_trade_gold_net_exp_36_per_10000',
    },
    warnings: [],
    operators: [],
  }
  return {
    ...suggestion(name, name),
    training_cost: cost,
    roi: { efficiency_gain: 1, daily_sanity_gain: gain, payback_days: 0, payback_basis: 'missing_sanity' },
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
