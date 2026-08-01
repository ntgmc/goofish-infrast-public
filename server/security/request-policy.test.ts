import { describe, expect, it } from 'vitest'
import { requestSchemas } from './request-policy'

const codeHash = 'a'.repeat(64)
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
