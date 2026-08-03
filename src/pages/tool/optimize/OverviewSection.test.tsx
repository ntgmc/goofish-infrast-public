// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../../lib/config'
import type { OptimizeResult, WorkspaceResultHistoryItem } from '../../../lib/types'
import OverviewSection from './OverviewSection'

afterEach(cleanup)

const config = CONFIG_PRESETS['243']
const historyItem: WorkspaceResultHistoryItem = {
  id: 'history-1',
  name: '最近排班',
  created_at: '2026-07-23T00:00:00.000Z',
  config,
  result: { schedule_mode: 'maa', plans: [] } as unknown as OptimizeResult,
  operator_count: 1,
  source: 'legacy',
}

describe('OverviewSection', () => {
  it('keeps configuration editing in context and exposes explicit workspace and result actions', async () => {
    const user = userEvent.setup()
    const onOpenConfig = vi.fn()
    const onOpenPlans = vi.fn()
    const onViewHistory = vi.fn()
    const onDownloadHistory = vi.fn()
    const onUseHistoryConfig = vi.fn()

    render(
      <OverviewSection
        activeConfig={config}
        configChanged={false}
        showConfigDetails
        operatorCount={1}
        configPresetLabel="243"
        validation={{ ok: true }}
        loading={false}
        syncing={false}
        progress={null}
        hasResult
        resultIsCurrent={false}
        error={null}
        priorityCoupon={{ balance: null, selected: false, onChange: vi.fn() }}
        savedConfigCount={1}
        resultHistoryCount={1}
        latestResult={historyItem}
        onGenerate={vi.fn()}
        onReset={vi.fn()}
        onOpenPlans={onOpenPlans}
        onOpenConfig={onOpenConfig}
        onViewHistory={onViewHistory}
        onUseHistoryConfig={onUseHistoryConfig}
        onDownloadHistory={onDownloadHistory}
      />,
    )

    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('1/5')).toBeInTheDocument()
    expect(screen.getByText('历史结果', { selector: '.tool-status' })).toBeInTheDocument()
    expect(screen.queryByText('旧结果')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看结果' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑当前配置' }))
    await user.click(screen.getByRole('button', { name: '打开方案与历史' }))
    await user.click(screen.getByRole('button', { name: '查看排班结果' }))
    await user.click(screen.getByRole('button', { name: '下载 MAA JSON' }))
    await user.click(screen.getByRole('button', { name: '用此配置继续调整' }))

    expect(onOpenConfig).toHaveBeenCalledTimes(1)
    expect(onOpenPlans).toHaveBeenCalledTimes(1)
    expect(onViewHistory).toHaveBeenCalledWith(historyItem)
    expect(onDownloadHistory).toHaveBeenCalledWith(historyItem)
    expect(onUseHistoryConfig).toHaveBeenCalledWith(historyItem)
    expect(screen.queryByRole('button', { name: '下载完整计算数据' })).not.toBeInTheDocument()
  })
})
