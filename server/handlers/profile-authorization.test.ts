import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserGameAccountRecord } from '../storage/user-store'

const mocks = vi.hoisted(() => ({ getCdk: vi.fn() }))

vi.mock('./license-utils', () => ({
  formatRiskFreezeMessage: (message: string) => message,
  getCdkRecordStore: vi.fn(async () => ({ get: mocks.getCdk })),
  isProfileCdkRecord: (record: { cdk_type?: string }) => (record.cdk_type ?? 'profile') === 'profile',
}))

import { resolveProfileAuthorization } from './profile-authorization'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('authoritative profile authorization', () => {
  it('uses the linked CDK permission instead of a stale elevated profile copy', async () => {
    mocks.getCdk.mockResolvedValue(cdkRecord({ permission: 'recommended' }))

    await expect(resolveProfileAuthorization(profile({ permission: 'ultimate' }))).resolves.toMatchObject({
      ok: true,
      permission: 'recommended',
    })
  })

  it('rejects a profile immediately when the linked CDK is revoked', async () => {
    mocks.getCdk.mockResolvedValue(cdkRecord({ status: 'revoked' }))

    await expect(resolveProfileAuthorization(profile())).resolves.toMatchObject({
      ok: false,
      code: 'license_revoked',
      status: 403,
    })
  })

  it('rejects corrupted authoritative permissions', async () => {
    mocks.getCdk.mockResolvedValue(cdkRecord({ permission: 'corrupted' }))

    await expect(resolveProfileAuthorization(profile())).resolves.toMatchObject({
      ok: false,
      code: 'permission_invalid',
    })
  })

  it('checks free preview status before granting its contextual permission', async () => {
    await expect(resolveProfileAuthorization(profile({
      kind: 'free_preview',
      cdk_key: null,
      status: 'frozen',
    }))).resolves.toMatchObject({ ok: false, code: 'profile_frozen' })
    expect(mocks.getCdk).not.toHaveBeenCalled()
  })
})

function profile(overrides: Partial<UserGameAccountRecord> = {}): UserGameAccountRecord {
  return {
    version: 1,
    id: 'profile-1',
    user_id: 'user-1',
    kind: 'cdk',
    cdk_key: 'cdk/hash.json',
    cdk_code_hash: 'hash',
    cdk_order_hash: 'order',
    permission: 'growth',
    status: 'active',
    display_name: '档案',
    note: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function cdkRecord(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    cdk_type: 'profile',
    code_hash: 'hash',
    permission: 'growth',
    balance_amount: null,
    status: 'used',
    created_at: '2026-01-01T00:00:00.000Z',
    used_at: '2026-01-01T00:00:00.000Z',
    order_note: null,
    license_order_hash: 'order',
    operator_count: null,
    config_desc: null,
    ...overrides,
  }
}
