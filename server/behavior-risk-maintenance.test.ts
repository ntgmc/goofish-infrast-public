import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runBehaviorRiskEvaluation = vi.hoisted(() => vi.fn())
const purgeExpiredBehaviorRiskData = vi.hoisted(() => vi.fn())

vi.mock('./storage/behavior-risk-store', () => ({ purgeExpiredBehaviorRiskData, runBehaviorRiskEvaluation }))

import { initializeBehaviorRiskMaintenance, shutdownBehaviorRiskMaintenance } from './behavior-risk-maintenance'

beforeEach(() => {
  runBehaviorRiskEvaluation.mockReset()
  purgeExpiredBehaviorRiskData.mockReset().mockResolvedValue({ status: 'success', purgedEvents: 0, purgedCases: 0 })
})

afterEach(() => {
  shutdownBehaviorRiskMaintenance()
  vi.restoreAllMocks()
})

describe('behavior risk maintenance lifecycle', () => {
  it('waits for the initial evaluation before becoming initialized', async () => {
    let release: (value: unknown) => void = () => undefined
    runBehaviorRiskEvaluation.mockImplementation(() => new Promise((resolve) => { release = resolve }))

    const initialization = initializeBehaviorRiskMaintenance()
    await Promise.resolve()
    expect(runBehaviorRiskEvaluation).toHaveBeenCalledOnce()
    release({ status: 'success', cases: 0, eventsProcessed: 0, backlog: 0 })

    await expect(initialization).resolves.toBeUndefined()
  })

  it('rejects initialization when the initial evaluation fails', async () => {
    const error = Object.assign(new Error('statement timed out'), { code: '57014' })
    runBehaviorRiskEvaluation.mockRejectedValue(error)

    await expect(initializeBehaviorRiskMaintenance()).rejects.toBe(error)
  })
})
