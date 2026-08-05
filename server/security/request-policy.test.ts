import { describe, expect, it } from 'vitest'
import { MAX_DEPOT_ITEM_TYPES } from '../../src/lib/depot-value-constraints'
import { requestSchemas } from './request-policy'

const codeHash = 'a'.repeat(64)
const declarationHash = 'b'.repeat(64)
const workspaceConfig = {
  layout: '2-4-3',
  desc: '测试配置',
  schedule_mode: 'maa',
  dormitory_rule: 'fixed',
  trading_stations_count: 2,
  manufacturing_stations_count: 4,
  product_requirements: {
    trading_stations: { LMD: 2 },
    manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 2 },
  },
  Fiammetta: { enable: true },
  drones: { enable: true, auto: true, order: 'pre', targets: ['LMD'] },
}

describe('workspace request policy', () => {
  it('accepts bounded workspace mutations and rejects empty or result-writing payloads', () => {
    expect(requestSchemas.userWorkspace.safeParse({
      profile_id: 'profile-1',
      config: workspaceConfig,
    }).success).toBe(true)
    expect(requestSchemas.userWorkspace.safeParse({ profile_id: 'profile-1' }).success).toBe(false)
    expect(requestSchemas.userWorkspace.safeParse({
      profile_id: 'profile-1',
      last_result: { forged: true },
    }).success).toBe(false)
  })

  it('rejects duplicate, out-of-range, and oversized operator payloads', () => {
    const operator = { id: 'char_001', name: '测试干员', own: true, elite: 2, rarity: 5 }
    expect(requestSchemas.userWorkspace.safeParse({
      profile_id: 'profile-1',
      operators: [operator, operator],
    }).success).toBe(false)
    expect(requestSchemas.userWorkspace.safeParse({
      profile_id: 'profile-1',
      operators: [{ ...operator, elite: 3 }],
    }).success).toBe(false)
    expect(requestSchemas.userWorkspace.safeParse({
      profile_id: 'profile-1',
      operators: Array.from({ length: 501 }, (_, index) => ({ ...operator, id: `char_${index}` })),
    }).success).toBe(false)
  })

  it('rejects invalid elite overrides and unknown nested config fields', () => {
    for (const elite of [-1, 1.5, 3]) {
      expect(requestSchemas.userWorkspace.safeParse({
        profile_id: 'profile-1',
        elite_overrides: { char_001: elite },
      }).success).toBe(false)
    }
    expect(requestSchemas.userWorkspace.safeParse({
      profile_id: 'profile-1',
      config: { ...workspaceConfig, untrusted: true },
    }).success).toBe(false)
  })

  it('requires an explicit result history id for free schedule confirmation', () => {
    expect(requestSchemas.workspaceFreeScheduleConfirm.safeParse({
      profile_id: 'profile-1',
      result_history_id: 'result-1',
    }).success).toBe(true)
    expect(requestSchemas.workspaceFreeScheduleConfirm.safeParse({
      profile_id: 'profile-1',
    }).success).toBe(false)
  })
})

describe('personal-use declaration request policy', () => {
  it('uses the shared protected-action contract and requires the displayed document identity', () => {
    for (const action of [
      'free_preview_claim',
      'metered_personal_create',
      'generated_result_export',
      'optimization_generate',
      'reorder_check',
    ]) {
      expect(requestSchemas.personalUseDeclarationConfirmation.safeParse({
        action,
        declaration_id: 'personal_use_v1_1',
        content_hash: declarationHash,
      }).success).toBe(true)
    }
    expect(requestSchemas.personalUseDeclarationConfirmation.safeParse({
      action: 'optimization_generate',
      declaration_id: 'personal_use_v1_1',
    }).success).toBe(false)
    expect(requestSchemas.personalUseDeclarationConfirmation.safeParse({
      action: 'optimization_generate',
      declaration_id: 'personal_use_v1_1',
      content_hash: 'not-a-sha256',
    }).success).toBe(false)
    expect(requestSchemas.personalUseDeclarationConfirmation.safeParse({
      action: 'commercial_generate',
      declaration_id: 'personal_use_v1_1',
      content_hash: declarationHash,
      accepted_at: 'client-controlled',
    }).success).toBe(false)
  })
})

describe('admin CDK baseline request policy', () => {
  it('accepts the new baseline action and all trusted sources', () => {
    for (const baselineSource of ['latest', 'workspace', 'next_import']) {
      expect(requestSchemas.adminCdkPatch.safeParse({
        code_hash: codeHash,
        action: 'set_operator_baseline',
        baseline_source: baselineSource,
        reason: '人工核验通过',
      }).success).toBe(true)
    }
  })

  it('accepts bounded unique-shape batch revoke payloads and rejects unknown actions', () => {
    expect(requestSchemas.adminCdkPatch.safeParse({
      action: 'revoke',
      code_hashes: [codeHash, 'b'.repeat(64)],
    }).success).toBe(true)
    expect(requestSchemas.adminCdkPatch.safeParse({
      action: 'arbitrary_action',
      code_hash: codeHash,
    }).success).toBe(false)
  })

  it('accepts the legacy action name longer than 32 characters', () => {
    expect(requestSchemas.adminCdkPatch.safeParse({
      code_hash: codeHash,
      action: 'accept_operator_baseline_and_unfreeze',
      reason: '兼容旧管理后台',
    }).success).toBe(true)
  })

  it('rejects unknown sources and extra fields', () => {
    expect(requestSchemas.adminCdkPatch.safeParse({
      code_hash: codeHash,
      action: 'set_operator_baseline',
      baseline_source: 'uploaded_json',
      reason: '不应接受任意上传',
    }).success).toBe(false)
    expect(requestSchemas.adminCdkPatch.safeParse({
      code_hash: codeHash,
      action: 'set_operator_baseline',
      baseline_source: 'latest',
      reason: '不应信任客户端指纹',
      fingerprint: { hash: 'client-controlled' },
    }).success).toBe(false)
  })
})

describe('lifetime voucher JSON profile request policy', () => {
  it('accepts profile metadata and rejects unknown fields', () => {
    expect(requestSchemas.lifetimeVoucherProfileCreate.safeParse({
      idempotency_key: 'lifetime-json-request',
      display_name: 'JSON 终身档案',
      note: '手动导入',
    }).success).toBe(true)
    expect(requestSchemas.lifetimeVoucherProfileCreate.safeParse({
      idempotency_key: 'lifetime-json-request',
      skland_uid: 'unauthorized-client-value',
    }).success).toBe(false)
  })
})

describe('Skland confirmation request policy', () => {
  it('requires stable idempotency keys for profile and free-preview confirmations', () => {
    expect(requestSchemas.sklandConfirmation.safeParse({
      profile_id: 'profile-1',
      confirmation_id: 'confirmation-1',
      idempotency_key: 'profile-confirm-key',
    }).success).toBe(true)
    expect(requestSchemas.sklandConfirmation.safeParse({
      profile_id: 'profile-1',
      confirmation_id: 'confirmation-1',
    }).success).toBe(false)
    expect(requestSchemas.freePreviewConfirmation.safeParse({
      confirmation_id: 'confirmation-free',
      idempotency_key: 'free-confirm-key',
    }).success).toBe(true)
    expect(requestSchemas.freePreviewConfirmation.safeParse({
      confirmation_id: 'confirmation-free',
    }).success).toBe(false)
  })

  it('accepts only endpoint-owned pending cancellation fields', () => {
    expect(requestSchemas.sklandPendingCancel.safeParse({
      profile_id: 'profile-1',
      pending_id: 'pending-1',
    }).success).toBe(true)
    expect(requestSchemas.profilelessSklandPendingCancel.safeParse({
      pending_id: 'pending-free',
    }).success).toBe(true)
    expect(requestSchemas.profilelessSklandPendingCancel.safeParse({
      pending_id: 'pending-free',
      profile_id: 'client-owned-field',
    }).success).toBe(false)
  })
})

describe('account deletion request policy', () => {
  it('requires a valid email and non-empty bounded password', () => {
    expect(requestSchemas.accountDelete.safeParse({
      email: 'user@example.test',
      password: 'current-password',
    }).success).toBe(true)
    expect(requestSchemas.accountDelete.safeParse({
      email: 'not-an-email',
      password: 'current-password',
    }).success).toBe(false)
    expect(requestSchemas.accountDelete.safeParse({
      email: 'user@example.test',
      password: '',
    }).success).toBe(false)
  })
})

describe('profile metadata request policy', () => {
  it('requires at least one metadata field', () => {
    expect(requestSchemas.profilePatch.safeParse({ profile_id: 'profile-1' }).success).toBe(false)
    expect(requestSchemas.profilePatch.safeParse({ profile_id: 'profile-1', display_name: '新名称' }).success).toBe(true)
    expect(requestSchemas.profilePatch.safeParse({ profile_id: 'profile-1', note: '' }).success).toBe(true)
  })
})

describe('administrator inventory request policy', () => {
  const reward = {
    item_code: 'priority_compute_coupon',
    quantity: 1,
    expiry: { mode: 'never' as const },
  }

  it('accepts action-specific asset writes with reason and idempotency', () => {
    expect(requestSchemas.adminItems.safeParse({
      action: 'create_gift_pack',
      name: '测试礼包',
      description: '测试说明',
      contents: [reward],
      idempotency_key: 'gift-pack-request',
    }).success).toBe(true)
    expect(requestSchemas.adminInventory.safeParse({
      action: 'grant',
      user_id: 'user-1',
      item_code: 'priority_compute_coupon',
      quantity: 1,
      validity_days: 0,
      reason: '人工补发',
      idempotency_key: 'grant-request',
    }).success).toBe(true)
    expect(requestSchemas.adminInventory.safeParse({
      action: 'create_campaign',
      item_code: 'priority_compute_coupon',
      quantity: 1,
      validity_days: 0,
      target_mode: 'user_ids',
      user_ids: ['user-1'],
      reason: '活动补偿',
      idempotency_key: 'campaign-request',
    }).success).toBe(true)
    expect(requestSchemas.adminInventory.safeParse({
      action: 'reverse_campaign',
      campaign_id: 'campaign-1',
      reason: '全站撤回',
      root_password: 'root-password',
    }).success).toBe(true)
  })

  it('rejects missing accountability fields, unknown actions, and untyped reward fields', () => {
    const grant = {
      action: 'grant',
      user_id: 'user-1',
      item_code: 'priority_compute_coupon',
      quantity: 1,
      validity_days: 0,
      reason: '人工补发',
      idempotency_key: 'grant-request',
    }
    expect(requestSchemas.adminInventory.safeParse({ ...grant, reason: undefined }).success).toBe(false)
    expect(requestSchemas.adminInventory.safeParse({ ...grant, idempotency_key: undefined }).success).toBe(false)
    expect(requestSchemas.adminInventory.safeParse({ ...grant, action: 'arbitrary' }).success).toBe(false)
    expect(requestSchemas.adminItems.safeParse({
      action: 'create_gift_pack',
      name: '测试礼包',
      description: '测试说明',
      contents: [{ ...reward, server_owned: true }],
      idempotency_key: 'gift-pack-request',
    }).success).toBe(false)
  })
})

describe('announcement request policy', () => {
  it('requires optimistic concurrency and mutually exclusive read mutations', () => {
    const announcement = { banner: null, announcements: [], expected_revision: 0 }
    expect(requestSchemas.announcement.safeParse(announcement).success).toBe(true)
    expect(requestSchemas.announcement.safeParse({ ...announcement, expected_revision: undefined }).success).toBe(false)
    expect(requestSchemas.userAnnouncement.safeParse({ announcement_id: 'announcement-1' }).success).toBe(true)
    expect(requestSchemas.userAnnouncement.safeParse({ all: true }).success).toBe(true)
    expect(requestSchemas.userAnnouncement.safeParse({}).success).toBe(false)
    expect(requestSchemas.userAnnouncement.safeParse({ all: false }).success).toBe(false)
    expect(requestSchemas.userAnnouncement.safeParse({ announcement_id: 'announcement-1', all: true }).success).toBe(false)
  })
})

describe('invitation request policy', () => {
  it('validates reward snapshots and revision deeply', () => {
    const valid = {
      enabled: true,
      expected_revision: 2,
      rewards: [{
        recipient: 'inviter',
        item_code: 'priority_compute_coupon',
        quantity: 1,
        expiry: { mode: 'never' },
        gift_pack_version_id: null,
      }],
    }
    expect(requestSchemas.adminInvitationSettings.safeParse(valid).success).toBe(true)
    expect(requestSchemas.adminInvitationSettings.safeParse({
      ...valid,
      rewards: [{ ...valid.rewards[0], quantity: 0 }],
    }).success).toBe(false)
    expect(requestSchemas.adminInvitationSettings.safeParse({ ...valid, expected_revision: undefined }).success).toBe(false)
  })

  it('requires root accountability and idempotency for administrator codes', () => {
    const create = { reason: 'test issuance', idempotency_key: 'request-1', root_password: 'root-secret' }
    expect(requestSchemas.adminRegistrationInvitationCreate.safeParse(create).success).toBe(true)
    expect(requestSchemas.adminRegistrationInvitationCreate.safeParse({ ...create, root_password: undefined }).success).toBe(false)
    expect(requestSchemas.adminRegistrationInvitationCreate.safeParse({ ...create, idempotency_key: undefined }).success).toBe(false)
    expect(requestSchemas.adminRegistrationInvitationPatch.safeParse({
      invitation_id: 'invitation-1', action: 'revoke', reason: 'test revoke', root_password: 'root-secret',
    }).success).toBe(true)
    expect(requestSchemas.adminRegistrationInvitationPatch.safeParse({
      invitation_id: 'invitation-1', action: 'delete', reason: 'test revoke', root_password: 'root-secret',
    }).success).toBe(false)
  })

  it('accepts only explicit user invitation code actions', () => {
    expect(requestSchemas.userInvitationCode.safeParse({ action: 'ensure' }).success).toBe(true)
    expect(requestSchemas.userInvitationCode.safeParse({ action: 'rotate' }).success).toBe(true)
    expect(requestSchemas.userInvitationCode.safeParse({ action: 'delete' }).success).toBe(false)
  })
})

describe('depot value request policy', () => {
  it('uses a strict source union with bounded integer inventory counts and optional consent override', () => {
    expect(requestSchemas.depotValue.safeParse({
      source: 'upload',
      inventory: { '2001': 1, '30011': 100 },
    }).success).toBe(true)
    expect(requestSchemas.depotValue.safeParse({
      source: 'upload',
      inventory: {
        '@type': '@penguin-statistics/depot',
        items: [{ id: '30011', have: 2, name: '源岩' }],
      },
    }).success).toBe(true)
    expect(requestSchemas.depotValue.safeParse({
      source: 'skland',
      profile_id: 'profile-1',
      sample_consent: false,
    }).success).toBe(true)

    expect(requestSchemas.depotValue.safeParse({
      source: 'skland',
      profile_id: 'profile-1',
    }).success).toBe(true)
    expect(requestSchemas.depotValue.safeParse({
      source: 'upload',
      inventory: { '2001': 1.5 },
    }).success).toBe(false)
    expect(requestSchemas.depotValue.safeParse({
      source: 'upload',
      inventory: { '2001': 1_000_000_001 },
    }).success).toBe(false)
    expect(requestSchemas.depotValue.safeParse({
      source: 'upload',
      inventory: { '2001': 1 },
      profile_id: 'unexpected',
    }).success).toBe(false)
    expect(requestSchemas.depotValue.safeParse({
      source: 'upload',
      inventory: Object.fromEntries(Array.from(
        { length: MAX_DEPOT_ITEM_TYPES + 1 },
        (_, index) => [String(index), 1],
      )),
    }).success).toBe(false)
  })
})
