import { describe, expect, it } from 'vitest'
import {
  aggregateServiceStatusSample,
  floorStatusTimestampToHour,
  historyBucketFromAggregate,
  mergeServiceStatusLevels,
  resolveOptimizationCostInputs,
  resolveOptimizationServiceStatus,
} from './service-status'

describe('service status rules', () => {
  it('uses deep green when workers have spare concurrency and no waiting jobs', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 0, running: 1, workerConcurrency: 3, workerInstances: 1 })).toBe('available')
  })

  it('uses green for a small waiting queue', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 4, running: 3, workerConcurrency: 3, workerInstances: 1 })).toBe('busy')
  })

  it('uses yellow when five or more jobs are waiting', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 5, running: 3, workerConcurrency: 3, workerInstances: 1 })).toBe('congested')
  })

  it('uses red when the service or worker capacity is unavailable', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: false, queued: 0, running: 0, workerConcurrency: 3, workerInstances: 1 })).toBe('unavailable')
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 0, running: 0, workerConcurrency: 0, workerInstances: 0 })).toBe('unavailable')
  })

  it('returns bounded concurrency inputs for cost calculations', () => {
    expect(resolveOptimizationCostInputs(2, 3)).toEqual({ activeConcurrency: 2, provisionedConcurrency: 3, idleConcurrency: 1, utilizationPercent: 67 })
    expect(resolveOptimizationCostInputs(4, 0)).toEqual({ activeConcurrency: 4, provisionedConcurrency: 0, idleConcurrency: 0, utilizationPercent: 0 })
  })

  it('normalizes samples to UTC hours and keeps the worst observed level', () => {
    expect(floorStatusTimestampToHour('2026-08-08T09:59:59+08:00')).toBe('2026-08-08T01:00:00.000Z')
    expect(mergeServiceStatusLevels('available', 'congested')).toBe('congested')
    expect(mergeServiceStatusLevels('congested', 'available')).toBe('congested')
    const first = aggregateServiceStatusSample(null, {
      componentId: 'optimization', bucketStart: '2026-08-08T01:00:00.000Z', status: 'available', queued: 0, running: 1, workerConcurrency: 3, workerInstances: 1, sampledAt: '2026-08-08T01:01:00.000Z',
    })
    const merged = aggregateServiceStatusSample(first, {
      componentId: 'optimization', bucketStart: '2026-08-08T01:00:00.000Z', status: 'unavailable', queued: 8, running: 0, workerConcurrency: 0, workerInstances: 0, sampledAt: '2026-08-08T01:06:00.000Z',
    })
    expect(historyBucketFromAggregate(merged)).toMatchObject({ status: 'unavailable', sample_count: 2, availability_percent: 50, peak_queued: 8, unavailable_samples: 1 })
  })
})
