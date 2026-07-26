// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduleProgress, { type ScheduleProgressState } from './ScheduleProgress'

const NOW = new Date('2026-07-19T10:00:00.000Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ScheduleProgress motion', () => {
  it.each([
    ['start', 0, { startedAt: NOW, estimatedDurationMs: 10_000 }],
    ['running', 48, { startedAt: NOW - 5_000, estimatedDurationMs: 10_000, queueStatus: 'running', observedRunning: true }],
    ['complete', 100, { startedAt: NOW - 10_000, completedAt: NOW - 500, estimatedDurationMs: 10_000, estimatePhase: 'completed' }],
  ] as const)('reports a stable %s progress value', (_label, expected, patch) => {
    render(<ScheduleProgress progress={createProgress(patch)} />)

    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow', String(expected))
    expect(progressbar.firstElementChild).toHaveClass('origin-left')
  })

  it('refreshes active progress before the previous 260 ms cadence', async () => {
    render(<ScheduleProgress progress={createProgress({ startedAt: NOW, estimatedDurationMs: 10_000 })} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')

    await act(async () => vi.advanceTimersByTimeAsync(120))

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  it('shows a cancelled queued task as a terminal state', () => {
    render(<ScheduleProgress progress={createProgress({
      startedAt: NOW - 5_000,
      jobId: 'cancelled-job',
      queueStatus: 'queued',
      queuePosition: null,
      observedRunning: false,
      estimatedRemainingMs: null,
      estimatedTotalMs: null,
      estimatePhase: 'cancelled',
      cancellationRequested: true,
      executionPhase: 'terminal',
    })} />)

    const panel = screen.getByLabelText('排班生成任务状态')
    expect(panel).toHaveAttribute('data-status', 'cancelled')
    expect(screen.getByText('任务已取消')).toBeInTheDocument()
    expect(screen.getByText('任务已从等待队列中取消，不会继续执行。')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', expect.stringContaining('已离开队列'))
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByText('正在取消任务')).not.toBeInTheDocument()
  })

  it('keeps the real suggestion stage visible even when the ETA percentage is above 92%', () => {
    render(<ScheduleProgress progress={createProgress({
      startedAt: NOW - 20_000,
      jobId: 'merged-job',
      queueStatus: 'running',
      observedRunning: true,
      estimatedRemainingMs: 0,
      estimatedTotalMs: 10_000,
      estimatePhase: 'overdue',
      estimateUpdatedAt: new Date(NOW).toISOString(),
      calculationStage: 'simulating_upgrades',
      calculationStageUpdatedAt: new Date(NOW - 10_000).toISOString(),
      upgradeSuggestionsRequested: true,
      upgradeSuggestionsAllowed: true,
    })} />)

    expect(screen.getByText('正在模拟优化建议')).toBeInTheDocument()
    expect(screen.getByText('计算优化建议')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67')
    expect(screen.queryByText('即将完成')).not.toBeInTheDocument()
  })

  it('advances within MAA baseline simulation instead of sticking at 91%', async () => {
    render(<ScheduleProgress progress={createProgress({
      startedAt: NOW - 60_000,
      jobId: 'merged-job',
      queueStatus: 'running',
      observedRunning: true,
      estimatedRemainingMs: 0,
      estimatedTotalMs: 10_000,
      estimatePhase: 'overdue',
      estimateUpdatedAt: new Date(NOW).toISOString(),
      calculationStage: 'simulating_maa_baseline',
      calculationStageUpdatedAt: new Date(NOW).toISOString(),
      upgradeSuggestionsRequested: true,
      upgradeSuggestionsAllowed: true,
    })} />)

    expect(screen.getByText('正在计算 MAA 对比基准')).toBeInTheDocument()
    expect(screen.getByText('计算优化建议').closest('[data-state]')).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('持久化结果').closest('[data-state]')).toHaveAttribute('data-state', 'pending')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '86')

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '88')

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '90')
  })

  it('changes speed without jumping to the next stage percentage', async () => {
    const simulating = createProgress({
      startedAt: NOW - 20_000,
      jobId: 'buffered-job',
      queueStatus: 'running',
      observedRunning: true,
      estimatedRemainingMs: 0,
      estimatedTotalMs: 10_000,
      estimatePhase: 'overdue',
      estimateUpdatedAt: new Date(NOW).toISOString(),
      calculationStage: 'simulating_upgrades',
      calculationStageUpdatedAt: new Date(NOW - 10_000).toISOString(),
      upgradeSuggestionsRequested: true,
      upgradeSuggestionsAllowed: true,
    })
    const { rerender } = render(<ScheduleProgress progress={simulating} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67')

    rerender(<ScheduleProgress progress={{
      ...simulating,
      calculationStage: 'enriching_training_costs',
      calculationStageUpdatedAt: new Date(NOW).toISOString(),
    }} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67')

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '68')
  })

  it('does not move backwards when a running stage starts below queued progress', () => {
    const queued = createProgress({
      startedAt: NOW - 20_000,
      jobId: 'queued-job',
      queueStatus: 'queued',
      estimatedTotalMs: 40_000,
      estimatePhase: 'queued',
    })
    const { rerender } = render(<ScheduleProgress progress={queued} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '48')

    rerender(<ScheduleProgress progress={{
      ...queued,
      queueStatus: 'running',
      observedRunning: true,
      estimatePhase: 'running',
      calculationStage: 'starting',
    }} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '48')
  })

  it('omits the suggestion step when the merged job only computes a schedule', () => {
    render(<ScheduleProgress progress={createProgress({
      startedAt: NOW - 5_000,
      queueStatus: 'running',
      observedRunning: true,
      estimatePhase: 'running',
      calculationStage: 'formatting_result',
      upgradeSuggestionsRequested: false,
      upgradeSuggestionsAllowed: false,
    })} />)

    expect(screen.getByText('正在整理计算结果')).toBeInTheDocument()
    expect(screen.queryByText('计算优化建议')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('marks only the suggestion step as failed when the main schedule still succeeds', () => {
    render(<ScheduleProgress progress={createProgress({
      startedAt: NOW - 10_000,
      completedAt: NOW - 500,
      estimatedDurationMs: 10_000,
      estimatePhase: 'completed',
      calculationStage: 'completed',
      upgradeSuggestionsRequested: true,
      upgradeSuggestionsAllowed: true,
      upgradeSuggestionsStatus: 'failed',
    })} />)

    expect(screen.getByText('排班方案已就绪')).toBeInTheDocument()
    expect(screen.getByText('计算优化建议').closest('[data-state]')).toHaveAttribute('data-state', 'failed')
    expect(screen.getByText('持久化结果').closest('[data-state]')).toHaveAttribute('data-state', 'done')
  })

  it('marks a partial suggestion stage as completed because verified results were preserved', () => {
    render(<ScheduleProgress progress={createProgress({
      startedAt: NOW - 10_000,
      completedAt: NOW - 500,
      estimatedDurationMs: 10_000,
      estimatePhase: 'completed',
      calculationStage: 'completed',
      upgradeSuggestionsRequested: true,
      upgradeSuggestionsAllowed: true,
      upgradeSuggestionsStatus: 'partial',
    })} />)

    expect(screen.getByText('计算优化建议').closest('[data-state]')).toHaveAttribute('data-state', 'done')
    expect(screen.getByText('持久化结果').closest('[data-state]')).toHaveAttribute('data-state', 'done')
  })
})

function createProgress(patch: Partial<ScheduleProgressState>): ScheduleProgressState {
  return {
    mode: 'generate',
    startedAt: NOW,
    connectionStatus: 'connected',
    ...patch,
  }
}
