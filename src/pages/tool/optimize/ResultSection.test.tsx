// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OptimizeResult } from '../../../lib/types'
import { UpgradeSuggestionStatusNotice } from './ResultSection'

afterEach(cleanup)

describe('UpgradeSuggestionStatusNotice', () => {
  it.each([
    ['completed', '排班和优化建议均已完成，本次没有发现可推荐的升级项。', 'status'],
    ['not_requested', '排班已完成，本次未请求优化建议。', 'status'],
    ['not_allowed', '排班已完成，当前权益不包含优化建议。', 'status'],
    ['failed', '排班已完成，但优化建议计算失败。主排班结果已保留，可重新生成后再试。', 'alert'],
  ] as const)('renders the %s terminal state', (status, message, role) => {
    render(<UpgradeSuggestionStatusNotice result={{ upgrade_suggestions_status: status } as OptimizeResult} />)

    expect(screen.getByRole(role)).toHaveTextContent(message)
  })

  it.each([
    ['deadline_budget', '排班已完成；优化建议已完整验证 7/24 个候选，其余候选因时间预算不足尚未模拟。'],
    ['simulation_limit', '排班已完成；优化建议已完整验证 24/30 个候选，其余候选达到本次完整模拟上限，尚未验证。'],
  ] as const)('renders a partial result for %s', (reason, message) => {
    render(<UpgradeSuggestionStatusNotice result={{
      upgrade_suggestions_status: 'partial',
      upgrade_suggestions_evaluated_count: reason === 'deadline_budget' ? 7 : 24,
      upgrade_suggestions_candidate_count: reason === 'deadline_budget' ? 24 : 30,
      upgrade_suggestions_truncated_reason: reason,
    } as OptimizeResult} />)

    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(screen.getByRole('status')).toHaveClass('tool-alert--warning')
  })
})
