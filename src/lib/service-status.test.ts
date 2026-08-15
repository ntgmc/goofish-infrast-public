import { describe, expect, it } from 'vitest'
import {
  aggregateServiceStatusSample,
  floorStatusTimestampToHour,
  historyBucketFromAggregate,
  mergeServiceStatusLevels,
  resolveOptimizationCostInputs,
  resolveOptimizationServiceStatus,
  createDefaultServiceStatusCostConfig,
} from './service-status'
import { calculatePlannedDailyWorkerHours, calculateServiceStatusCostEstimate, recommendServiceStatusCostPlan } from './service-status-cost'

describe('service status rules', () => {
  it('uses deep green when workers have spare concurrency and no waiting jobs', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 0, running: 1, workerConcurrency: 3, workerInstances: 1 })).toBe('available')
  })

  it('uses green for a small waiting queue', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 4, running: 3, workerConcurrency: 3, workerInstances: 1 })).toBe('busy')
  })

  it('keeps a newly ready small queue available during the worker pickup window', () => {
    const base = {
      serviceReady: true,
      queued: 1,
      readyQueued: 1,
      running: 0,
      workerConcurrency: 3,
      workerInstances: 1,
      queuePickupGraceMs: 5_000,
    }
    expect(resolveOptimizationServiceStatus({ ...base, oldestReadyQueuedWaitMs: 4_999 })).toBe('available')
    expect(resolveOptimizationServiceStatus({ ...base, oldestReadyQueuedWaitMs: 5_000 })).toBe('busy')
  })

  it('ignores retry backoff rows that are not ready for a worker', () => {
    expect(resolveOptimizationServiceStatus({
      serviceReady: true,
      queued: 1,
      readyQueued: 0,
      oldestReadyQueuedWaitMs: null,
      queuePickupGraceMs: 5_000,
      running: 0,
      workerConcurrency: 3,
      workerInstances: 1,
    })).toBe('available')
  })

  it('still reports busy when all capacity is occupied during pickup grace', () => {
    expect(resolveOptimizationServiceStatus({
      serviceReady: true,
      queued: 1,
      readyQueued: 1,
      oldestReadyQueuedWaitMs: 1_000,
      queuePickupGraceMs: 5_000,
      running: 3,
      workerConcurrency: 3,
      workerInstances: 1,
    })).toBe('busy')
  })

  it('uses yellow when five through twenty jobs are waiting', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 5, running: 3, workerConcurrency: 3, workerInstances: 1 })).toBe('congested')
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 20, running: 3, workerConcurrency: 3, workerInstances: 1 })).toBe('congested')
  })

  it('uses the scaling state while an enabled autoscaler is consuming its queue', () => {
    const autoscaling = { enabled: true, scaleUpQueueThreshold: 4 }
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 5, running: 3, workerConcurrency: 3, workerInstances: 1, autoscaling })).toBe('scaling')
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 4, running: 3, workerConcurrency: 3, workerInstances: 1, autoscaling })).toBe('busy')
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 21, running: 3, workerConcurrency: 3, workerInstances: 1, autoscaling })).toBe('overloaded')
  })

  it('uses orange when more than twenty jobs are waiting', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 21, running: 3, workerConcurrency: 3, workerInstances: 1 })).toBe('overloaded')
  })

  it('uses red when the service or worker capacity is unavailable', () => {
    expect(resolveOptimizationServiceStatus({ serviceReady: false, queued: 0, running: 0, workerConcurrency: 3, workerInstances: 1 })).toBe('unavailable')
    expect(resolveOptimizationServiceStatus({ serviceReady: true, queued: 0, running: 0, workerConcurrency: 0, workerInstances: 0 })).toBe('unavailable')
  })

  it('returns bounded concurrency inputs for cost calculations', () => {
    expect(resolveOptimizationCostInputs(2, 3)).toEqual({ activeConcurrency: 2, provisionedConcurrency: 3, idleConcurrency: 1, utilizationPercent: 67 })
    expect(resolveOptimizationCostInputs(4, 0)).toEqual({ activeConcurrency: 4, provisionedConcurrency: 0, idleConcurrency: 0, utilizationPercent: 0 })
  })

  it('calculates ECS instance hours from a peak and valley schedule', () => {
    const config = { ...createDefaultServiceStatusCostConfig(), schedule_enabled: true, valley_worker_instances: 1, peak_windows: [{ start: '09:00', end: '18:00', worker_instances: 3 }] }
    expect(calculatePlannedDailyWorkerHours(config)).toBe(42)
    expect(calculateServiceStatusCostEstimate({ ...config, hourly_price_cny: 0.5 }, []).estimated_monthly_cost_cny).toBe(630)
  })

  it('keeps observed cost windows bounded when recent hourly samples are sparse', () => {
    const config = { ...createDefaultServiceStatusCostConfig(), hourly_price_cny: 0.5 }
    const buckets = Array.from({ length: 26 }, (_, index) => ({
      component_id: 'optimization' as const,
      bucket_start: new Date(Date.UTC(2026, 7, 1, index)).toISOString(),
      status: 'unknown' as const,
      sample_count: index === 0 || index === 25 ? 12 : 0,
      availability_percent: null,
      busy_samples: 0,
      congested_samples: 0,
      overloaded_samples: 0,
      average_active_concurrency: null,
      average_provisioned_concurrency: null,
      average_worker_instances: index === 0 || index === 25 ? 1 : null,
      average_utilization_percent: null,
      peak_queued: null,
      peak_running: null,
      peak_worker_instances: null,
      unavailable_samples: 0,
    }))
    const estimate = calculateServiceStatusCostEstimate(config, buckets)
    expect(estimate.observed_24h_worker_hours).toBe(1)
    expect(estimate.observed_24h_sample_hours).toBe(1)
    expect(estimate.observed_24h_cost_cny).toBe(0.5)
  })

  it('represents a final peak window with browser-compatible midnight', () => {
    const config = { ...createDefaultServiceStatusCostConfig(), schedule_enabled: true, valley_worker_instances: 1, peak_windows: [{ start: '23:00', end: '00:00', worker_instances: 2 }] }
    expect(calculatePlannedDailyWorkerHours(config)).toBe(25)
    const recommendation = recommendServiceStatusCostPlan([
      { component_id: 'optimization' as const, bucket_start: '2026-08-08T15:00:00.000Z', status: 'congested' as const, sample_count: 12, availability_percent: 50, busy_samples: 0, congested_samples: 6, overloaded_samples: 0, average_active_concurrency: 2, average_provisioned_concurrency: 2, average_worker_instances: 1, average_utilization_percent: 100, peak_queued: 8, peak_running: 2, peak_worker_instances: 1, unavailable_samples: 0 },
    ], createDefaultServiceStatusCostConfig(), '2026-08-09T00:00:00.000Z')
    expect(recommendation.valley_worker_instances).toBe(1)
    expect(recommendation.peak_windows).toContainEqual({ start: '23:00', end: '00:00', worker_instances: 2 })
  })

  it('recommends extra instances for historical queue pressure by local hour', () => {
    const config = createDefaultServiceStatusCostConfig()
    const buckets = [
      { component_id: 'optimization' as const, bucket_start: '2026-08-08T01:00:00.000Z', status: 'available' as const, sample_count: 12, availability_percent: 100, busy_samples: 0, congested_samples: 0, overloaded_samples: 0, average_active_concurrency: 1, average_provisioned_concurrency: 3, average_worker_instances: 1, average_utilization_percent: 33, peak_queued: 0, peak_running: 1, peak_worker_instances: 1, unavailable_samples: 0 },
      { component_id: 'optimization' as const, bucket_start: '2026-08-08T09:00:00.000Z', status: 'congested' as const, sample_count: 12, availability_percent: 50, busy_samples: 0, congested_samples: 6, overloaded_samples: 0, average_active_concurrency: 3, average_provisioned_concurrency: 3, average_worker_instances: 1, average_utilization_percent: 100, peak_queued: 8, peak_running: 3, peak_worker_instances: 1, unavailable_samples: 0 },
    ]
    const recommendation = recommendServiceStatusCostPlan(buckets, config, '2026-08-09T00:00:00.000Z')
    expect(recommendation.source_sample_count).toBe(24)
    expect(recommendation.confidence).toBe('limited')
    expect(recommendation.hourly_worker_instances[17]).toBe(2)
    expect(recommendation.peak_windows).toContainEqual({ start: '17:00', end: '18:00', worker_instances: 2 })
  })

  it('normalizes samples to UTC hours and keeps the worst observed level', () => {
    expect(floorStatusTimestampToHour('2026-08-08T09:59:59+08:00')).toBe('2026-08-08T01:00:00.000Z')
    expect(mergeServiceStatusLevels('available', 'congested')).toBe('congested')
    expect(mergeServiceStatusLevels('congested', 'available')).toBe('congested')
    expect(mergeServiceStatusLevels('congested', 'overloaded')).toBe('overloaded')
    const first = aggregateServiceStatusSample(null, {
      componentId: 'optimization', bucketStart: '2026-08-08T01:00:00.000Z', status: 'available', queued: 0, running: 1, workerConcurrency: 3, workerInstances: 1, sampledAt: '2026-08-08T01:01:00.000Z',
    })
    const overloaded = aggregateServiceStatusSample(first, {
      componentId: 'optimization', bucketStart: '2026-08-08T01:00:00.000Z', status: 'overloaded', queued: 21, running: 3, workerConcurrency: 3, workerInstances: 1, sampledAt: '2026-08-08T01:03:00.000Z',
    })
    expect(historyBucketFromAggregate(overloaded)).toMatchObject({ status: 'overloaded', sample_count: 2, overloaded_samples: 1, peak_queued: 21 })
    const merged = aggregateServiceStatusSample(overloaded, {
      componentId: 'optimization', bucketStart: '2026-08-08T01:00:00.000Z', status: 'unavailable', queued: 8, running: 0, workerConcurrency: 0, workerInstances: 0, sampledAt: '2026-08-08T01:06:00.000Z',
    })
    expect(historyBucketFromAggregate(merged)).toMatchObject({ status: 'unavailable', sample_count: 3, availability_percent: 33.33, peak_queued: 21, unavailable_samples: 1, overloaded_samples: 1 })
  })

  it('counts scaling samples as available while preserving a scaling diagnostic count', () => {
    const aggregate = aggregateServiceStatusSample(null, {
      componentId: 'optimization', bucketStart: '2026-08-08T02:00:00.000Z', status: 'scaling', queued: 5, running: 3, workerConcurrency: 3, workerInstances: 1, sampledAt: '2026-08-08T02:01:00.000Z',
    })
    expect(historyBucketFromAggregate(aggregate)).toMatchObject({ status: 'scaling', sample_count: 1, availability_percent: 100, scaling_samples: 1, unavailable_samples: 0 })
  })
})
