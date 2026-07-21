import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ authenticateAdminRequest: vi.fn() }))
const store = vi.hoisted(() => ({
  createAdminRegistrationInvitation: vi.fn(),
  listAdminRegistrationInvitations: vi.fn(),
  revokeAdminRegistrationInvitation: vi.fn(),
}))

vi.mock('./admin-auth', () => auth)
vi.mock('../storage/admin-registration-invitation-store', () => store)

import handler from './admin-registration-invitations'

const invitation = {
  id: 'invite-1',
  status: 'active' as const,
  created_at: '2026-07-21T04:00:00.000Z',
  expires_at: '2026-07-28T04:00:00.000Z',
  consumed_at: null,
  revoked_at: null,
  consumed_by_user_id: null,
  consumed_by_email: null,
}

describe('admin registration invitations handler', () => {
  beforeEach(() => {
    auth.authenticateAdminRequest.mockResolvedValue({ ok: true })
    store.createAdminRegistrationInvitation.mockResolvedValue({ invitation, code: '12AB34CD5E6F7G8H' })
    store.listAdminRegistrationInvitations.mockResolvedValue({ records: [invitation], total: 1, page: 1 })
    store.revokeAdminRegistrationInvitation.mockResolvedValue({ ...invitation, status: 'revoked', revoked_at: '2026-07-21T05:00:00.000Z' })
  })

  it('rejects unauthenticated requests before accessing the store', async () => {
    auth.authenticateAdminRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const response = await handler(new Request('http://localhost/api/admin/registration-invitations'))
    expect(response.status).toBe(401)
    expect(store.listAdminRegistrationInvitations).not.toHaveBeenCalled()
  })

  it('creates a seven-day invitation and returns the plaintext only in the response', async () => {
    const response = await handler(jsonRequest('POST', {}))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      invitation,
      code: '12AB34CD5E6F7G8H',
      share_url: '/tool/profiles?invite=12AB34CD5E6F7G8H',
    })
  })

  it('lists filtered invitations with pagination metadata', async () => {
    const response = await handler(new Request('http://localhost/api/admin/registration-invitations?page=2&page_size=20&status=used'))
    expect(response.status).toBe(200)
    expect(store.listAdminRegistrationInvitations).toHaveBeenCalledWith({ page: 2, pageSize: 20, status: 'used' })
    expect(await response.json()).toMatchObject({ invitations: [invitation], status: 'used' })
  })

  it('revokes an active invitation and validates the action', async () => {
    const response = await handler(jsonRequest('PATCH', { invitation_id: 'invite-1', action: 'revoke' }))
    expect(response.status).toBe(200)
    expect(store.revokeAdminRegistrationInvitation).toHaveBeenCalledWith('invite-1')

    const invalid = await handler(jsonRequest('PATCH', { invitation_id: 'invite-1', action: 'delete' }))
    expect(invalid.status).toBe(400)
  })
})

function jsonRequest(method: string, body: unknown): Request {
  return new Request('http://localhost/api/admin/registration-invitations', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
