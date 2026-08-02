import { describe, expect, it } from 'vitest'
import { adminInventoryOverviewSchema } from './admin-inventory-contracts'

const timestamp = '2026-08-01T00:00:00.000Z'

describe('administrator inventory runtime contract', () => {
  it('accepts a typed overview including partial campaign diagnostics', () => {
    const result = adminInventoryOverviewSchema.safeParse({
      definitions: [{
        code: 'priority_compute_coupon',
        kind: 'consumable',
        effect_code: 'priority_compute',
        name: '优先计算券',
        description: '测试',
        icon_key: 'priority_compute_coupon',
        system_owned: true,
        issuance_enabled: true,
        created_at: timestamp,
        updated_at: timestamp,
      }],
      gift_pack_versions: [],
      tasks: [],
      campaigns: [{
        id: 'campaign-1',
        item_code: 'priority_compute_coupon',
        target_mode: 'user_ids',
        status: 'completed_with_failures',
        recipient_count: 2,
        granted_count: 1,
        failed_count: 1,
        pending_count: 0,
        processing_count: 0,
        skipped_count: 0,
        revoked_count: 0,
        failed_recipients: [{
          user_id: 'user-2',
          error_message: 'delivery failed',
          attempt_count: 3,
          processed_at: timestamp,
        }],
      }],
      audits: [],
      user_count: 2,
    })

    expect(result.success).toBe(true)
  })

  it('rejects missing campaign counters and unsupported item effects', () => {
    expect(adminInventoryOverviewSchema.safeParse({
      definitions: [{
        code: 'bad', kind: 'consumable', effect_code: 'server_only_effect', name: 'bad', description: 'bad',
        icon_key: 'placeholder', system_owned: true, issuance_enabled: true, created_at: null, updated_at: null,
      }],
      gift_pack_versions: [],
      tasks: [],
      campaigns: [],
      audits: [],
      user_count: 0,
    }).success).toBe(false)
  })
})
