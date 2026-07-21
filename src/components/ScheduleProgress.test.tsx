// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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

  it('shows a queued continuation without presenting aggregate 92% as final', () => {
    render(<ScheduleProgress progress={createProgress({
      startedAt: NOW - 5_000,
      jobId: 'upgrade-job',
      queueStatus: 'queued',
      queuePosition: 3,
      observedRunning: false,
      percentFloor: 92,
      estimatedRemainingMs: 20_000,
      estimatedTotalMs: 100_000,
      estimatePhase: 'queued',
      estimateUpdatedAt: new Date(NOW).toISOString(),
    })} />)

    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow', '92')
    expect(progressbar).toHaveAttribute('aria-valuetext', expect.stringContaining('已加入队列'))
    expect(screen.getByText('已加入队列')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText(/前方还有 2 个任务/)).toBeInTheDocument()
    expect(screen.queryByText('Final')).not.toBeInTheDocument()
    expect(screen.queryByText('即将完成')).not.toBeInTheDocument()
    expect(screen.queryByText('后台计算已进入收尾阶段，结果完成后会自动展示。')).not.toBeInTheDocument()
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
