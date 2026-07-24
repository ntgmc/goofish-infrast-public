// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvitationSummary } from '../../../lib/types'
import InvitationsSection from './InvitationsSection'

const apiJson = vi.fn()
vi.mock('../../../lib/api-client', () => ({ apiJson: (...args: unknown[]) => apiJson(...args) }))

const summary: InvitationSummary = {
  can_invite: true,
  campaign_enabled: true,
  code: '12AB34CD5E',
  share_url: '/tool/profiles?invite=12AB34CD5E',
  reward_preview: {
    inviter: [{ item_code: 'priority_compute_coupon', name: '优先计算券', description: '优先排队', kind: 'consumable', icon_key: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' }, gift_pack_version: null, available: true }],
    invitee: [{ item_code: 'plan_capacity_certificate', name: '方案扩容证', description: '增加槽位', kind: 'capacity_upgrade', icon_key: 'plan_capacity_certificate', quantity: 1, expiry: { mode: 'relative_days', days: 30 }, gift_pack_version: null, available: true }],
  },
  stats: { registered: 3, activated: 2, rewarded_invitations: 1, today_rewarded: 1 },
  daily_limit: { used: 1, limit: 10, remaining: 9, reset_at: '2026-07-26T16:00:00.000Z' },
  records: [{
    id: 'invite-1',
    invitee_label: '受邀用户 #A1B2C3',
    registered_at: '2026-07-25T01:00:00.000Z',
    activated_at: '2026-07-25T02:00:00.000Z',
    status: 'settled',
    inviter_reward_status: 'granted',
    inviter_rewards: [{ item_code: 'priority_compute_coupon', name: '优先计算券', description: '优先排队', kind: 'consumable', icon_key: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' }, gift_pack_version: null, available: true }],
  }],
  next_cursor: null,
}

beforeEach(() => {
  apiJson.mockReset()
  apiJson.mockResolvedValue(summary)
})

afterEach(() => cleanup())

describe('InvitationsSection', () => {
  it('shows reward cards, quota progress and anonymized invitation records without loading legacy balances', async () => {
    render(<InvitationsSection />)

    expect(await screen.findAllByText(/优先计算券/)).not.toHaveLength(0)
    expect(screen.getByText(/方案扩容证/)).toBeInTheDocument()
    expect(screen.getAllByText('1 / 10')).not.toHaveLength(0)
    expect(screen.getAllByText('受邀用户 #A1B2C3')).not.toHaveLength(0)
    expect(apiJson).toHaveBeenCalledTimes(1)
    expect(apiJson).toHaveBeenCalledWith('/api/user/invitations')
  })
})
