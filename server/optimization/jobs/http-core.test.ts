import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS } from '../../../src/lib/config'
import type { OptimizeConfigPermission } from './shared'
import { sanitizeConfigForPublicOptimize } from './http-core'

describe('sanitizeConfigForPublicOptimize layout cost policy', () => {
  it.each<OptimizeConfigPermission>(['free_preview', 'recommended', 'growth', 'advanced', 'ultimate', 'admin'])(
    'forces non-243/333 layouts to fast mode for %s',
    (permission) => {
      const sanitized = sanitizeConfigForPublicOptimize({
        ...CONFIG_PRESETS['243'],
        layout: '1-5-3',
        trading_stations_count: 1,
        manufacturing_stations_count: 5,
        optimization_mode: 'exact',
        optimizer_search: { optimization_mode: 'exact', beam: true },
      }, permission)

      expect(sanitized.optimization_mode).toBe('fast')
      expect(sanitized.optimizer_search).toMatchObject({ optimization_mode: 'fast', beam: true })
      expect(sanitized.Fiammetta?.candidate_mode).toBe('fast')
    },
  )

  it.each([
    ['243', CONFIG_PRESETS['243']],
    ['333', CONFIG_PRESETS['333']],
  ])('preserves exact mode for %s', (_name, preset) => {
    const sanitized = sanitizeConfigForPublicOptimize({
      ...preset,
      optimization_mode: 'exact',
      optimizer_search: { optimization_mode: 'exact', beam: true },
    }, 'advanced')

    expect(sanitized.optimization_mode).toBe('exact')
    expect(sanitized.optimizer_search).toEqual({ optimization_mode: 'exact', beam: true })
  })

  it('uses station counts instead of a stale layout label', () => {
    const sanitized = sanitizeConfigForPublicOptimize({
      ...CONFIG_PRESETS['243'],
      layout: '2-4-3',
      trading_stations_count: 1,
      manufacturing_stations_count: 5,
      optimization_mode: 'exact',
    }, 'advanced')

    expect(sanitized.optimization_mode).toBe('fast')
  })

  it('preserves explicit beam false for non-243/333 layouts', () => {
    const sanitized = sanitizeConfigForPublicOptimize({
      ...CONFIG_PRESETS['243'],
      layout: '1-5-3',
      trading_stations_count: 1,
      manufacturing_stations_count: 5,
      optimization_mode: 'exact',
      optimizer_search: { optimization_mode: 'exact', beam: false },
    }, 'advanced')

    expect(sanitized.optimization_mode).toBe('fast')
    expect(sanitized.optimizer_search).toEqual({ optimization_mode: 'fast', beam: false })
  })

  it('forces a 063 layout to fast beam mode', () => {
    const sanitized = sanitizeConfigForPublicOptimize({
      ...CONFIG_PRESETS['243'],
      layout: '0-6-3',
      trading_stations_count: 0,
      manufacturing_stations_count: 6,
      optimization_mode: 'exact',
      optimizer_search: { optimization_mode: 'exact', beam: true },
    }, 'admin')

    expect(sanitized.optimization_mode).toBe('fast')
    expect(sanitized.optimizer_search).toMatchObject({ optimization_mode: 'fast', beam: true })
  })
})
