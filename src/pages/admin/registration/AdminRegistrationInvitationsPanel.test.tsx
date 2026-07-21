// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import AdminRegistrationInvitationsPanel from './AdminRegistrationInvitationsPanel'

const invitation = {
  id: 'invite-1',
  status: 'active',
  created_at: '2026-07-21T04:00:00.000Z',
  expires_at: '2026-07-28T04:00:00.000Z',
  consumed_at: null,
  revoked_at: null,
  consumed_by_user_id: null,
  consumed_by_email: null,
}

describe('AdminRegistrationInvitationsPanel', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return { invitation, code: '12AB34CD5E6F7G8H', share_url: '/tool/profiles?invite=12AB34CD5E6F7G8H' }
      }
      if (options?.method === 'PATCH') return { invitation: { ...invitation, status: 'revoked' } }
      return {
        invitations: [invitation],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('creates, shows once, copies, and revokes an administrator invitation', async () => {
    const user = userEvent.setup()
    render(<AdminRegistrationInvitationsPanel />)
    expect(await screen.findByText('可使用')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '生成邀请码' }))
    expect(await screen.findByText(/明文邀请码只显示这一次/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('12AB34CD5E6F7G8H')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '复制链接' }))
    expect(await screen.findByText('注册链接已复制。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/registration-invitations', expect.objectContaining({
      method: 'PATCH',
      json: { invitation_id: 'invite-1', action: 'revoke' },
    })))
  })
})
