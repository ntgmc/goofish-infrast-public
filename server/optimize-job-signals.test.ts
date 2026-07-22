import { describe, expect, it, vi } from 'vitest'
import {
  registerOptimizeJobSignalHandlers,
  requestOptimizeJobCancellation,
  requestOptimizeJobProcessing,
} from './optimize-job-signals'

describe('optimize job signals', () => {
  it('ignores requests when no worker handlers are registered', () => {
    expect(() => requestOptimizeJobProcessing()).not.toThrow()
    expect(() => requestOptimizeJobCancellation('job-1')).not.toThrow()
  })

  it('forwards requests to the registered handlers', () => {
    const onProcessingRequested = vi.fn()
    const onCancellationRequested = vi.fn()
    const unregister = registerOptimizeJobSignalHandlers({
      onProcessingRequested,
      onCancellationRequested,
    })

    requestOptimizeJobProcessing()
    requestOptimizeJobCancellation('job-1')

    expect(onProcessingRequested).toHaveBeenCalledOnce()
    expect(onCancellationRequested).toHaveBeenCalledWith('job-1')
    unregister()
  })

  it('restores no-op behavior when the active registration is removed', () => {
    const onProcessingRequested = vi.fn()
    const unregister = registerOptimizeJobSignalHandlers({
      onProcessingRequested,
      onCancellationRequested: vi.fn(),
    })

    unregister()
    requestOptimizeJobProcessing()

    expect(onProcessingRequested).not.toHaveBeenCalled()
  })

  it('does not let a stale unregister callback clear a newer registration', () => {
    const firstProcessingHandler = vi.fn()
    const secondProcessingHandler = vi.fn()
    const unregisterFirst = registerOptimizeJobSignalHandlers({
      onProcessingRequested: firstProcessingHandler,
      onCancellationRequested: vi.fn(),
    })
    const unregisterSecond = registerOptimizeJobSignalHandlers({
      onProcessingRequested: secondProcessingHandler,
      onCancellationRequested: vi.fn(),
    })

    unregisterFirst()
    requestOptimizeJobProcessing()

    expect(firstProcessingHandler).not.toHaveBeenCalled()
    expect(secondProcessingHandler).toHaveBeenCalledOnce()
    unregisterSecond()
  })
})
