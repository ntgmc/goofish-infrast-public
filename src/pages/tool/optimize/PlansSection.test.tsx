// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../../lib/config'
import type { WorkspaceResultHistorySummary, WorkspaceSavedConfig } from '../../../lib/types'
import PlansSection from './PlansSection'

afterEach(cleanup)

const config = CONFIG_PRESETS['243']
describe('PlansSection', () => {
  it('labels both active and archived manual history separately from generated schedules', () => {
    renderSection({
      archiveLimit: 1,
      resultHistory: [{ ...historyItem(1), source: 'manual' }],
      archivedResults: [{ ...historyItem(2), source: 'manual', archived: true }],
    })
    expect(screen.getAllByText(/手动排班 ·/)).toHaveLength(2)
  })

  it.each([
    { error: '封存区已满，请先取消封存或使用结果封存夹扩容。', notice: null, role: 'alert' },
    { error: null, notice: '结果已移入封存区。', role: 'status' },
  ])('shows result feedback in the viewport outside the configuration library: $role', ({ error, notice, role }) => {
    const { container } = renderSection({ error, notice, resultHistory: [historyItem(1)] })
    const message = error ?? notice!
    const feedback = screen.getByRole(role)
    expect(feedback).toHaveTextContent(message)
    expect(feedback.parentElement).toBe(document.body)
    expect(feedback).toHaveClass('fixed', 'bottom-6', 'pointer-events-none')
    expect(within(container).queryByText(message)).not.toBeInTheDocument()
  })

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
      onRenameSavedConfig: vi.fn().mockResolvedValue(undefined),
      onSaveCurrent: vi.fn().mockResolvedValue(undefined),
      onUseHistoryConfig: vi.fn(),
      onUseSavedConfig: vi.fn(),
      onViewHistory: vi.fn(),
    }

    renderSection({ savedConfigs: [saved], resultHistory: [history], ...callbacks })

    await user.click(screen.getByRole('button', { name: '载入到配置编辑器' }))
    await user.click(screen.getByRole('button', { name: '重命名方案' }))
    await user.click(screen.getByRole('button', { name: '删除方案' }))
    await user.click(screen.getByRole('button', { name: '查看排班结果' }))
    await user.click(screen.getByRole('button', { name: '下载 MAA JSON' }))
    await user.click(screen.getByRole('button', { name: '用此配置继续调整' }))

    expect(callbacks.onUseSavedConfig).toHaveBeenCalledWith(saved)
    expect(callbacks.onRenameSavedConfig).toHaveBeenCalledWith(saved)
    expect(callbacks.onDeleteSavedConfig).toHaveBeenCalledWith(saved)
    expect(callbacks.onViewHistory).toHaveBeenCalledWith(history)
    expect(callbacks.onDownloadHistory).toHaveBeenCalledWith(history)
    expect(callbacks.onUseHistoryConfig).toHaveBeenCalledWith(history)
    expect(screen.queryByRole('button', { name: '下载完整计算数据' })).not.toBeInTheDocument()
  })

  it('allows deleting a read-only trial configuration', async () => {
    const user = userEvent.setup()
    const saved = { ...savedConfig(1), read_only: true }
    const onDeleteSavedConfig = vi.fn().mockResolvedValue(undefined)

    renderSection({ savedConfigs: [saved], onDeleteSavedConfig })

    expect(screen.getByRole('button', { name: '载入到配置编辑器' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重命名方案' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除方案' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '删除方案' }))

    expect(onDeleteSavedConfig).toHaveBeenCalledWith(saved)
  })

  it('keeps full calculation downloads out of history shortcuts', () => {
    const rotation = historyItem(2, 'rotation')
    renderSection({ resultHistory: [historyItem(1)], archivedResults: [rotation], archiveLimit: 1 })

    const maaButtons = screen.getAllByRole('button', { name: '下载 MAA JSON' })
    expect(maaButtons).toHaveLength(2)
    expect(maaButtons[0]).toBeDisabled()
    expect(maaButtons[1]).toBeEnabled()
    expect(screen.queryByRole('button', { name: '下载完整计算数据' })).not.toBeInTheDocument()
  })

  it('hides the result archive area when its capacity is zero', () => {
    renderSection({ resultHistory: [historyItem(1)] })

    expect(screen.queryByRole('heading', { name: '结果封存区' })).not.toBeInTheDocument()
    expect(screen.queryByText('封存区暂无结果。')).not.toBeInTheDocument()
  })
  it('shows archives before history and keeps archive attempts enabled when full', async () => {
    const user = userEvent.setup()
    const onArchiveHistory = vi.fn().mockResolvedValue(undefined)
    const onRenameArchivedHistory = vi.fn().mockResolvedValue(undefined)
    const archived = { ...historyItem(2), archived: true }
    renderSection({
      resultHistory: [historyItem(1)],
      archivedResults: [archived],
      archiveLimit: 1,
      archivedResultsUsed: 1,
      onArchiveHistory,
      onRenameArchivedHistory,
    })
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.id))
      .toEqual(['saved-configs-title', 'archived-results-title', 'result-history-title'])
    expect(screen.queryByText('封存区已满，请先取消封存或使用结果封存夹扩容。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '封存' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '封存' }))
    expect(onArchiveHistory).toHaveBeenCalledWith(historyItem(1))
    await user.click(screen.getByRole('button', { name: '修改封存名' }))
    expect(onRenameArchivedHistory).toHaveBeenCalledWith(archived)
  })

  it('disables archiving without archive capacity', () => {
    renderSection({ resultHistory: [historyItem(1)], archiveLimit: 0 })
    expect(screen.getByRole('button', { name: '封存' })).toBeDisabled()
  })

  it('enables unarchiving when refreshed history capacity has a free slot', () => {
    const options = {
      activeConfig: config, savedConfigs: [], resultHistory: [], archivedResults: [{ ...historyItem(1), archived: true }],
      archiveLimit: 1, selectedHistoryId: null, busyAction: null, notice: null, error: null,
      onSaveCurrent: vi.fn(), onUseSavedConfig: vi.fn(), onRenameSavedConfig: vi.fn(), onDeleteSavedConfig: vi.fn(),
      onViewHistory: vi.fn(), onUseHistoryConfig: vi.fn(), onDownloadHistory: vi.fn(),
    }
    const { rerender } = render(<PlansSection {...options} resultHistoryUsed={5} />)
    expect(screen.getByRole('button', { name: '取消封存' })).toBeDisabled()
    rerender(<PlansSection {...options} resultHistoryUsed={4} />)
    expect(screen.getByRole('button', { name: '取消封存' })).toBeEnabled()
    expect(screen.queryByText('普通历史记录已满，请先删除一条记录，再取消封存。')).not.toBeInTheDocument()
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

function historyItem(index: number, scheduleMode: 'maa' | 'rotation' = 'maa'): WorkspaceResultHistorySummary {
  return {
    id: `history-${index}`,
    name: `结果 ${index}`,
    created_at: '2026-07-23T00:00:00.000Z',
    operator_count: 1,
    source: 'generated',
    archived: false,
    schedule_mode: scheduleMode,
    maa_exportable: scheduleMode !== 'rotation',
    has_config: true,
  }
}
