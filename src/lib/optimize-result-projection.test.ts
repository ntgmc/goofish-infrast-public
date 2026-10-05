import { describe, expect, it } from 'vitest'
import type { OptimizeResult } from './types'
import { projectOptimizeResultForCapabilities } from './optimize-result-projection'

describe('projectOptimizeResultForCapabilities', () => {
  it('preserves recorded search states in free preview and JSON history round trips', () => {
    const stored = JSON.parse(JSON.stringify(result())) as OptimizeResult
    const projected = projectOptimizeResultForCapabilities(stored, { kind: 'free_preview' })
    expect(projected.searched_state_count).toBe(123456)
    expect(projected).not.toHaveProperty('search_nodes')
  })

  it('returns free-preview totals without calculation details through repeated projection', () => {
    const input = result()
    input.daily_production = {
      hours: 24, manufacturing: { 'Pure Gold': 100, 'Battle Record': 30 },
      trading: { LMD: 50000 }, consumption: { 'Pure Gold': 100 }, net: { 'Pure Gold': 0 },
      details: [{ secretCalculation: 'room-breakdown' }],
      dynamic_resource_details: [{ secretCalculation: 'dynamic-breakdown' }],
    }
    const projected = projectOptimizeResultForCapabilities(input, { kind: 'free_preview', permission: 'recommended' })
    expect(projected.daily_production).toEqual({
      hours: 24, manufacturing: input.daily_production.manufacturing, trading: input.daily_production.trading,
      consumption: input.daily_production.consumption, net: input.daily_production.net,
    })
    expect(projected.total_efficiency).toBe(100)
    expect(projected.raw_results).toEqual([])
    expect(projectOptimizeResultForCapabilities(projected, { kind: 'free_preview', permission: 'growth' })).toEqual(projected)
    expect(input.daily_production.details).toHaveLength(1)
  })
  it('removes full data, raw results, diagnostics, and suggestions for recommended profiles', () => {
    const projected = projectOptimizeResultForCapabilities(result(), {
      kind: 'cdk',
      permission: 'recommended',
    })

    expect(projected).toMatchObject({ title: '测试结果', plans: expect.any(Array), raw_results: [] })
    expect(projected).not.toHaveProperty('daily_production')
    expect(projected).not.toHaveProperty('total_efficiency')
    expect(projected).not.toHaveProperty('search_nodes')
    expect(projected.searched_state_count).toBe(123456)
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

  it.each(['recommended', 'growth'] as const)('keeps actionable inventory warnings for %s profiles through repeated projection', (permission) => {
    const input = {
      ...result(),
      inventory_warnings: [{ product: 'Pure Gold' as const, days_remaining: 0 }],
      intermediate_depletion: [{ product: 'Pure Gold' as const, stock: 0, net_per_day: -40, days_remaining: 0 }],
    }
    for (const kind of ['cdk', 'free_preview'] as const) {
      const projected = projectOptimizeResultForCapabilities(input, { kind, permission })
      expect(projected.inventory_warnings).toEqual(input.inventory_warnings)
      expect(projected.intermediate_depletion).toBeUndefined()
      expect(projectOptimizeResultForCapabilities(projected, { kind, permission })).toEqual(projected)
    }
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
    expect(projected.searched_state_count).toBe(123456)
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
    searched_state_count: 123456,
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
