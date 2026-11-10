// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ScheduleProgressState } from '../../components/ScheduleProgress'
import V2GenerationProgress from './V2GenerationProgress'

const preferences = vi.hoisted(() => ({ reduced: false }))
vi.mock('../../lib/motion-preference', () => ({ useAppReducedMotion: () => preferences.reduced }))
afterEach(() => { cleanup(); vi.useRealTimers(); preferences.reduced = false })
const running: ScheduleProgressState = { mode: 'generate', jobId: 'first', startedAt: Date.now(), queueStatus: 'running', calculationStage: 'generating_schedule' }

it('keeps completion alongside the ready result, then releases the card without hiding a new task', async () => {
  vi.useFakeTimers()
  const view = render(<V2GenerationProgress progress={running} resultReady />)
  const completed = { ...running, estimatePhase: 'completed' as const, completedAt: Date.now() }
  view.rerender(<V2GenerationProgress progress={completed} resultReady><button>View result</button></V2GenerationProgress>)
  expect(screen.getByRole('button', { name: 'View result' })).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('排班方案已就绪')
  await act(async () => vi.advanceTimersByTimeAsync(500))
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await act(async () => vi.advanceTimersByTimeAsync(300))
  view.rerender(<V2GenerationProgress progress={{ ...running, jobId: 'second' }} resultReady />)
  await act(async () => vi.advanceTimersByTimeAsync(1_000))
  expect(screen.getByRole('status')).toHaveTextContent('正在计算当前排班')
})

it('retains completion until the result is ready and keeps failed and cancelled tasks visible', async () => {
  vi.useFakeTimers()
  const view = render(<V2GenerationProgress progress={{ ...running, estimatePhase: 'completed', completedAt: Date.now() }} resultReady={false} />)
  await act(async () => vi.advanceTimersByTimeAsync(2_000))
  expect(screen.getByRole('status')).toHaveTextContent('排班方案已就绪')
  for (const estimatePhase of ['failed', 'cancelled'] as const) {
    view.rerender(<V2GenerationProgress progress={{ ...running, estimatePhase }} resultReady />)
    await act(async () => vi.advanceTimersByTimeAsync(2_000))
    expect(screen.getByRole('region')).toHaveAttribute('data-status', estimatePhase)
  }
})

it('shows the ready result immediately under reduced motion', () => {
  preferences.reduced = true
  render(<V2GenerationProgress progress={{ ...running, estimatePhase: 'completed', completedAt: Date.now() }} resultReady><button>View result</button></V2GenerationProgress>)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByRole('button')).toBeEnabled()
})
