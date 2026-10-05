import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS } from '../../../src/lib/config'
import { licenseConfigSchema } from '../../../src/lib/workspace-validation'
import { resolveConfigForPermission, resolveFreePreviewConfig } from '../../handlers/license-utils'
import type { OptimizeConfigPermission } from './shared'
import { sanitizeConfigForPublicOptimize } from './http-core'

describe('sanitizeConfigForPublicOptimize inventory balance policy', () => {
  it.each<OptimizeConfigPermission>(['advanced', 'metered_advanced', 'ultimate', 'admin'])(
    'preserves selected 333 product counts with depleted inventory for %s',
    (permission) => {
      for (const goldCount of [1, 2]) {
        const config = {
          ...structuredClone(CONFIG_PRESETS['333-lmd']),
          product_requirements: {
            trading_stations: { LMD: 3 },
            manufacturing_stations: { 'Pure Gold': goldCount, 'Battle Record': 3 - goldCount },
          },
          intermediate_inventory: { 'Pure Gold': 0, 'Originium Shard': 1, 'Orirock Cube': 866 },
          auto_balance_source: 'intermediate_inventory',
        }

        const sanitized = sanitizeConfigForPublicOptimize(config, permission)

        expect(sanitized.auto_balance_source).toBe('limited_config')
        expect(sanitized.product_requirements).toEqual(config.product_requirements)
        expect(sanitized.intermediate_inventory).toEqual(config.intermediate_inventory)
        expect(sanitized.drones).toEqual(config.drones)
        expect(config.auto_balance_source).toBe('intermediate_inventory')
        expect(sanitizeConfigForPublicOptimize(sanitized, permission)).toEqual(sanitized)
      }
    },
  )

  it.each<OptimizeConfigPermission>(['advanced', 'metered_advanced', 'ultimate', 'admin', 'free_preview', 'recommended', 'growth'])(
    'retains an explicit inventory balance choice through validation, preset resolution and JSON round trips for %s',
    (permission) => {
      for (const enabled of [true, false]) {
        const submitted = licenseConfigSchema.parse({
          ...structuredClone(CONFIG_PRESETS['243']),
          intermediate_inventory: { 'Pure Gold': 0 },
          allow_product_rebalance: enabled,
        })
        const resolved = permission === 'free_preview'
          ? resolveFreePreviewConfig(submitted)
          : resolveConfigForPermission(permission, submitted)
        expect(resolved.ok).toBe(true)
        if (!resolved.ok) throw new Error(resolved.message)

        const sanitized = sanitizeConfigForPublicOptimize(resolved.config, permission)
        const stored = licenseConfigSchema.parse(JSON.parse(JSON.stringify(sanitized)))

        expect(stored.allow_product_rebalance).toBe(enabled)
        expect(stored.auto_balance_source).toBe(enabled ? 'intermediate_inventory' : 'limited_config')
        expect(stored.intermediate_inventory).toEqual({ 'Pure Gold': 0 })
        expect(sanitizeConfigForPublicOptimize(stored, permission)).toEqual(sanitized)
      }
    },
  )

  it.each<OptimizeConfigPermission>(['free_preview', 'recommended', 'growth'])(
    'retains inventory-based product adjustment for %s presets',
    (permission) => {
      const config = {
        ...CONFIG_PRESETS['243'],
        intermediate_inventory: { 'Pure Gold': 0 },
        auto_balance_source: 'intermediate_inventory',
      }

      const sanitized = sanitizeConfigForPublicOptimize(config, permission)

      expect(sanitized.auto_balance_source).toBe('intermediate_inventory')
      expect(sanitized.intermediate_inventory).toEqual(config.intermediate_inventory)
    },
  )

  it('reports provided stock even when product rebalancing is disabled by default', () => {
    const sanitized = sanitizeConfigForPublicOptimize({
      ...CONFIG_PRESETS['243'], intermediate_inventory: { 'Pure Gold': 0 },
    }, 'advanced')
    expect(sanitized.allow_product_rebalance).toBe(false)
    expect(sanitized.auto_balance_source).toBe('limited_config')
  })

  it('does not enable inventory reporting when no inventory balance was requested', () => {
    expect(sanitizeConfigForPublicOptimize(CONFIG_PRESETS['243'], 'advanced').auto_balance_source).toBeUndefined()
  })
})

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

  it('replaces fast mode restored from a 252 history item when switching to 243', () => {
    const restored = sanitizeConfigForPublicOptimize(CONFIG_PRESETS['252'], 'advanced')
    Object.assign(restored, structuredClone(CONFIG_PRESETS['243']))

    const sanitized = sanitizeConfigForPublicOptimize(restored, 'advanced')

    expect(sanitized.optimization_mode).toBeUndefined()
    expect(sanitized.optimizer_search).toEqual({ optimization_mode: 'exact', beam: true })
    expect(sanitized.Fiammetta?.candidate_mode).toBeUndefined()
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

  it.each(['252', '252-1'] as const)('preserves %s facility levels while enforcing fast mode', (preset) => {
    const sanitized = sanitizeConfigForPublicOptimize({ ...CONFIG_PRESETS[preset], optimization_mode: 'exact' }, 'advanced')

    expect(sanitized.layout).toBe('2-5-2')
    expect(sanitized.trading_station_levels).toEqual(CONFIG_PRESETS[preset].trading_station_levels)
    expect(sanitized.manufacturing_station_levels).toEqual(CONFIG_PRESETS[preset].manufacturing_station_levels)
    expect(sanitized.optimization_mode).toBe('fast')
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

  it.each([
    [[8, 8, 8], true],
    [[12, 12, 12], true],
    [[6, 6, 6, 6], false],
    [[24, 24, 24], false],
    [[12, 6, 6], true],
  ] as const)('enforces Fiammetta availability for %j', (shiftHours, enabled) => {
    const sanitized = sanitizeConfigForPublicOptimize({
      ...CONFIG_PRESETS['243'],
      shift_hours: [...shiftHours],
    }, 'advanced')

    expect(sanitized.Fiammetta?.enable).toBe(enabled)
  })

  it('preserves Fiammetta when shift hours use the default 8-8-8 pattern', () => {
    const sanitized = sanitizeConfigForPublicOptimize(CONFIG_PRESETS['243'], 'advanced')

    expect(sanitized.Fiammetta?.enable).toBe(true)
  })

  it.each([
    { schedule_mode: 'variable' },
    { schedule_mode: 'maa', variable_shift_schedule: { enable: true } },
  ])('disables Fiammetta for automatic variable shifts', (variableConfig) => {
    const sanitized = sanitizeConfigForPublicOptimize({
      ...CONFIG_PRESETS['243'],
      shift_hours: [8, 8, 8],
      ...variableConfig,
    }, 'advanced')

    expect(sanitized.Fiammetta?.enable).toBe(false)
  })
})
