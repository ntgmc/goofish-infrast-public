import { describe, expect, it } from 'vitest'
import { resolveOptimizationCostInputs, resolveOptimizationServiceStatus } from './service-status'

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
})
