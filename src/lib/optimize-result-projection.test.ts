import { describe, expect, it } from 'vitest'
import type { OptimizeResult } from './types'
import { projectOptimizeResultForCapabilities } from './optimize-result-projection'

describe('projectOptimizeResultForCapabilities', () => {
  it('removes full data, raw results, diagnostics, and suggestions for recommended profiles', () => {
    const projected = projectOptimizeResultForCapabilities(result(), {
      kind: 'cdk',
      permission: 'recommended',
    })

    expect(projected).toMatchObject({ title: '测试结果', plans: expect.any(Array), raw_results: [] })
    expect(projected).not.toHaveProperty('daily_production')
    expect(projected).not.toHaveProperty('total_efficiency')
    expect(projected).not.toHaveProperty('search_nodes')
    expect(projected).not.toHaveProperty('build_meta')
    expect(projected).not.toHaveProperty('upgrade_suggestions')
  })

  it('keeps upgrade suggestions for growth profiles while hiding full and raw data', () => {
    const projected = projectOptimizeResultForCapabilities(result(), {
      kind: 'cdk',
      permission: 'growth',
    })

    expect(projected.raw_results).toEqual([])
    expect(projected).not.toHaveProperty('daily_production')
    expect(projected.upgrade_suggestions).toHaveLength(1)
    expect(projected.upgrade_suggestions_status).toBe('completed')
  })

  it('keeps the complete result for advanced profiles', () => {
    const input = result()
    const projected = projectOptimizeResultForCapabilities(input, {
      kind: 'cdk',
      permission: 'advanced',
    })

    expect(projected).toBe(input)
    expect(projected.raw_results).toHaveLength(1)
    expect(projected.daily_production).toBeDefined()
    expect(projected.build_meta).toBeDefined()
  })
})

function result(): OptimizeResult {
  return {
    author: '测试',
    title: '测试结果',
    description: '结果说明',
    buildingType: 253,
    planTimes: '1 班',
    plans: [{ name: '第 1 班', rooms: {} }],
    raw_results: [{ total_efficiency: 100, assignment_detail: [] }],
    daily_production: { manufacturing: { LMD: 1000 } },
    total_efficiency: 100,
    search_nodes: 42,
    upgrade_suggestions: [{ type: 'single', name: '测试建议', current: 1, target: 2, gain: 10 }],
    upgrade_suggestions_status: 'completed',
    build_meta: {
      frontend_version: 'test',
      backend_version: 'test',
      data_version: 'test',
      generated_at: '2026-08-02T00:00:00.000Z',
      source_summary: 'test',
    },
  }
}
