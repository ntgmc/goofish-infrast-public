import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateAndTouch: vi.fn(),
  getAdminUser: vi.fn(),
  recordBehaviorRiskAdminAudit: vi.fn(),
}))

vi.mock('../storage/admin-session-store', () => ({
  createPostgresAdminSessionStore: () => ({ authenticateAndTouch: mocks.authenticateAndTouch }),
}))
vi.mock('../storage/admin-user-store', () => ({
  createPostgresAdminUserStore: () => ({ get: mocks.getAdminUser }),
}))
vi.mock('../storage/behavior-risk-store', () => ({
  recordBehaviorRiskAdminAudit: mocks.recordBehaviorRiskAdminAudit,
}))

import { authenticateAdminRequest, type AdminUserRecord } from './admin-auth'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateAndTouch.mockResolvedValue({ username: 'operator' })
  mocks.recordBehaviorRiskAdminAudit.mockResolvedValue(undefined)
})

describe('admin risk capabilities', () => {
  it('keeps the legacy second-argument authentication time compatible', async () => {
    const now = new Date('2026-08-01T01:00:00.000Z')
    mocks.getAdminUser.mockResolvedValue(adminUser(2, 'risk_viewer'))

    const result = await authenticateAdminRequest(adminRequest(), now)

    expect(result).toMatchObject({ ok: true, role: 'risk_viewer' })
    expect(mocks.authenticateAndTouch).toHaveBeenCalledWith(
      expect.any(String),
      now.toISOString(),
      new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
    )
  })

  it('denies a viewer review capability and writes a denial audit', async () => {
    mocks.getAdminUser.mockResolvedValue(adminUser(2, 'risk_viewer'))

    const result = await authenticateAdminRequest(adminRequest(), 'risk_review')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
    expect(mocks.recordBehaviorRiskAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
      adminUsername: 'operator',
      capability: 'risk_review',
      decision: 'deny',
    }))
  })

  it('allows a reviewer to review while excluding risk configuration', async () => {
    mocks.getAdminUser.mockResolvedValue(adminUser(2, 'risk_reviewer'))

    const result = await authenticateAdminRequest(adminRequest(), 'risk_review')

    expect(result).toMatchObject({
      ok: true,
      username: 'operator',
      role: 'risk_reviewer',
      capabilities: ['risk_view', 'risk_review'],
    })
    expect(mocks.recordBehaviorRiskAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ decision: 'allow' }))
  })

  it('maps legacy version 1 administrators to security_admin for upgrade compatibility', async () => {
    mocks.getAdminUser.mockResolvedValue(adminUser(1))

    const result = await authenticateAdminRequest(adminRequest(), 'risk_config')

    expect(result).toMatchObject({
      ok: true,
      role: 'security_admin',
      capabilities: ['risk_view', 'risk_review', 'risk_config'],
    })
  })
})

function adminRequest(): Request {
  return new Request('https://example.test/api/admin/behavior-risk', {
    headers: { cookie: `maa_admin_session=${'a'.repeat(43)}` },
  })
}

function adminUser(version: 1 | 2, role?: AdminUserRecord['role']): AdminUserRecord {
  return {
    version,
    username: 'operator',
    role,
    password_hash: 'hash',
    salt: 'salt',
    iterations: 1,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}
