// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../../lib/config'
import type { OptimizeResult, WorkspaceResultHistoryItem, WorkspaceSavedConfig } from '../../../lib/types'
import PlansSection from './PlansSection'

afterEach(cleanup)

const config = CONFIG_PRESETS['243']
const result = { schedule_mode: 'maa', plans: [] } as unknown as OptimizeResult

describe('PlansSection', () => {
  it('separates configuration and history retention, disabling saves at the configuration limit', () => {
    renderSection({
      savedConfigs: [savedConfig(1), savedConfig(2), savedConfig(3)],
      resultHistory: [historyItem(1), historyItem(2), historyItem(3), historyItem(4), historyItem(5)],
    })

    expect(screen.getByText('3/3')).toBeInTheDocument()
    expect(screen.getByText('5/5')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '方案名称' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存当前配置' })).toBeDisabled()
    expect(screen.getByText('已达到保存上限，请先删除不再需要的方案。')).toBeInTheDocument()
    expect(screen.queryByText('当前方案 vs 上次方案')).not.toBeInTheDocument()
    expect(screen.queryByText('上次结果')).not.toBeInTheDocument()
  })

  it('uses explicit action labels and preserves each existing callback', async () => {
    const user = userEvent.setup()
    const saved = savedConfig(1)
    const history = historyItem(1)
    const callbacks = {
      onDeleteSavedConfig: vi.fn().mockResolvedValue(undefined),
      onDownloadHistory: vi.fn(),
      onDownloadFullResultHistory: vi.fn(),
      onRenameSavedConfig: vi.fn().mockResolvedValue(undefined),
      onSaveCurrent: vi.fn().mockResolvedValue(undefined),
      onUseHistoryConfig: vi.fn(),
      onUseSavedConfig: vi.fn(),
      onViewHistory: vi.fn(),
    }

    renderSection({ savedConfigs: [saved], resultHistory: [history], canDownloadFullResult: true, ...callbacks })

    await user.click(screen.getByRole('button', { name: '载入到配置编辑器' }))
    await user.click(screen.getByRole('button', { name: '重命名方案' }))
    await user.click(screen.getByRole('button', { name: '删除方案' }))
    await user.click(screen.getByRole('button', { name: '查看排班结果' }))
    await user.click(screen.getByRole('button', { name: '下载 MAA JSON' }))
    await user.click(screen.getByRole('button', { name: '下载完整计算数据' }))
    await user.click(screen.getByRole('button', { name: '用此配置继续调整' }))

    expect(callbacks.onUseSavedConfig).toHaveBeenCalledWith(saved)
    expect(callbacks.onRenameSavedConfig).toHaveBeenCalledWith(saved)
    expect(callbacks.onDeleteSavedConfig).toHaveBeenCalledWith(saved)
    expect(callbacks.onViewHistory).toHaveBeenCalledWith(history)
    expect(callbacks.onDownloadHistory).toHaveBeenCalledWith(history)
    expect(callbacks.onDownloadFullResultHistory).toHaveBeenCalledWith(history)
    expect(callbacks.onUseHistoryConfig).toHaveBeenCalledWith(history)
  })

  it('hides full data without capability and keeps it available for archived rotation results', async () => {
    const user = userEvent.setup()
    const rotation = historyItem(2, 'rotation')
    const onDownloadFullResultHistory = vi.fn()

    const { rerender } = renderSection({ resultHistory: [rotation] })
    expect(screen.queryByRole('button', { name: '下载完整计算数据' })).not.toBeInTheDocument()

    rerender(
      <PlansSection
        activeConfig={config}
        savedConfigs={[]}
        resultHistory={[]}
        archivedResults={[rotation]}
        selectedHistoryId={null}
        busyAction={null}
        notice={null}
        error={null}
        canDownloadFullResult
        onSaveCurrent={vi.fn().mockResolvedValue(undefined)}
        onUseSavedConfig={vi.fn()}
        onRenameSavedConfig={vi.fn().mockResolvedValue(undefined)}
        onDeleteSavedConfig={vi.fn().mockResolvedValue(undefined)}
        onViewHistory={vi.fn()}
        onUseHistoryConfig={vi.fn()}
        onDownloadHistory={vi.fn()}
        onDownloadFullResultHistory={onDownloadFullResultHistory}
      />,
    )

    expect(screen.getByRole('button', { name: '下载 MAA JSON' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '下载完整计算数据' }))
    expect(onDownloadFullResultHistory).toHaveBeenCalledWith(rotation)
  })
})

function renderSection(overrides: Partial<ComponentProps<typeof PlansSection>> = {}) {
  return render(
    <PlansSection
      activeConfig={config}
      savedConfigs={[]}
      resultHistory={[]}
      selectedHistoryId={null}
      busyAction={null}
      notice={null}
      error={null}
      onSaveCurrent={vi.fn().mockResolvedValue(undefined)}
      onUseSavedConfig={vi.fn()}
      onRenameSavedConfig={vi.fn().mockResolvedValue(undefined)}
      onDeleteSavedConfig={vi.fn().mockResolvedValue(undefined)}
      onViewHistory={vi.fn()}
      onUseHistoryConfig={vi.fn()}
      onDownloadHistory={vi.fn()}
      canDownloadFullResult={false}
      onDownloadFullResultHistory={vi.fn()}
      {...overrides}
    />,
  )
}

function savedConfig(index: number): WorkspaceSavedConfig {
  return {
    id: `config-${index}`,
    name: `配置 ${index}`,
    config,
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
    last_used_at: null,
  }
}

function historyItem(index: number, scheduleMode: 'maa' | 'rotation' = 'maa'): WorkspaceResultHistoryItem {
  return {
    id: `history-${index}`,
    name: `结果 ${index}`,
    created_at: '2026-07-23T00:00:00.000Z',
    config,
    result: { ...result, schedule_mode: scheduleMode },
    operator_count: 1,
    source: 'generated',
  }
}
