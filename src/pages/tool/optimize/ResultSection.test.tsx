// @vitest-environment jsdom

import { lazy, Suspense } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizeResult } from '../../../lib/types'
import { ResultErrorBoundary, UpgradeSuggestionStatusNotice } from './ResultSection'
import ResultPanel from '../../../components/ResultPanel'
import { copy } from '../../../copy'
import { disableDebugMode, enableDebugMode, getDebugDiagnosticsSnapshot } from '../../../lib/debug-diagnostics'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  disableDebugMode()
})

describe('UpgradeSuggestionStatusNotice', () => {
  it('labels quick values as references and does not claim all upgrades have been ruled out', () => {
    render(<UpgradeSuggestionStatusNotice result={{
      author: 'test', title: 'quick', description: '', buildingType: 243,
      planTimes: '3 班', plans: [], raw_results: [],
      calculation_mode: 'quick', upgrade_suggestions_status: 'partial',
      upgrade_suggestions: [], upgrade_suggestions_evaluated_count: 4,
      upgrade_suggestions_candidate_count: 16, upgrade_suggestions_truncated_reason: 'simulation_limit',
    } as OptimizeResult} />)
    expect(screen.getByRole('status')).toHaveTextContent('收益和回本数值供参考')
    expect(screen.getByRole('status')).toHaveTextContent('本次快速复核未确认有收益的升级建议')
    expect(screen.getByRole('status')).toHaveTextContent('完整计算继续查找')
    expect(screen.queryByText('排班和优化建议均已完成，本次没有发现可推荐的升级项。')).not.toBeInTheDocument()
  })

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
  it.each([
    'Failed to fetch dynamically imported module: /assets/ResultPanel.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/ResultPanel.css',
  ])('offers reload instead of blaming result data when lazy loading fails: %s', async (message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const FailedPanel = lazy(() => Promise.reject(new TypeError(message)))
    render(<ResultErrorBoundary resetKey="history:1" diagnosticDownloadBusy={false} onDownloadDiagnostic={vi.fn()}>
      <Suspense fallback={<p>Loading</p>}><FailedPanel /></Suspense>
    </ResultErrorBoundary>)
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.common.pageLoadFailed)
    expect(screen.getByRole('button', { name: copy.common.pageReload })).toBeVisible()
    expect(screen.queryByText(copy.inventory.result_data_incompatible)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载完整计算数据' })).not.toBeInTheDocument()
  })

  it('keeps a slow lazy import loading until it succeeds', async () => {
    let finishLoading!: (module: { default: () => React.JSX.Element }) => void
    const SlowPanel = lazy(() => new Promise<{ default: () => React.JSX.Element }>((resolve) => { finishLoading = resolve }))
    render(<ResultErrorBoundary resetKey="history:1" diagnosticDownloadBusy={false}>
      <Suspense fallback={<p role="status">Loading</p>}><SlowPanel /></Suspense>
    </ResultErrorBoundary>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => finishLoading({ default: () => <p>Loaded result</p> }))
    expect(screen.getByText('Loaded result')).toBeVisible()
  })

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
      <ResultErrorBoundary resetKey="history-invalid" diagnosticDownloadBusy={false} onDownloadDiagnostic={onDownloadFullResult}>
        <ResultPanel result={invalidResult} operators={[]} />
      </ResultErrorBoundary>,
    )

    expect(await screen.findByRole('alert', undefined, { timeout: 5_000 })).toHaveTextContent(copy.inventory.result_data_incompatible)
    expect(screen.getByRole('button', { name: '下载完整计算数据' })).toBeInTheDocument()
    expect(getDebugDiagnosticsSnapshot().events).toContainEqual(expect.objectContaining({
      type: 'react_error',
      context: 'result_render',
    }))
  })
})
