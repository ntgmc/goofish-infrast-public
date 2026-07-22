import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
  DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS,
  getOptimizeGlobalWorkerConcurrency,
  getOptimizeJobMaxAttempts,
} from './optimize-job-config'

const originalGlobalWorkerConcurrency = process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY
const originalMaxAttempts = process.env.OPTIMIZE_JOB_MAX_ATTEMPTS

afterEach(() => {
  if (originalGlobalWorkerConcurrency === undefined) delete process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY
  else process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = originalGlobalWorkerConcurrency
  if (originalMaxAttempts === undefined) delete process.env.OPTIMIZE_JOB_MAX_ATTEMPTS
  else process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = originalMaxAttempts
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

  it('normalizes the configured maximum attempt count', () => {
    delete process.env.OPTIMIZE_JOB_MAX_ATTEMPTS
    expect(getOptimizeJobMaxAttempts()).toBe(DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS)

    process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = '4.8'
    expect(getOptimizeJobMaxAttempts()).toBe(4)

    process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = '0'
    expect(getOptimizeJobMaxAttempts()).toBe(1)

    process.env.OPTIMIZE_JOB_MAX_ATTEMPTS = 'invalid'
    expect(getOptimizeJobMaxAttempts()).toBe(DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS)
  })
})
