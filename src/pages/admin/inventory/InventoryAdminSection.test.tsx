// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  adminApiJson.mockImplementation(async (_url: string, options?: { method?: string }) => options?.method === 'POST' ? {} : overview)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('InventoryAdminSection', () => {
  it.each(['random', 'choice'])('publishes a %s chest with multiple rewards from one form', async (mode) => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /礼包管理/ }))
    const form = screen.getByText('创建礼包或宝箱').closest('form') as HTMLFormElement
    const fields = within(form)
    await user.type(fields.getByLabelText('礼包名称'), '多选宝箱')
    await user.type(fields.getByLabelText('说明'), '领取两种奖励')
    await user.selectOptions(fields.getByLabelText('选择要添加的道具'), 'plan_capacity_certificate')
    await user.click(fields.getByRole('button', { name: '添加道具' }))
    await user.selectOptions(fields.getByLabelText('奖励方式'), mode)
    const count = fields.getByRole('spinbutton', { name: /每次领取项数/ })
    await user.clear(count)
    await user.type(count, '3')
    expect(fields.getByRole('button', { name: '创建并发布' })).toBeDisabled()
    await user.clear(count)
    await user.type(count, '2')
    await user.click(fields.getByRole('button', { name: '创建并发布' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/items', expect.objectContaining({
      json: expect.objectContaining({ action: 'create_gift_pack', opening_rule: { mode, count: 2 }, publish: true, contents: expect.arrayContaining([
        expect.objectContaining({ item_code: 'priority_compute_coupon' }),
        expect.objectContaining({ item_code: 'plan_capacity_certificate' }),
      ]) }),
    })))
  })

  it('splits the management workflow into accessible tabs', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)

    expect(await screen.findByRole('tabpanel', { name: '道具目录' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /道具目录/ })).toHaveClass('bg-brand-500', 'text-primary-foreground')
    expect(screen.getByText('维护系统道具的展示信息和发放状态')).toHaveClass('text-primary-foreground/80')
    expect(screen.queryByText('创建礼包或宝箱')).not.toBeInTheDocument()
    expect(screen.queryByText('单用户发放')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /礼包管理/ }))
    expect(screen.getByRole('tab', { name: /道具目录/ })).not.toHaveClass('bg-brand-500')
    expect(screen.getByRole('tab', { name: /礼包管理/ })).toHaveClass('bg-brand-500', 'text-primary-foreground')
    expect(screen.getByRole('tabpanel', { name: '礼包管理' })).toBeInTheDocument()
    expect(screen.getByText('创建礼包或宝箱')).toBeInTheDocument()
    expect(screen.queryByText(/内容 JSON|奖励 JSON/)).not.toBeInTheDocument()
    expect(screen.getByText('道具目录', { selector: 'h3' })).not.toBeVisible()
  })

  it('creates a gift pack from structured reward rows', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await screen.findByRole('tab', { name: /礼包管理/ })
    await user.click(screen.getByRole('tab', { name: /礼包管理/ }))

    const createForm = screen.getByText('创建礼包或宝箱').closest('form')
    expect(createForm).not.toBeNull()
    const form = within(createForm as HTMLFormElement)
    await user.type(form.getByLabelText('礼包名称'), '测试礼包')
    await user.type(form.getByLabelText('说明'), '测试礼包说明')
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
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string; json?: Record<string, unknown> }) => {
      if (options?.method === 'POST') {
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

    const createForm = screen.getByText('创建礼包或宝箱').closest('form')
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
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string; json?: Record<string, unknown> }) => {
      if (options?.method !== 'POST') return overview
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

    expect(within(screen.getByRole('tabpanel', { name: '新人任务' })).getByText('授权凭证')).toBeInTheDocument()
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
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string }) => options?.method === 'POST' ? {} : allUsersOverview)
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

  it('preserves catalog and reward drafts across refreshes and tab changes', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    const catalog = await screen.findByRole('tabpanel', { name: '道具目录' })
    await user.clear(within(catalog).getByLabelText('名称'))
    await user.type(within(catalog).getByLabelText('名称'), '尚未保存的名称')
    await user.click(screen.getByRole('tab', { name: /礼包管理/ }))
    const pack = within(screen.getByText('创建礼包或宝箱').closest('form') as HTMLFormElement)
    await user.type(pack.getByLabelText('礼包名称'), '尚未保存的礼包')
    await user.selectOptions(pack.getByLabelText('优先计算券有效期'), 'relative_days')
    await user.clear(pack.getByLabelText('优先计算券有效天数'))
    await user.type(pack.getByLabelText('优先计算券有效天数'), '45')
    await user.click(screen.getByRole('button', { name: '刷新道具数据' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新道具数据' })).toBeEnabled())
    await user.click(screen.getByRole('tab', { name: /道具目录/ }))
    expect(within(catalog).getByLabelText('名称')).toHaveValue('尚未保存的名称')
    await user.click(screen.getByRole('tab', { name: /礼包管理/ }))
    expect(pack.getByLabelText('礼包名称')).toHaveValue('尚未保存的礼包')
    expect(pack.getByLabelText('优先计算券有效天数')).toHaveValue(45)
  })

  it('allows publishing an empty disabled task but requires rewards before enabling it', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /新人任务/ }))
    await user.selectOptions(screen.getByLabelText('任务'), 'first_main_schedule')
    expect(screen.getByRole('button', { name: '发布停用版本' })).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: '新版本启用' }))
    expect(screen.getByRole('button', { name: '发布并启用' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '新版本启用' }))
    await user.click(screen.getByRole('button', { name: '发布停用版本' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/items', expect.objectContaining({
      json: expect.objectContaining({ action: 'configure_onboarding_task', task_code: 'first_main_schedule', enabled: false, rewards: [] }),
    })))
  })

  it('keeps grant, revocation and campaign inputs independent and confirms bulk issuance', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /发放中心/ }))
    const grant = within(screen.getByText('单用户发放').closest('form') as HTMLFormElement)
    const revoke = within(screen.getByText('撤回发放批次').closest('form') as HTMLFormElement)
    const campaign = within(screen.getByText('批量与全站发放').closest('form') as HTMLFormElement)
    await user.type(grant.getByLabelText('发放原因'), '单独发放原因')
    await user.clear(grant.getByLabelText('数量'))
    await user.type(grant.getByLabelText('数量'), '7')
    expect(campaign.getByLabelText('数量')).toHaveValue(1)
    expect(campaign.getByLabelText('管理员备注')).toHaveValue('')
    expect(revoke.getByLabelText('撤回原因')).toHaveValue('')
    expect(revoke.getByRole('button', { name: '撤回余额' })).toBeDisabled()
    await user.type(campaign.getByLabelText('用户 ID（逗号、空格或换行分隔）'), 'user-1，user-2 user-1')
    await user.type(campaign.getByLabelText('管理员备注'), '批量发放原因')
    await user.click(campaign.getByRole('button', { name: '创建发放活动' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 位用户各发放 1 个道具，共 2 个'))
    expect(adminApiJson.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    confirm.mockReturnValue(true)
    await user.click(campaign.getByRole('button', { name: '创建发放活动' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/inventory', expect.objectContaining({
      json: expect.objectContaining({ action: 'create_campaign', quantity: 1, reason: '批量发放原因', user_ids: ['user-1', 'user-2'] }),
    })))
  })

  it('blocks concurrent submissions and preserves the retry key when a response is lost', async () => {
    let rejectRequest!: (reason: Error) => void
    adminApiJson.mockImplementation((_url: string, options?: { method?: string }) => options?.method === 'POST'
      ? new Promise((_resolve, reject) => { rejectRequest = reject })
      : Promise.resolve(overview))
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /发放中心/ }))
    const form = screen.getByText('单用户发放').closest('form') as HTMLFormElement
    await user.type(within(form).getByLabelText('用户 ID'), 'user-1')
    await user.type(within(form).getByLabelText('发放原因'), '测试发放')
    fireEvent.submit(form)
    fireEvent.submit(form)
    const requests = () => adminApiJson.mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(requests()).toHaveLength(1)
    expect(within(form).getByRole('button', { name: '发放' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: /礼包管理/ })).toBeDisabled()
    await act(async () => { rejectRequest(new Error('response lost')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('response lost')
    fireEvent.submit(form)
    expect(requests()).toHaveLength(2)
    expect(requests()[1][1].json.idempotency_key).toBe(requests()[0][1].json.idempotency_key)
    await act(async () => { rejectRequest(new Error('response lost again')) })
  })

  it('keeps successful issuance distinct from a failed overview refresh', async () => {
    let reads = 0
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return { grant_id: 'grant-confirmed' }
      if (++reads === 1) return overview
      throw new Error('refresh unavailable')
    })
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /发放中心/ }))
    await user.type(screen.getByLabelText('用户 ID'), 'user-1')
    await user.type(screen.getByLabelText('发放原因'), '测试发放')
    await user.click(screen.getByRole('button', { name: '发放' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('refresh unavailable')
    expect(await screen.findByText(/最近发放批次 ID：grant-confirmed/)).toBeInTheDocument()
    expect(screen.getByLabelText('发放批次 ID')).toHaveValue('grant-confirmed')
    expect(adminApiJson.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('excludes unavailable gift packs and clears a pinned version when switching items', async () => {
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string }) => options?.method === 'POST' ? {} : {
      ...overview,
      definitions: [...definitions, { ...definitions[2], code: 'unpublished_pack', name: '未发布礼包' }],
    })
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /发放中心/ }))
    const form = within(screen.getByText('单用户发放').closest('form') as HTMLFormElement)
    expect(within(form.getByLabelText('道具')).queryByRole('option', { name: /未发布礼包/ })).not.toBeInTheDocument()
    await user.selectOptions(form.getByLabelText('道具'), 'newcomer_supply_pack')
    await user.selectOptions(form.getByLabelText('礼包版本'), 'pack-version-1')
    await user.selectOptions(form.getByLabelText('道具'), 'priority_compute_coupon')
    await user.type(form.getByLabelText('用户 ID'), 'user-1')
    await user.type(form.getByLabelText('发放原因'), '切换道具发放')
    await user.click(form.getByRole('button', { name: '发放' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/inventory', expect.objectContaining({
      json: expect.objectContaining({ item_code: 'priority_compute_coupon' }),
    })))
    const request = adminApiJson.mock.calls.find(([, options]) => options?.json?.action === 'grant')?.[1]
    expect(request.json).not.toHaveProperty('gift_pack_version_id')
  })

  it('rejects invalid reward quantities and expiry before publishing', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /礼包管理/ }))
    const form = screen.getByText('创建礼包或宝箱').closest('form') as HTMLFormElement
    const fields = within(form)
    await user.type(fields.getByLabelText('礼包名称'), '有效性检查')
    await user.type(fields.getByLabelText('说明'), '有效性检查礼包')
    await user.selectOptions(fields.getByLabelText('优先计算券有效期'), 'relative_days')
    await user.clear(fields.getByLabelText('优先计算券有效天数'))
    expect(fields.getByLabelText('优先计算券有效天数')).toHaveValue(null)
    expect(fields.getByRole('button', { name: '创建并发布' })).toBeDisabled()
    for (const days of ['0', '3651', '1.5']) {
      fireEvent.change(fields.getByLabelText('优先计算券有效天数'), { target: { value: days } })
      expect(fields.getByRole('button', { name: '创建并发布' })).toBeDisabled()
      fireEvent.submit(form)
    }
    fireEvent.change(fields.getByLabelText('优先计算券有效天数'), { target: { value: '3650' } })
    fireEvent.change(fields.getByLabelText('优先计算券数量'), { target: { value: '10001' } })
    expect(fields.getByRole('button', { name: '创建并发布' })).toBeDisabled()
    fireEvent.submit(form)
    expect(adminApiJson.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    await user.clear(fields.getByLabelText('优先计算券数量'))
    expect(fields.getByLabelText('优先计算券数量')).toHaveValue(null)
    expect(fields.getByRole('button', { name: '创建并发布' })).toBeDisabled()
    fireEvent.change(fields.getByLabelText('优先计算券数量'), { target: { value: '10000' } })
    expect(fields.getByRole('button', { name: '创建并发布' })).toBeEnabled()
  })

  it('switches tabs with the keyboard and maintains one tab stop', async () => {
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    const catalog = await screen.findByRole('tab', { name: /道具目录/ })
    catalog.focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /操作审计/ })).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: '操作审计' })).toBeVisible()
    await user.keyboard('{Home}{ArrowRight}')
    expect(screen.getByRole('tab', { name: /礼包管理/ })).toHaveFocus()
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
    expect(screen.getByRole('tabpanel', { name: '礼包管理' })).toBeVisible()
  })

  it('exports failed recipients as CSV without allowing spreadsheet formulas', async () => {
    let exported!: Blob
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(blob: Blob) { exported = blob; return 'blob:failures' }
      static revokeObjectURL = revokeObjectURL
    })
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    adminApiJson.mockResolvedValue({
      ...overview,
      campaigns: [{
        id: 'campaign-failed', item_code: 'priority_compute_coupon', target_mode: 'user_ids', status: 'completed_with_failures',
        recipient_count: 1, granted_count: 0, failed_count: 1, pending_count: 0, processing_count: 0, skipped_count: 0, revoked_count: 0,
        failed_recipients: [{ user_id: 'user-1', attempt_count: 2, processed_at: null, error_message: '=2+3,"failed"\nretry' }],
      }],
    })
    const user = userEvent.setup()
    render(<InventoryAdminSection />)
    await user.click(await screen.findByRole('tab', { name: /发放中心/ }))
    await user.click(screen.getByText('查看失败收件人与原因'))
    await user.click(screen.getByRole('button', { name: '导出失败 CSV' }))
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(exported)
    })
    expect(csv).toContain('"user-1","2","","\'=2+3,""failed""\nretry"')
    expect(download).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:failures')
  })
})
