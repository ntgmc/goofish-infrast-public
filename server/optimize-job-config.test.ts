import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
  getOptimizeGlobalWorkerConcurrency,
} from './optimize-job-config'

const originalGlobalWorkerConcurrency = process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY

afterEach(() => {
  if (originalGlobalWorkerConcurrency === undefined) delete process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY
  else process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = originalGlobalWorkerConcurrency
})

describe('optimization job configuration', () => {
  it('defaults the global worker concurrency to the production capacity', () => {
    delete process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY

    expect(getOptimizeGlobalWorkerConcurrency()).toBe(DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY)
    expect(DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY).toBe(3)
  })

  it('uses a valid configured global worker concurrency', () => {
    process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = '5'

    expect(getOptimizeGlobalWorkerConcurrency()).toBe(5)
  })

  it('falls back to the production capacity for an invalid value', () => {
    process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = 'invalid'

    expect(getOptimizeGlobalWorkerConcurrency()).toBe(3)
  })
})
