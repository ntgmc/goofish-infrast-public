// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizeResult } from '../../../lib/types'
import ResultSection, { UpgradeSuggestionStatusNotice } from './ResultSection'
import { disableDebugMode, enableDebugMode, getDebugDiagnosticsSnapshot } from '../../../lib/debug-diagnostics'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  disableDebugMode()
})

describe('UpgradeSuggestionStatusNotice', () => {
  it.each([
    ['completed', '排班和优化建议均已完成，本次没有发现可推荐的升级项。', 'status'],
    ['not_requested', '排班已完成，本次未请求优化建议。', 'status'],
    ['not_allowed', '排班已完成，当前权益不包含优化建议。', 'status'],
    ['failed', '排班已完成，但优化建议计算失败。排班结果已保留，可重新生成后再试。', 'alert'],
  ] as const)('renders the %s terminal state', (status, message, role) => {
    render(<UpgradeSuggestionStatusNotice result={{ upgrade_suggestions_status: status } as OptimizeResult} />)

    expect(screen.getByRole(role)).toHaveTextContent(message)
  })

  it.each([
    ['deadline_budget', '排班已完成。已完整验证 7/24 项培养建议，其余建议因计算时间不足尚未模拟。'],
    ['simulation_limit', '排班已完成。已完整验证 24/30 项培养建议，本次完整模拟次数已用完，其余建议尚未验证。'],
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

describe('ResultSection compatibility fallback', () => {
  it('contains malformed history rendering and keeps the diagnostic download action', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(enableDebugMode()).toBe(true)
    const onDownloadFullResult = vi.fn()
    const invalidResult = {
      author: 'test',
      title: '损坏结果',
      description: 'test',
      buildingType: 253,
      planTimes: '1 班',
      plans: null,
      raw_results: [],
    } as unknown as OptimizeResult

    render(
      <ResultSection
        phase="history"
        historyItem={{
          id: 'history-invalid',
          name: '损坏历史',
          created_at: '2026-08-02T00:00:00.000Z',
          config: null,
          result: invalidResult,
          operator_count: 0,
          source: 'legacy',
        }}
        currentResult={null}
        finalResult={null}
        operators={[]}
        suggestions={[]}
        loading={false}
        progress={null}
        previewProfile={false}
        canViewUpgradeSuggestions
        upgradeCdk=""
        upgradeLoading={false}
        upgradeError={null}
        onUpgradeCdkChange={vi.fn()}
        onUpgradePreviewProfile={vi.fn()}
        onDownloadFullResult={onDownloadFullResult}
      />,
    )

    expect(await screen.findByRole('alert', undefined, { timeout: 5_000 })).toHaveTextContent('这条排班结果版本过旧或数据不完整，暂时无法完整展示。')
    expect(screen.getByRole('button', { name: '下载完整计算数据' })).toBeInTheDocument()
    expect(getDebugDiagnosticsSnapshot().events).toContainEqual(expect.objectContaining({
      type: 'react_error',
      context: 'result_render',
    }))
  })
})

describe('ResultSection locked capabilities', () => {
  it.each(['suggestions', 'final', 'history'] as const)('gates manual editing and suggestions in %s results', async (phase) => {
    const user = userEvent.setup()
    const result = {
      author: 'test',
      title: '免费预览结果',
      description: 'test',
      buildingType: 243,
      planTimes: '单班',
      plans: [],
      raw_results: [],
      upgrade_suggestions_status: 'not_allowed',
      preview_limit: {
        hidden_room_count: 1,
        notice: '当前展示预览结果。',
      },
    } as OptimizeResult

    render(
      <MemoryRouter>
        <ResultSection
          phase={phase}
          historyItem={phase === 'history' ? {
            id: 'preview-history', name: result.title, created_at: '2026-10-01T00:00:00Z',
            config: null, result, operator_count: 0, source: 'generated',
          } : null}
          currentResult={result}
          finalResult={result}
          operators={[]}
          suggestions={[]}
          loading={false}
          progress={null}
          previewProfile
          manualEditProfile={{ id: 'preview', kind: 'free_preview', permission: 'advanced' }}
          canViewUpgradeSuggestions={false}
          upgradeCdk=""
          upgradeLoading={false}
          upgradeError={null}
          onUpgradeCdkChange={vi.fn()}
          onUpgradePreviewProfile={vi.fn()}
        />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('tab', { name: '建议' }))

    expect(await screen.findByRole('heading', { name: '解锁完整练度建议' })).toBeInTheDocument()
    expect(screen.getByText('需要高级版 CDK 权限')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '购买高级版 CDK' })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('link', { name: '兑换 CDK' })).toHaveAttribute('href', '/tool/redeem')
    expect(document.querySelector('[data-locked-capability-preview]')).toHaveAttribute('aria-hidden', 'true')
    await user.click(screen.getByRole('tab', { name: '手动排班' }))
    const panel = within(screen.getByRole('tabpanel', { name: '手动排班' }))
    expect(panel.getByRole('heading', { name: '解锁手动排班' })).toBeInTheDocument()
    expect(panel.getByText('需要高级版 CDK 权限')).toBeInTheDocument()
    expect(panel.getByRole('link', { name: '购买高级版 CDK' })).toHaveAttribute('href', '/pricing')
    expect(panel.getByRole('link', { name: '兑换 CDK' })).toHaveAttribute('href', '/tool/redeem')
    expect(panel.queryByRole('button', { name: '保存本地草稿' })).not.toBeInTheDocument()
    expect(localStorage.getItem('manual-schedule:preview')).toBeNull()
  })
})
