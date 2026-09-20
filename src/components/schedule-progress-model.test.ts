import { describe, expect, it } from 'vitest'
import type { ScheduleProgressState } from './ScheduleProgress'
import { getScheduleProgressPercent } from './schedule-progress-model'

const START = Date.parse('2026-09-20T00:00:00Z')
const running: ScheduleProgressState = {
  mode: 'generate',
  startedAt: START,
  observedRunning: true,
  calculationStage: 'generating_schedule',
  calculationStageUpdatedAt: new Date(START).toISOString(),
}

describe('schedule progress model', () => {
  it('keeps even an hour in queue below the first calculation milestone', () => {
    const progress: ScheduleProgressState = { mode: 'generate', startedAt: START, queueStatus: 'queued' }
    expect(getScheduleProgressPercent(progress, START + 3_600_000)).toBeLessThan(8)
  })

  it('advances beyond the expected duration without crossing the real stage boundary', () => {
    const expected = getScheduleProgressPercent(running, START + 30_000)
    const overdue = getScheduleProgressPercent(running, START + 60_000)
    expect(overdue).toBeGreaterThan(expected)
    expect(Math.round(getScheduleProgressPercent(running, START + 3_600_000))).toBeLessThan(68)
  })

  it('does not let a revised ETA change stage progress', () => {
    expect(getScheduleProgressPercent({ ...running, estimatedTotalMs: 1_000 }, START + 10_000))
      .toBe(getScheduleProgressPercent({ ...running, estimatedTotalMs: 100_000 }, START + 10_000))
  })

  it.each([
    { estimatePhase: 'failed' },
    { estimatePhase: 'cancelled' },
    { cancellationRequested: true },
    { executionPhase: 'retry_wait' },
    { connectionStatus: 'reconnecting' },
  ] satisfies Partial<ScheduleProgressState>[])('freezes progress for %j', (patch) => {
    const progress = { ...running, ...patch, lastUpdatedAt: START + 5_000 }
    expect(getScheduleProgressPercent(progress, START + 10_000))
      .toBe(getScheduleProgressPercent(progress, START + 60_000))
  })

  it('preserves the floor through stage regression and restoration', () => {
    expect(getScheduleProgressPercent({ ...running, percentFloor: 75 }, START)).toBe(75)
  })

  it('keeps retry polling from advancing a saved paused percentage', () => {
    const progress = { ...running, executionPhase: 'retry_wait' as const, percentFloor: 35 }
    expect(getScheduleProgressPercent({ ...progress, lastUpdatedAt: START + 10_000 }, START + 10_000)).toBe(35)
    expect(getScheduleProgressPercent({ ...progress, lastUpdatedAt: START + 60_000 }, START + 60_000)).toBe(35)
  })

  it('requires task completion even when the calculation stage has completed', () => {
    expect(getScheduleProgressPercent({ ...running, calculationStage: 'completed' }, START)).toBe(99)
    expect(getScheduleProgressPercent({ ...running, estimatePhase: 'completed' }, START)).toBe(100)
    expect(getScheduleProgressPercent({ ...running, completedAt: START }, START + 500)).toBe(100)
  })

  it('handles missing stage timestamps and invalid estimates without inventing stage elapsed time', () => {
    expect(getScheduleProgressPercent({ ...running, calculationStageUpdatedAt: null }, START + 60_000)).toBe(18)
    expect(Number.isFinite(getScheduleProgressPercent({
      ...running, calculationStage: null, estimatedTotalMs: Number.NaN, percentFloor: Number.NaN,
    }, START + 5_000))).toBe(true)
  })
})
