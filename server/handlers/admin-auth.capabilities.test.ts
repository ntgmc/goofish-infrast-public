import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateAndTouch: vi.fn(),
  getAdminUser: vi.fn(),
  recordAdminOperationAudit: vi.fn(),
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
vi.mock('../storage/admin-operation-audit-store', () => ({
  recordAdminOperationAudit: mocks.recordAdminOperationAudit,
}))

import { authenticateAdminRequest, type AdminUserRecord } from './admin-auth'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateAndTouch.mockResolvedValue({
    username: 'operator',
    created_at: '2026-08-01T00:00:00.000Z',
  })
  mocks.recordBehaviorRiskAdminAudit.mockResolvedValue(undefined)
  mocks.recordAdminOperationAudit.mockResolvedValue(undefined)
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
      capabilities: ['risk_view', 'risk_review', 'usage_view', 'user_view'],
    })
    expect(mocks.recordBehaviorRiskAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ decision: 'allow' }))
  })

  it('maps legacy version 1 administrators to security_admin for upgrade compatibility', async () => {
    mocks.getAdminUser.mockResolvedValue(adminUser(1))

    const result = await authenticateAdminRequest(adminRequest(), 'risk_config')

    expect(result).toMatchObject({
      ok: true,
      role: 'security_admin',
      capabilities: [
        'risk_view',
        'risk_review',
        'risk_config',
        'usage_view',
        'user_view',
        'sensitive_data_view',
        'user_manage',
        'user_delete',
        'optimization_view',
        'optimization_manage',
        'admin_manage',
      ],
    })
  })

  it('allows a viewer to read usage while denying user data access', async () => {
    mocks.getAdminUser.mockResolvedValue(adminUser(2, 'risk_viewer'))

    const usage = await authenticateAdminRequest(adminRequest(), 'usage_view')
    const users = await authenticateAdminRequest(adminRequest(), 'user_view')

    expect(usage).toMatchObject({ ok: true, role: 'risk_viewer' })
    expect(users.ok).toBe(false)
    if (!users.ok) expect(users.response.status).toBe(403)
    expect(mocks.recordAdminOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorUsername: 'operator',
      action: 'authorization.allow',
      targetId: 'usage_view',
    }))
    expect(mocks.recordAdminOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorUsername: 'operator',
      action: 'authorization.deny',
      targetId: 'user_view',
    }))
  })

  it('allows a reviewer to view users without granting user mutations', async () => {
    mocks.getAdminUser.mockResolvedValue(adminUser(2, 'risk_reviewer'))

    const view = await authenticateAdminRequest(adminRequest(), 'user_view')
    const mutate = await authenticateAdminRequest(adminRequest(), 'user_manage')

    expect(view).toMatchObject({ ok: true, role: 'risk_reviewer' })
    expect(mutate.ok).toBe(false)
    if (!mutate.ok) expect(mutate.response.status).toBe(403)
  })

  it('requires a security administrator to have logged in within 15 minutes for sensitive mutations', async () => {
    mocks.getAdminUser.mockResolvedValue(adminUser(2, 'security_admin'))

    const recent = await authenticateAdminRequest(
      adminRequest(),
      { capability: 'user_delete', requireRecentLogin: true },
      new Date('2026-08-01T00:14:59.000Z'),
    )
    const stale = await authenticateAdminRequest(
      adminRequest(),
      { capability: 'user_delete', requireRecentLogin: true },
      new Date('2026-08-01T00:15:01.000Z'),
    )

    expect(recent).toMatchObject({ ok: true, role: 'security_admin' })
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.response.status).toBe(403)
      await expect(stale.response.json()).resolves.toEqual({
        error: '该敏感操作需要近期管理员登录，请退出后重新登录再试。',
      })
    }
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
