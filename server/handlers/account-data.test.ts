import { beforeEach, describe, expect, it, vi } from 'vitest'
import accountDataHandler from './account-data'

const mocks = vi.hoisted(() => ({
  cancelAccountDeletion: vi.fn(),
  clearSessionCookie: vi.fn(),
  getProfileForUser: vi.fn(),
  getUserById: vi.fn(),
  listProfilesForUser: vi.fn(),
  listProfileWorkspaces: vi.fn(),
  listOptimizationResultsForProfiles: vi.fn(),
  toPublicWorkspace: vi.fn(),
  normalizeEmail: vi.fn(),
  PasswordWorkCapacityError: class PasswordWorkCapacityError extends Error {},
  query: vi.fn(),
  requestAccountDeletion: vi.fn(),
  listPersonalUseDeclarationAcceptancesForUser: vi.fn(),
  listPersonalUseDeclarationUsageEventsForUser: vi.fn(),
  saveUserProfile: vi.fn(),
  requireUserSession: vi.fn(),
  exportUserNotifications: vi.fn(),
  verifyPasswordHash: vi.fn(),
}))

vi.mock('../storage/user-store', () => ({
  getProfileForUser: mocks.getProfileForUser,
  getUserById: mocks.getUserById,
  listProfilesForUser: mocks.listProfilesForUser,
  listProfileWorkspaces: mocks.listProfileWorkspaces,
  saveUserProfile: mocks.saveUserProfile,
  toPublicWorkspace: mocks.toPublicWorkspace,
}))

vi.mock('../storage/postgres', () => ({ query: mocks.query }))
vi.mock('../storage/optimization-result-store', () => ({
  listOptimizationResultsForProfiles: mocks.listOptimizationResultsForProfiles,
}))
vi.mock('../storage/notification-store', () => ({ exportUserNotifications: mocks.exportUserNotifications }))
vi.mock('../storage/personal-use-declaration-store', () => ({
  listPersonalUseDeclarationAcceptancesForUser: mocks.listPersonalUseDeclarationAcceptancesForUser,
  listPersonalUseDeclarationUsageEventsForUser: mocks.listPersonalUseDeclarationUsageEventsForUser,
}))
vi.mock('../account-data-lifecycle', () => ({
  AccountDeletionStateError: class AccountDeletionStateError extends Error {},
  cancelAccountDeletion: mocks.cancelAccountDeletion,
  requestAccountDeletion: mocks.requestAccountDeletion,
}))
vi.mock('../security/password', () => ({
  PasswordWorkCapacityError: mocks.PasswordWorkCapacityError,
  verifyPasswordHash: mocks.verifyPasswordHash,
}))
vi.mock('./user-auth', () => ({
  clearSessionCookie: mocks.clearSessionCookie,
  normalizeEmail: mocks.normalizeEmail,
  requireUserSession: mocks.requireUserSession,
  jsonResponse: (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? headers : { 'Content-Type': 'application/json', ...headers },
  }),
}))

const binding = {
  uid: '12345678',
  nickname: '博士',
  channel_name: '官服',
  bound_at: '2026-01-01T00:00:00.000Z',
  last_imported_at: '2026-01-02T00:00:00.000Z',
  encrypted_cred: 'encrypted-credential',
  credential_status: 'available' as const,
  credential_invalid_at: null,
  credential_invalid_reason: null,
}

beforeEach(() => {
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.test' } })
  mocks.query.mockResolvedValue({ rows: [] })
  mocks.listProfilesForUser.mockResolvedValue([])
  mocks.listProfileWorkspaces.mockResolvedValue(new Map())
  mocks.listOptimizationResultsForProfiles.mockResolvedValue(new Map())
  mocks.toPublicWorkspace.mockImplementation((workspace: Record<string, unknown>) => ({
    profile_id: workspace.profile_id,
    latest_result: null,
    result_history: [],
    archived_results: [],
    result_history_next_cursor: null,
    archived_results_next_cursor: null,
  }))
  mocks.getUserById.mockResolvedValue(null)
  mocks.listPersonalUseDeclarationAcceptancesForUser.mockResolvedValue([])
  mocks.listPersonalUseDeclarationUsageEventsForUser.mockResolvedValue([])
  mocks.exportUserNotifications.mockResolvedValue([])
  mocks.clearSessionCookie.mockReturnValue('session=; Max-Age=0')
  mocks.normalizeEmail.mockImplementation((value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : null)
  mocks.verifyPasswordHash.mockResolvedValue({ verified: true })
  mocks.requestAccountDeletion.mockResolvedValue({
    scheduledFor: '2026-08-07T00:00:00.000Z',
    cancellationEmail: 'queued',
  })
  mocks.getProfileForUser.mockResolvedValue({
    id: 'profile-1',
    user_id: 'user-1',
    skland_binding: binding,
    skland_pending_binding: null,
    updated_at: '2026-01-02T00:00:00.000Z',
  })
})

describe('account data Skland controls', () => {
  it('clears the credential while preserving the bound account identity', async () => {
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/credential/clear', {
      method: 'POST',
      body: JSON.stringify({ profile_id: 'profile-1' }),
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(response.status).toBe(200)
    expect(mocks.saveUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      skland_binding: expect.objectContaining({
        uid: binding.uid,
        nickname: binding.nickname,
        channel_name: binding.channel_name,
        bound_at: binding.bound_at,
        encrypted_cred: '',
        credential_status: 'invalid',
      }),
    }))
  })

  it('does not expose an unlink action through the account data handler', async () => {
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/skland/unlink', {
      method: 'POST',
      body: JSON.stringify({ profile_id: 'profile-1' }),
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'API route not found', code: 'route_not_found' })
    expect(mocks.saveUserProfile).not.toHaveBeenCalled()
  })

  it('does not expose depot sample revocation through the account data handler', async () => {
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/depot-sample/revoke', {
      method: 'POST',
      body: JSON.stringify({ profile_id: 'profile-1' }),
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'API route not found', code: 'route_not_found' })
  })

  it('exports public inventory history without internal administrator audit data', async () => {
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/export'))
    const body = await response.json() as { inventory: Record<string, unknown> }

    expect(response.status).toBe(200)
    expect(body.inventory).not.toHaveProperty('admin_audit_links')
    expect(mocks.query.mock.calls.some(([statement]) => String(statement).includes('inventory_admin_audit'))).toBe(false)
  })

  it('exports public notifications without internal source or grant identifiers', async () => {
    mocks.exportUserNotifications.mockResolvedValue([{ id: 'notification-1', type: 'item_grant' }])
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/export'))
    const body = await response.json() as { version: number; notifications: Array<Record<string, unknown>> }

    expect(body.version).toBe(4)
    expect(body.notifications).toEqual([{ id: 'notification-1', type: 'item_grant' }])
    expect(body.notifications[0]).not.toHaveProperty('source_type')
    expect(body.notifications[0]).not.toHaveProperty('grant_id')
  })

  it('rejects a personal data attachment that exceeds the bounded export size', async () => {
    mocks.exportUserNotifications.mockResolvedValue([{
      id: 'oversized-notification',
      body: 'x'.repeat(16 * 1024 * 1024),
    }])

    const response = await accountDataHandler(new Request('http://localhost/api/user/data/export'))

    expect(response.status).toBe(413)
    expect(response.headers.get('Content-Disposition')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({ code: 'personal_data_export_too_large' })
  })

  it('uses one batch workspace query and exports the V4 coverage additions', async () => {
    mocks.listProfilesForUser.mockResolvedValue([
      { id: 'profile-1', skland_binding: null, skland_pending_binding: null },
      { id: 'profile-2', skland_binding: null, skland_pending_binding: null },
    ])
    mocks.listProfileWorkspaces.mockResolvedValue(new Map([
      ['profile-2', { profile_id: 'profile-2' }],
      ['profile-1', { profile_id: 'profile-1' }],
    ]))
    const optimizationResult = {
      id: 'result-1',
      name: '历史排班',
      created_at: '2026-07-31T00:00:00.000Z',
      config: null,
      result: { title: '历史排班' },
      operator_count: 12,
      source: 'generated',
      archived_at: null,
    }
    mocks.listOptimizationResultsForProfiles.mockResolvedValue(new Map([
      ['profile-1', [optimizationResult]],
    ]))
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes('from optimization_submissions')) {
        return { rows: [{ id: 'submission-1', owner_key: 'reorder-job:profile-1' }] }
      }
      if (statement.includes('from optimization_idempotency')) {
        return { rows: [{ owner_key: 'reorder-job:profile-1', request_hash: 'request-hash' }] }
      }
      if (statement.includes('from invitation_codes')) return { rows: [{ code: 'ABCDEFGH' }] }
      if (statement.includes('from invitations')) return { rows: [{ id: 'invitation-1', role: 'inviter' }] }
      if (statement.includes('from user_workspaces')) return { rows: [{ record_json: { version: 1 } }] }
      return { rows: [] }
    })

    const response = await accountDataHandler(new Request('http://localhost/api/user/data/export'))
    const body = await response.json() as Record<string, any>

    expect(response.status).toBe(200)
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledOnce()
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledWith(['profile-1', 'profile-2'])
    expect(mocks.listOptimizationResultsForProfiles).toHaveBeenCalledOnce()
    expect(mocks.listOptimizationResultsForProfiles).toHaveBeenCalledWith(['profile-1', 'profile-2'])
    expect(body.workspaces.map((workspace: { profile_id: string }) => workspace.profile_id))
      .toEqual(['profile-1', 'profile-2'])
    expect(body.optimization_results).toEqual([optimizationResult])
    expect(body.optimization_submissions).toEqual([
      { id: 'submission-1', owner_key: 'reorder-job:profile-1' },
    ])
    expect(body.optimization_idempotency[0]).toMatchObject({ request_hash: 'request-hash' })
    expect(body.invitation_code).toEqual({ code: 'ABCDEFGH' })
    expect(body.invitations).toEqual([{ id: 'invitation-1', role: 'inviter' }])
    expect(body.legacy_workspace).toEqual({ version: 1 })
    expect(body.coverage.optimization_submissions).toEqual({
      disposition: 'export',
      field: 'optimization_submissions',
    })
    expect(body.coverage.user_sessions).toMatchObject({ disposition: 'exclude' })
  })

  it('returns stable lifecycle response codes and the accepted deletion deadline', async () => {
    const unauthenticated = await accountDataHandler(new Request('http://localhost/api/user/data/export'))
    mocks.requireUserSession.mockResolvedValueOnce(null)
    const nextUnauthenticated = await accountDataHandler(new Request('http://localhost/api/user/data/export'))
    expect(unauthenticated.status).toBe(200)
    expect(nextUnauthenticated.status).toBe(401)
    await expect(nextUnauthenticated.json()).resolves.toMatchObject({ code: 'authentication_required' })

    const response = await accountDataHandler(new Request('http://localhost/api/user/data/delete-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.test', password: 'password' }),
    }))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scheduled_for: '2026-08-07T00:00:00.000Z',
      cancellation_email: 'queued',
    })
  })

  it('returns a stable retry contract when password verification capacity is saturated', async () => {
    mocks.verifyPasswordHash.mockRejectedValueOnce(new mocks.PasswordWorkCapacityError('busy'))
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/delete-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.test', password: 'password' }),
    }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('1')
    await expect(response.json()).resolves.toMatchObject({
      code: 'password_service_busy',
      retry_after_seconds: 1,
    })
  })
})
