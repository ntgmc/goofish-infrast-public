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

  it('calculates ECS instance hours from a peak and valley schedule', () => {
    const config = { ...createDefaultServiceStatusCostConfig(), schedule_enabled: true, valley_worker_instances: 1, peak_windows: [{ start: '09:00', end: '18:00', worker_instances: 3 }] }
    expect(calculatePlannedDailyWorkerHours(config)).toBe(42)
    expect(calculateServiceStatusCostEstimate({ ...config, hourly_price_cny: 0.5 }, []).estimated_monthly_cost_cny).toBe(630)
  })

  it('represents a final peak window with browser-compatible midnight', () => {
    const config = { ...createDefaultServiceStatusCostConfig(), schedule_enabled: true, valley_worker_instances: 1, peak_windows: [{ start: '23:00', end: '00:00', worker_instances: 2 }] }
    expect(calculatePlannedDailyWorkerHours(config)).toBe(25)
    const recommendation = recommendServiceStatusCostPlan([
      { component_id: 'optimization' as const, bucket_start: '2026-08-08T15:00:00.000Z', status: 'congested' as const, sample_count: 12, availability_percent: 50, busy_samples: 0, congested_samples: 6, average_active_concurrency: 2, average_provisioned_concurrency: 2, average_worker_instances: 1, average_utilization_percent: 100, peak_queued: 8, peak_running: 2, peak_worker_instances: 1, unavailable_samples: 0 },
    ], createDefaultServiceStatusCostConfig(), '2026-08-09T00:00:00.000Z')
    expect(recommendation.valley_worker_instances).toBe(1)
    expect(recommendation.peak_windows).toContainEqual({ start: '23:00', end: '00:00', worker_instances: 2 })
  })

  it('recommends extra instances for historical queue pressure by local hour', () => {
    const config = createDefaultServiceStatusCostConfig()
    const buckets = [
      { component_id: 'optimization' as const, bucket_start: '2026-08-08T01:00:00.000Z', status: 'available' as const, sample_count: 12, availability_percent: 100, busy_samples: 0, congested_samples: 0, average_active_concurrency: 1, average_provisioned_concurrency: 3, average_worker_instances: 1, average_utilization_percent: 33, peak_queued: 0, peak_running: 1, peak_worker_instances: 1, unavailable_samples: 0 },
      { component_id: 'optimization' as const, bucket_start: '2026-08-08T09:00:00.000Z', status: 'congested' as const, sample_count: 12, availability_percent: 50, busy_samples: 0, congested_samples: 6, average_active_concurrency: 3, average_provisioned_concurrency: 3, average_worker_instances: 1, average_utilization_percent: 100, peak_queued: 8, peak_running: 3, peak_worker_instances: 1, unavailable_samples: 0 },
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
    const first = aggregateServiceStatusSample(null, {
      componentId: 'optimization', bucketStart: '2026-08-08T01:00:00.000Z', status: 'available', queued: 0, running: 1, workerConcurrency: 3, workerInstances: 1, sampledAt: '2026-08-08T01:01:00.000Z',
    })
    const merged = aggregateServiceStatusSample(first, {
      componentId: 'optimization', bucketStart: '2026-08-08T01:00:00.000Z', status: 'unavailable', queued: 8, running: 0, workerConcurrency: 0, workerInstances: 0, sampledAt: '2026-08-08T01:06:00.000Z',
    })
    expect(historyBucketFromAggregate(merged)).toMatchObject({ status: 'unavailable', sample_count: 2, availability_percent: 50, peak_queued: 8, unavailable_samples: 1 })
  })
})
