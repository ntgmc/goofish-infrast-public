import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
  DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS,
  DEFAULT_OPTIMIZE_WORKER_CONCURRENCY,
  getOptimizeGlobalWorkerConcurrency,
  getOptimizeJobMaxAttempts,
  getOptimizeWorkerConfiguration,
  getOptimizeWorkerConcurrency,
  MAX_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
  MAX_OPTIMIZE_JOB_ATTEMPTS,
  MAX_OPTIMIZE_WORKER_CONCURRENCY,
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

  it('rejects invalid or unsafe concurrency values', () => {
    for (const value of ['invalid', '0', '1.5', String(MAX_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY + 1)]) {
      expect(() => getOptimizeGlobalWorkerConcurrency({ OPTIMIZE_GLOBAL_WORKER_CONCURRENCY: value })).toThrow(/integer between/)
    }
    expect(getOptimizeWorkerConcurrency({})).toBe(DEFAULT_OPTIMIZE_WORKER_CONCURRENCY)
    expect(() => getOptimizeWorkerConcurrency({
      OPTIMIZE_WORKER_CONCURRENCY: String(MAX_OPTIMIZE_WORKER_CONCURRENCY + 1),
    })).toThrow(/integer between/)
  })

  it('rejects invalid maximum attempts instead of silently normalizing them', () => {
    delete process.env.OPTIMIZE_JOB_MAX_ATTEMPTS
    expect(getOptimizeJobMaxAttempts()).toBe(DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS)

    for (const value of ['4.8', '0', String(MAX_OPTIMIZE_JOB_ATTEMPTS + 1), 'invalid']) {
      expect(() => getOptimizeJobMaxAttempts({ OPTIMIZE_JOB_MAX_ATTEMPTS: value })).toThrow(/integer between/)
    }
  })

  it('requires local concurrency not to exceed global capacity', () => {
    expect(() => getOptimizeWorkerConfiguration({
      OPTIMIZE_WORKER_CONCURRENCY: '4',
      OPTIMIZE_GLOBAL_WORKER_CONCURRENCY: '3',
    })).toThrow('OPTIMIZE_WORKER_CONCURRENCY must not exceed OPTIMIZE_GLOBAL_WORKER_CONCURRENCY')
  })
})
