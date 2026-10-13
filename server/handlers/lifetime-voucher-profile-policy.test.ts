import { describe, expect, it } from 'vitest'
import { isLifetimeVoucherUpgradeableProfile } from './lifetime-voucher-profile-policy'

describe('lifetime voucher profile policy', () => {
  it.each(['free_preview', 'metered_personal'] as const)('allows %s to upgrade in place', (kind) => {
    expect(isLifetimeVoucherUpgradeableProfile({ kind, status: 'active' })).toBe(true)
  })

  it.each(['frozen', 'revoked'] as const)('preserves %s restrictions', (status) => {
    expect(isLifetimeVoucherUpgradeableProfile({ kind: 'free_preview', status })).toBe(false)
  })

  it.each(['cdk', 'depot_value', 'metered_commercial'] as const)('does not convert %s into a personal lifetime profile', (kind) => {
    expect(isLifetimeVoucherUpgradeableProfile({ kind, status: 'active' })).toBe(false)
  })
})
