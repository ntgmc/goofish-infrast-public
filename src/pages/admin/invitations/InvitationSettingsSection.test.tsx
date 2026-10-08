// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  stats: {
    as_of: '2026-09-30T03:00:00.000Z',
    registered: 20,
    activated: 10,
    rewarded_invitations: 7,
    pending_rewards: 1,
    retrying_rewards: 1,
    failed_rewards: 1,
    today_registered: 4,
    today_activated: 3,
    today_rewarded: 2,
  },
}

beforeEach(() => {
  adminApiJson.mockReset()
  adminApiJson.mockResolvedValue(overview)
})

afterEach(() => cleanup())

describe('InvitationSettingsSection', () => {
  it('shows invitation totals, activation rate, reward states and today counts', async () => {
    const user = userEvent.setup()
    render(<InvitationSettingsSection />)
    await user.click(await screen.findByRole('tab', { name: '邀请统计' }))
    const stats = within(screen.getByRole('tabpanel', { name: '邀请统计' }))
    for (const [label, value] of [
      ['累计邀请注册', 20], ['累计激活', 10], ['累计已发奖', 7],
      ['待发奖', 1], ['发奖重试中', 1], ['发奖失败', 1],
      ['今日邀请注册', 4], ['今日激活', 3], ['今日已发奖', 2],
    ] as const) {
      expect(within(stats.getByText(label).parentElement!).getByText(String(value))).toBeInTheDocument()
    }
    expect(stats.getByText(/激活率 50.0%/)).toBeInTheDocument()
    expect(stats.getByText(/至少一方收到奖励/)).toBeInTheDocument()
    expect(stats.getByText(/上海时间/)).toBeInTheDocument()
  })

  it('handles empty invitation stats and refreshes them when reloading', async () => {
    const user = userEvent.setup()
    adminApiJson.mockResolvedValueOnce({
      ...overview,
      stats: {
        ...overview.stats,
        registered: 0, activated: 0, rewarded_invitations: 0,
        pending_rewards: 0, retrying_rewards: 0, failed_rewards: 0,
        today_registered: 0, today_activated: 0, today_rewarded: 0,
      },
    })
    render(<InvitationSettingsSection />)
    expect(await screen.findByText(/激活率 0.0%/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新载入' }))
    expect(await screen.findByText(/激活率 50.0%/)).toBeInTheDocument()
    expect(adminApiJson).toHaveBeenCalledTimes(2)
  })

  it('adds any selectable inventory item to a recipient reward group', async () => {
    const user = userEvent.setup()
    render(<InvitationSettingsSection />)

    await screen.findByText('优先计算券')
    await user.click(screen.getAllByRole('button', { name: '添加道具' })[0])

    const dialog = await screen.findByRole('dialog', { name: '添加邀请人奖励' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(dialog).toHaveClass('block', 'max-w-2xl')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeInTheDocument()
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

  it('closes the local dialog with Escape and restores the add trigger', async () => {
    const user = userEvent.setup()
    render(<InvitationSettingsSection />)

    await screen.findByText('优先计算券')
    const trigger = screen.getAllByRole('button', { name: '添加道具' })[0]
    trigger.focus()
    await user.click(trigger)
    await screen.findByRole('dialog', { name: '添加邀请人奖励' })

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})
