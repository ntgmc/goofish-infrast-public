import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  requireRootAdminPassword: vi.fn(),
  replayInvitationSettlement: vi.fn(),
}))

vi.mock('./admin-auth', () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
  requireRootAdminPassword: mocks.requireRootAdminPassword,
}))
vi.mock('../storage/invitation-store', () => ({
  replayInvitationSettlement: mocks.replayInvitationSettlement,
}))

import handler from './admin-invitation-settlements'

describe('admin invitation settlement replay handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateAdminRequest.mockResolvedValue({ ok: true, username: 'operator' })
    mocks.requireRootAdminPassword.mockResolvedValue({ ok: true, username: 'root' })
    mocks.replayInvitationSettlement.mockResolvedValue(true)
  })

  it('requires an administrator session and root confirmation', async () => {
    mocks.authenticateAdminRequest.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    expect((await handler(request())).status).toBe(401)
    expect(mocks.replayInvitationSettlement).not.toHaveBeenCalled()

    mocks.requireRootAdminPassword.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 401 }),
    })
    expect((await handler(request())).status).toBe(401)
    expect(mocks.replayInvitationSettlement).not.toHaveBeenCalled()
  })

  it('replays only a failed or dead-lettered invitation', async () => {
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(mocks.replayInvitationSettlement).toHaveBeenCalledWith(
      'operator',
      'invitation-1',
      'snapshot repaired',
    )

    mocks.replayInvitationSettlement.mockResolvedValueOnce(false)
    const conflict = await handler(request())
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: 'settlement_not_replayable' })
  })
})

function request(): Request {
  return new Request('http://localhost/api/admin/invitation-settlements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invitation_id: 'invitation-1',
      action: 'replay',
      reason: 'snapshot repaired',
      root_password: 'root-secret',
    }),
  })
}
