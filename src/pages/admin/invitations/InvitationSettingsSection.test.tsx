// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminInvitationSettingsResponse } from '../../../lib/types'
import InvitationSettingsSection from './InvitationSettingsSection'

const adminApiJson = vi.fn()
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: (...args: unknown[]) => adminApiJson(...args) }))

const overview: AdminInvitationSettingsResponse = {
  settings: {
    version: 2,
    revision: 3,
    enabled: true,
    activation_rule: 'first_active_profile',
    daily_inviter_reward_limit: 10,
    rewards: [{ recipient: 'inviter', item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' }, gift_pack_version_id: null }],
    updated_at: null,
  },
  catalog: [
    { item_code: 'priority_compute_coupon', name: '优先计算券', description: '优先排队', kind: 'consumable', icon_key: 'priority_compute_coupon', issuance_enabled: true, selectable: true, unavailable_reason: null, latest_gift_pack_version: null },
    { item_code: 'plan_capacity_certificate', name: '方案扩容证', description: '增加方案槽位', kind: 'capacity_upgrade', icon_key: 'plan_capacity_certificate', issuance_enabled: true, selectable: true, unavailable_reason: null, latest_gift_pack_version: null },
  ],
  configured_gift_pack_versions: [],
}

beforeEach(() => {
  adminApiJson.mockReset()
  adminApiJson.mockResolvedValue(overview)
})

afterEach(() => cleanup())

describe('InvitationSettingsSection', () => {
  it('adds any selectable inventory item to a recipient reward group', async () => {
    const user = userEvent.setup()
    render(<InvitationSettingsSection />)

    await screen.findByText('优先计算券')
    await user.click(screen.getAllByRole('button', { name: '添加道具' })[0])

    const dialog = await screen.findByRole('dialog', { name: '添加邀请人奖励' })
    expect(dialog).toHaveTextContent('方案扩容证')
    await user.click(screen.getByRole('button', { name: /方案扩容证/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('方案扩容证')).toBeInTheDocument()
    expect(screen.getByText(/有未保存修改/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存邀请设置' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/invitation-settings', expect.objectContaining({
      method: 'PUT',
      json: expect.objectContaining({ expected_revision: 3 }),
    })))
  })
})
