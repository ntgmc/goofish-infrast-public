import { describe, expect, it, vi } from 'vitest'
import { resolveProcessShutdownDeadlineMs, scheduleProcessHardExit } from './process-shutdown-deadline'

describe('process shutdown deadline', () => {
  it('validates the total process shutdown deadline', () => {
    expect(resolveProcessShutdownDeadlineMs({})).toBe(65_000)
    expect(resolveProcessShutdownDeadlineMs({ PROCESS_SHUTDOWN_DEADLINE_MS: '5000' })).toBe(5_000)
    expect(() => resolveProcessShutdownDeadlineMs({ PROCESS_SHUTDOWN_DEADLINE_MS: '4999' })).toThrow(/integer between/)
  })

  it('forces exit after the second-signal deadline and can be cancelled', () => {
    vi.useFakeTimers()
    const exit = vi.fn()
    try {
      const cancel = scheduleProcessHardExit(true, exit as never)
      vi.advanceTimersByTime(999)
      expect(exit).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(exit).toHaveBeenCalledWith(1)

      exit.mockClear()
      const cancelBeforeDeadline = scheduleProcessHardExit(true, exit as never)
      cancelBeforeDeadline()
      vi.advanceTimersByTime(1_000)
      expect(exit).not.toHaveBeenCalled()
      cancel()
    } finally {
      vi.useRealTimers()
    }
  })
})
