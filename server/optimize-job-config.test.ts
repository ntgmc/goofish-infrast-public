import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
  DEFAULT_OPTIMIZE_LOCAL_FALLBACK_CONCURRENCY,
  DEFAULT_OPTIMIZE_QUEUE_POLL_MS,
  DEFAULT_OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS,
  DEFAULT_OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS,
  DEFAULT_OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD,
  DEFAULT_OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD,
  DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS,
  DEFAULT_OPTIMIZE_WORKER_CLAIM_PRIORITY,
  DEFAULT_OPTIMIZE_WORKER_CONCURRENCY,
  DEFAULT_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB,
  getOptimizeGlobalWorkerConcurrency,
  getOptimizeJobMaxAttempts,
  getOptimizeLocalFallbackConcurrency,
  getOptimizeQueuePollMs,
  getOptimizeStatusQueuePickupGraceMs,
  getOptimizeWorkerAutoscalingConfiguration,
  getOptimizeWorkerClaimPriority,
  getOptimizeWorkerConfiguration,
  getOptimizeWorkerConcurrency,
  getOptimizeWorkerMaxOldSpaceMb,
  getOptimizeWorkerRuntimeConcurrency,
  MAX_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
  MAX_OPTIMIZE_JOB_ATTEMPTS,
  MAX_OPTIMIZE_WORKER_CLAIM_PRIORITY,
  MAX_OPTIMIZE_WORKER_CONCURRENCY,
  MAX_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB,
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
  it('derives the status pickup grace from the worker polling cadence', () => {
    expect(getOptimizeQueuePollMs({})).toBe(DEFAULT_OPTIMIZE_QUEUE_POLL_MS)
    expect(getOptimizeStatusQueuePickupGraceMs({})).toBe(5_000)
    expect(getOptimizeQueuePollMs({ OPTIMIZE_QUEUE_POLL_MS: '2000' })).toBe(2_000)
    expect(getOptimizeStatusQueuePickupGraceMs({ OPTIMIZE_QUEUE_POLL_MS: '2000' })).toBe(10_000)
  })

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

  it('keeps the combined service fallback at one execution thread', () => {
    expect(getOptimizeLocalFallbackConcurrency()).toBe(1)
    expect(DEFAULT_OPTIMIZE_LOCAL_FALLBACK_CONCURRENCY).toBe(1)
    expect(getOptimizeWorkerRuntimeConcurrency({
      NODE_ENV: 'production',
      APP_ROLE: 'all',
      OPTIMIZE_WORKER_AUTOSCALING_ENABLED: 'true',
      OPTIMIZE_WORKER_CONCURRENCY: '8',
    })).toBe(1)
    expect(getOptimizeWorkerRuntimeConcurrency({
      NODE_ENV: 'production',
      APP_ROLE: 'worker',
      OPTIMIZE_WORKER_AUTOSCALING_ENABLED: 'true',
      OPTIMIZE_WORKER_CONCURRENCY: '8',
    })).toBe(8)
  })

  it('defaults autoscaling to opt-in with safe queue thresholds', () => {
    expect(getOptimizeWorkerAutoscalingConfiguration({})).toEqual({
      enabled: false,
      scaleUpQueueThreshold: DEFAULT_OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD,
      scaleDownQueueThreshold: DEFAULT_OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD,
      scaleDownIdleMs: DEFAULT_OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS,
      intervalMs: DEFAULT_OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS,
    })
  })

  it('validates configured autoscaling thresholds and the enabled flag', () => {
    expect(getOptimizeWorkerAutoscalingConfiguration({
      OPTIMIZE_WORKER_AUTOSCALING_ENABLED: 'true',
      OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD: '5',
      OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD: '1',
      OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS: '600000',
      OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS: '15000',
    })).toEqual({
      enabled: true,
      scaleUpQueueThreshold: 5,
      scaleDownQueueThreshold: 1,
      scaleDownIdleMs: 600_000,
      intervalMs: 15_000,
    })
    expect(() => getOptimizeWorkerAutoscalingConfiguration({
      OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD: '4',
      OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD: '5',
    })).toThrow('must not exceed')
    expect(() => getOptimizeWorkerAutoscalingConfiguration({
      OPTIMIZE_WORKER_AUTOSCALING_ENABLED: 'yes',
    })).toThrow('must be true or false')
  })
})

describe('optimization worker claim priority', () => {
  it('defaults to zero and accepts a configured value', () => {
    expect(getOptimizeWorkerClaimPriority({})).toBe(DEFAULT_OPTIMIZE_WORKER_CLAIM_PRIORITY)
    expect(DEFAULT_OPTIMIZE_WORKER_CLAIM_PRIORITY).toBe(0)
    expect(getOptimizeWorkerClaimPriority({ OPTIMIZE_WORKER_CLAIM_PRIORITY: '10' })).toBe(10)
    expect(getOptimizeWorkerClaimPriority({ OPTIMIZE_WORKER_CLAIM_PRIORITY: String(MAX_OPTIMIZE_WORKER_CLAIM_PRIORITY) })).toBe(MAX_OPTIMIZE_WORKER_CLAIM_PRIORITY)
  })

  it('rejects invalid or unsafe claim priority values', () => {
    for (const value of ['invalid', '-1', '1.5', String(MAX_OPTIMIZE_WORKER_CLAIM_PRIORITY + 1)]) {
      expect(() => getOptimizeWorkerClaimPriority({ OPTIMIZE_WORKER_CLAIM_PRIORITY: value })).toThrow(/integer|between/)
    }
  })
})

describe('optimization worker max old space', () => {
  it('defaults to the V8 default (0) and accepts a configured value', () => {
    expect(getOptimizeWorkerMaxOldSpaceMb({})).toBe(DEFAULT_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB)
    expect(DEFAULT_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB).toBe(0)
    expect(getOptimizeWorkerMaxOldSpaceMb({ OPTIMIZE_WORKER_MAX_OLD_SPACE_MB: '0' })).toBe(0)
    expect(getOptimizeWorkerMaxOldSpaceMb({ OPTIMIZE_WORKER_MAX_OLD_SPACE_MB: '1536' })).toBe(1_536)
  })

  it('rejects invalid or unsafe max old space values', () => {
    for (const value of ['invalid', '-1', '1.5', String(MAX_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB + 1)]) {
      expect(() => getOptimizeWorkerMaxOldSpaceMb({ OPTIMIZE_WORKER_MAX_OLD_SPACE_MB: value })).toThrow(/integer|between/)
    }
  })
})
