import { describe, expect, it } from 'vitest'
import {
  getPermissionProfile,
  getSku,
  hasCapability,
  listAdminIssuablePermissions,
  listPublicSkus,
  normalizeRuntimePermission,
  productPolicies,
} from './product-catalog'

describe('product catalog', () => {
  it('publishes only free preview and the 49 CNY lifetime SKU', () => {
    expect(listPublicSkus().map((sku) => sku.id)).toEqual(['free_preview', 'single_account_lifetime'])
    expect(getSku('free_preview').price?.amount).toBe(0)
    expect(getSku('single_account_lifetime')).toMatchObject({
      public: true,
      runtime_permission: 'advanced',
      price: { amount: 49, currency: 'CNY', billing: 'one_time' },
    })
  })

  it('keeps internal card permissions admin-issuable and ordered', () => {
    expect(listAdminIssuablePermissions()).toEqual(['recommended', 'growth', 'advanced', 'ultimate'])
    expect(getPermissionProfile('ultimate').public).toBe(false)
    expect(getPermissionProfile('admin').admin_issuable).toBe(false)
  })

  it('normalizes legacy permission aliases', () => {
    expect(normalizeRuntimePermission('basic')).toBe('growth')
    expect(normalizeRuntimePermission('premium')).toBe('advanced')
  })

  it('evaluates static and contextual capabilities', () => {
    expect(hasCapability({ permission: 'recommended' }, 'view_upgrade_suggestions')).toBe(false)
    expect(hasCapability({ permission: 'growth' }, 'view_upgrade_suggestions')).toBe(true)
    expect(hasCapability({ permission: 'advanced' }, 'run_scenario_comparison')).toBe(true)
    expect(hasCapability({ permission: 'ultimate' }, 'use_trusted_optimizer_options')).toBe(true)
    expect(hasCapability({ permission: 'advanced', hasActiveCdkRecord: false }, 'replace_operator_data')).toBe(false)
    expect(hasCapability({ permission: 'growth', operatorUpdateGrantRemaining: 1 }, 'replace_operator_data')).toBe(true)
    expect(hasCapability({ permission: 'admin' }, 'replace_operator_data')).toBe(true)
    expect(hasCapability({ kind: 'free_preview', permission: 'growth' }, 'edit_limited_config')).toBe(true)
  })

  it('owns update, risk and support policy values', () => {
    expect(productPolicies.lifetime_operator_updates).toMatchObject({ window_days: 7, max_updates: 2 })
    expect(productPolicies.risk).toMatchObject({
      operator_data_enabled_by_default: true,
      device_enabled_by_default: false,
      client_signal_window_days: 14,
      max_user_agents: 2,
      max_ip_prefixes: 3,
      soft_blocks_before_freeze: 3,
    })
    expect(productPolicies.support.first_response_business_days).toBe(2)
  })
})
