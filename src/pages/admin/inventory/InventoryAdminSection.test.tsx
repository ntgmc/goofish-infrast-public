// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemDefinition } from '../../../lib/inventory-contracts'
import InventoryAdminSection from './InventoryAdminSection'

const adminApiJson = vi.fn()
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: (...args: unknown[]) => adminApiJson(...args) }))

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
]

const overview = {
  definitions,
  gift_pack_versions: [{
    id: 'pack-version-1', item_code: 'newcomer_supply_pack', version: 1, status: 'published' as const,
    contents: [{ item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' as const } }],
  }],
  tasks: [
    { task_code: 'welcome_inventory' as const, version: 2, enabled: true, rewards_json: [{ item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' as const } }] },
    { task_code: 'bind_skland' as const, version: 1, enabled: false, rewards_json: [{ item_code: 'plan_capacity_certificate', quantity: 1, expiry: { mode: 'relative_days' as const, days: 30 } }] },
    { task_code: 'first_main_schedule' as const, version: 1, enabled: false, rewards_json: [] },
  ],
  campaigns: [],
  audits: [],
  user_count: 3,
}

beforeEach(() => {
  adminApiJson.mockReset()
  adminApiJson.mockImplementation(async (_url: string, options?: unknown) => options ? {} : overview)
})

afterEach(() => cleanup())

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
    await user.click(screen.getByRole('button', { name: '发布任务配置' }))

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
})
