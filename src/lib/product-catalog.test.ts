import { describe, expect, it } from 'vitest'
import {
  hasCapability,
  normalizeRuntimePermission,
  resolveRuntimePermission,
} from './product-catalog'

describe('product catalog', () => {
  it('fails closed for missing or unknown permission values', () => {
    expect(normalizeRuntimePermission(undefined)).toBe('recommended')
    expect(resolveRuntimePermission('corrupted-permission')).toBeNull()
    expect(hasCapability({ permission: 'corrupted-permission' as never }, 'view_upgrade_suggestions')).toBe(false)
  })

  it('evaluates static and contextual capabilities', () => {
    expect(hasCapability({ permission: 'recommended' }, 'view_upgrade_suggestions')).toBe(false)
    expect(hasCapability({ permission: 'growth' }, 'view_upgrade_suggestions')).toBe(true)
    expect(hasCapability({ permission: 'advanced' }, 'run_scenario_comparison')).toBe(true)
    expect(hasCapability({ permission: 'metered_advanced' }, 'run_scenario_comparison')).toBe(false)
    expect(hasCapability({ permission: 'metered_advanced' }, 'export_full_result_json')).toBe(true)
    expect(hasCapability({ permission: 'advanced' }, 'export_full_result_json')).toBe(true)
    expect(hasCapability({ permission: 'ultimate' }, 'export_full_result_json')).toBe(true)
    expect(hasCapability({ permission: 'admin' }, 'export_full_result_json')).toBe(true)
    expect(hasCapability({ permission: 'growth' }, 'export_full_result_json')).toBe(false)
    expect(hasCapability({ kind: 'free_preview', permission: 'growth' }, 'export_full_result_json')).toBe(false)
    expect(hasCapability({ permission: 'ultimate' }, 'use_trusted_optimizer_options')).toBe(true)
    expect(hasCapability({ kind: 'free_preview', permission: 'growth' }, 'edit_limited_config')).toBe(true)
  })
})
