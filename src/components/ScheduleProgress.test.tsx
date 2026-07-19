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
})

function createProgress(patch: Partial<ScheduleProgressState>): ScheduleProgressState {
  return {
    mode: 'generate',
    startedAt: NOW,
    connectionStatus: 'connected',
    ...patch,
  }
}
