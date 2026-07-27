import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runBehaviorRiskEvaluation = vi.hoisted(() => vi.fn())

vi.mock('./storage/behavior-risk-store', () => ({ runBehaviorRiskEvaluation }))

import { initializeBehaviorRiskMaintenance, shutdownBehaviorRiskMaintenance } from './behavior-risk-maintenance'

beforeEach(() => {
  runBehaviorRiskEvaluation.mockReset()
})

afterEach(() => {
  shutdownBehaviorRiskMaintenance()
  vi.restoreAllMocks()
})

describe('behavior risk maintenance lifecycle', () => {
  it('does not block worker initialization on a pending evaluation', async () => {
    runBehaviorRiskEvaluation.mockImplementation(() => new Promise(() => undefined))

    await expect(initializeBehaviorRiskMaintenance()).resolves.toBeUndefined()
    await initializeBehaviorRiskMaintenance()

    expect(runBehaviorRiskEvaluation).toHaveBeenCalledOnce()
  })

  it('logs rejected background evaluations without rejecting initialization', async () => {
    const error = Object.assign(new Error('statement timed out'), { code: '57014' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    runBehaviorRiskEvaluation.mockRejectedValue(error)

    await expect(initializeBehaviorRiskMaintenance()).resolves.toBeUndefined()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[behavior-risk] daily maintenance skipped after \d+ms code=57014:$/),
      'statement timed out',
    ))
  })
})
