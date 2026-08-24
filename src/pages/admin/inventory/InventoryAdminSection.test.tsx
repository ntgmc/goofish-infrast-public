// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemDefinition } from '../../../lib/inventory-contracts'
import InventoryAdminSection from './InventoryAdminSection'

const adminApiJson = vi.fn()
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: (...args: unknown[]) => adminApiJson(...args) }))
const timestamp = '2026-08-01T00:00:00.000Z'

const definitions: ItemDefinition[] = [
  {
    code: 'priority_compute_coupon', kind: 'consumable', effect_code: 'priority_compute',
    name: '优先计算券', description: '进入最高优先队列', icon_key: 'priority_compute_coupon',
    system_owned: true, issuance_enabled: true, created_at: null, updated_at: null,
  },
  {
    code: 'plan_capacity_certificate', kind: 'capacity_upgrade', effect_code: 'plan_capacity',
    name: '方案扩容证', description: '增加方案槽位', icon_key: 'plan_capacity_certificate',
    system_owned: true, issuance_enabled: true, created_at: null, updated_at: null,
  },
  {
    code: 'newcomer_supply_pack', kind: 'gift_pack', effect_code: 'open_gift_pack',
    name: '新人补给包', description: '新人礼包', icon_key: 'newcomer_supply_pack',
    system_owned: true, issuance_enabled: true, created_at: null, updated_at: null,
  },
  {
    code: 'lifetime_profile_voucher', kind: 'license_voucher', effect_code: 'bind_lifetime_profile',
    name: '终身版兑换 CDK', description: '创建终身档案', icon_key: 'lifetime_profile_voucher',
    system_owned: true, issuance_enabled: true, created_at: null, updated_at: null,
  },
]

const overview = {
  definitions,
  gift_pack_versions: [{
    id: 'pack-version-1', item_code: 'newcomer_supply_pack', version: 1, status: 'published' as const,
    contents: [{ item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' as const } }],
    created_at: timestamp,
    published_at: timestamp,
  }],
  tasks: [
    { task_code: 'welcome_inventory' as const, version: 2, enabled: true, rewards_json: [{ item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' as const } }], created_at: timestamp },
    { task_code: 'bind_skland' as const, version: 1, enabled: false, rewards_json: [{ item_code: 'plan_capacity_certificate', quantity: 1, expiry: { mode: 'relative_days' as const, days: 30 } }], created_at: timestamp },
    { task_code: 'first_main_schedule' as const, version: 1, enabled: false, rewards_json: [], created_at: timestamp },
  ],
  campaigns: [],
  audits: [],
  user_count: 3,
}

beforeEach(() => {
  adminApiJson.mockReset()
  adminApiJson.mockImplementation(async (_url: string, options?: unknown) => options ? {} : overview)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('InventoryAdminSection', () => {
  it('splits the management workflow into accessible tabs', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)

    expect(await screen.findByRole('tabpanel', { name: '道具目录' })).toBeInTheDocument()
    expect(screen.queryByText('创建自定义礼包')).not.toBeInTheDocument()
    expect(screen.queryByText('单用户发放')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /礼包管理/ }))
    expect(screen.getByRole('tabpanel', { name: '礼包管理' })).toBeInTheDocument()
    expect(screen.getByText('创建自定义礼包')).toBeInTheDocument()
    expect(screen.queryByText(/内容 JSON|奖励 JSON/)).not.toBeInTheDocument()
    expect(screen.queryByText('道具目录', { selector: 'h3' })).not.toBeInTheDocument()
  })

  it('creates a gift pack from structured reward rows', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await screen.findByRole('tab', { name: /礼包管理/ })
    await user.click(screen.getByRole('tab', { name: /礼包管理/ }))

    const createForm = screen.getByText('创建自定义礼包').closest('form')
    expect(createForm).not.toBeNull()
    const form = within(createForm as HTMLFormElement)
    await user.type(form.getByLabelText('礼包名称'), '测试礼包')
    await user.selectOptions(form.getByLabelText('选择要添加的道具'), 'plan_capacity_certificate')
    await user.click(form.getByRole('button', { name: '添加道具' }))
    await user.clear(form.getByLabelText('方案扩容证数量'))
    await user.type(form.getByLabelText('方案扩容证数量'), '2')
    await user.selectOptions(form.getByLabelText('方案扩容证有效期'), 'relative_days')
    await user.clear(form.getByLabelText('方案扩容证有效天数'))
    await user.type(form.getByLabelText('方案扩容证有效天数'), '45')
    await user.click(form.getByRole('button', { name: '创建草稿' }))

    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/items', expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({
        action: 'create_gift_pack',
        name: '测试礼包',
        contents: [
          { item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' } },
          { item_code: 'plan_capacity_certificate', quantity: 2, expiry: { mode: 'relative_days', days: 45 } },
        ],
      }),
    })))
  })

  it('edits onboarding rewards without exposing JSON and keeps task drafts separate', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await screen.findByRole('tab', { name: /新人任务/ })
    await user.click(screen.getByRole('tab', { name: /新人任务/ }))

    expect(screen.getByRole('option', { name: '认识网站' })).toBeInTheDocument()
    expect(screen.queryByText('认识背包')).not.toBeInTheDocument()
    expect(screen.queryByText(/奖励 JSON/)).not.toBeInTheDocument()
    expect(screen.getByText('认识网站奖励')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('任务'), 'bind_skland')
    expect(screen.getByText('绑定森空岛奖励')).toBeInTheDocument()
    expect(screen.getByLabelText('方案扩容证数量')).toHaveValue(1)

    await user.selectOptions(screen.getByLabelText('选择要添加的道具'), 'newcomer_supply_pack')
    await user.click(screen.getByRole('button', { name: '添加道具' }))
    expect(screen.getByText('保存时固定 v1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '发布停用版本' }))

    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/items', expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({
        action: 'configure_onboarding_task',
        task_code: 'bind_skland',
        rewards: [
          { item_code: 'plan_capacity_certificate', quantity: 1, expiry: { mode: 'relative_days', days: 30 } },
          { item_code: 'newcomer_supply_pack', quantity: 1, expiry: { mode: 'never' } },
        ],
      }),
    })))

    await user.selectOptions(screen.getByLabelText('任务'), 'welcome_inventory')
    expect(screen.getByLabelText('优先计算券数量')).toHaveValue(1)
    expect(screen.queryByLabelText('方案扩容证数量')).not.toBeInTheDocument()
  })

  it('publishes an enabled onboarding task version and refreshes its status', async () => {
    let published = false
    adminApiJson.mockImplementation(async (_url: string, options?: { json?: Record<string, unknown> }) => {
      if (options) {
        published = true
        return {}
      }
      return {
        ...overview,
        tasks: overview.tasks.map((task) => task.task_code === 'bind_skland' && published
          ? { ...task, version: 2, enabled: true }
          : task),
      }
    })
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /新人任务/ }))
    await user.selectOptions(screen.getByLabelText('任务'), 'bind_skland')

    expect(screen.getByText('当前 v1 已停用。启用新版本前必须配置奖励。')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '新版本启用' }))
    await user.click(screen.getByRole('button', { name: '发布并启用' }))

    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/items', expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({
        action: 'configure_onboarding_task',
        task_code: 'bind_skland',
        enabled: true,
      }),
    })))
    expect(await screen.findByText('当前 v2 已启用。启用新版本前必须配置奖励。')).toBeInTheDocument()
  })

  it('does not offer nested gift packs inside gift pack contents', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await screen.findByRole('tab', { name: /礼包管理/ })
    await user.click(screen.getByRole('tab', { name: /礼包管理/ }))

    const createForm = screen.getByText('创建自定义礼包').closest('form')
    expect(createForm).not.toBeNull()
    const selector = within(createForm as HTMLFormElement).getByLabelText('选择要添加的道具')
    expect(within(selector).queryByRole('option', { name: /新人补给包/ })).not.toBeInTheDocument()
  })

  it('shows the initial load error and retries instead of staying in a loading state', async () => {
    adminApiJson
      .mockRejectedValueOnce(new Error('overview unavailable'))
      .mockResolvedValueOnce(overview)

    const user = userEvent.setup()
    render(<InventoryAdminSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('overview unavailable')
    expect(screen.queryByText('正在加载道具管理…')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试加载' }))
    expect(await screen.findByRole('tabpanel', { name: '道具目录' })).toBeInTheDocument()
  })

  it('reuses an administrator idempotency key after an unknown grant result', async () => {
    const grantKeys: string[] = []
    let grantAttempt = 0
    adminApiJson.mockImplementation(async (_url: string, options?: { json?: Record<string, unknown> }) => {
      if (!options) return overview
      if (options.json?.action === 'grant') {
        grantKeys.push(String(options.json.idempotency_key))
        grantAttempt += 1
        if (grantAttempt === 1) throw new Error('response lost')
        return { grant_id: 'grant-1' }
      }
      return {}
    })
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /发放中心/ }))

    await user.type(screen.getByLabelText('用户 ID'), 'user-1')
    await user.type(screen.getByLabelText('发放原因'), '测试幂等发放')
    await user.click(screen.getByRole('button', { name: '发放' }))
    expect(await screen.findByText('response lost')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '发放' }))

    await waitFor(() => expect(grantKeys).toHaveLength(2))
    expect(grantKeys[0]).toBeTruthy()
    expect(grantKeys[1]).toBe(grantKeys[0])
  })

  it('labels license vouchers explicitly in reward editors', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /新人任务/ }))
    await user.selectOptions(screen.getByLabelText('选择要添加的道具'), 'lifetime_profile_voucher')
    await user.click(screen.getByRole('button', { name: '添加道具' }))

    expect(screen.getByText('授权凭证')).toBeInTheDocument()
    expect(screen.queryByText('成就勋章（预留）')).not.toBeInTheDocument()
  })

  it('requires and submits a Root password when reversing an all-users campaign', async () => {
    const allUsersOverview = {
      ...overview,
      campaigns: [{
        id: 'campaign-all',
        item_code: 'priority_compute_coupon',
        target_mode: 'all_users' as const,
        status: 'completed' as const,
        recipient_count: 3,
        granted_count: 3,
        failed_count: 0,
        pending_count: 0,
        processing_count: 0,
        skipped_count: 0,
        revoked_count: 0,
        failed_recipients: [],
      }],
    }
    adminApiJson.mockImplementation(async (_url: string, options?: unknown) => options ? {} : allUsersOverview)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /发放中心/ }))

    const reverse = screen.getByRole('button', { name: '撤回未消费余额' })
    expect(reverse).toBeDisabled()
    await user.type(screen.getByLabelText('全站撤回 Root 口令'), 'root-secret')
    expect(reverse).toBeEnabled()
    await user.click(reverse)

    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/inventory', expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({
        action: 'reverse_campaign',
        campaign_id: 'campaign-all',
        root_password: 'root-secret',
      }),
    })))
    expect(confirm).toHaveBeenCalledOnce()
    confirm.mockRestore()
  })
})
