// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventoryResponse, ItemUseRequest } from '../../../lib/inventory-contracts'
import InventorySection from './InventorySection'

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  onboardingTasksEnabled: true,
  animate: vi.fn(async (_from: number, values: number[], options: { onUpdate: (value: number) => void }) => options.onUpdate(values[1])),
}))

vi.mock('motion/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('motion/react')>(),
  useAnimate: () => [{ current: null }, mocks.animate],
  useReducedMotion: () => false,
}))

vi.mock('../../../lib/api-client', () => ({
  apiJson: mocks.apiJson,
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}))

vi.mock('../../../components/SklandBindingDialog', () => ({ default: () => null }))

vi.mock('../../../lib/site-feature-context', () => ({
  useSiteFeatures: () => ({ features: { onboarding_tasks: mocks.onboardingTasksEnabled } }),
}))

const inventory: InventoryResponse = {
  stacks: [{
    stack_id: 'limited_profile_voucher:',
    item: {
      code: 'limited_profile_voucher',
      kind: 'license_voucher',
      effect_code: 'activate_limited_profile',
      name: '限时 CDK',
      description: '临时激活高级权限。',
      icon_key: 'limited_profile_voucher',
      system_owned: true,
      issuance_enabled: true,
      created_at: null,
      updated_at: null,
    },
    gift_pack_version_id: null,
    quantity: 1,
    permanent: 0,
    next_expiry_at: '2026-08-19T16:00:00.000Z',
    expiry_buckets: [{ quantity: 1, expires_at: '2026-08-19T16:00:00.000Z' }],
    actions: ['use'],
  }],
  capacities: [],
  recent_events: [],
}

const lifetimeInventory: InventoryResponse = {
  ...inventory,
  stacks: [{
    stack_id: 'lifetime_profile_voucher',
    item: {
      code: 'lifetime_profile_voucher',
      kind: 'license_voucher',
      effect_code: 'bind_lifetime_profile',
      name: '终身版兑换 CDK',
      description: '创建终身高级档案。',
      icon_key: 'lifetime_profile_voucher',
      system_owned: true,
      issuance_enabled: true,
      created_at: null,
      updated_at: null,
    },
    gift_pack_version_id: null,
    quantity: 1,
    permanent: 1,
    next_expiry_at: null,
    expiry_buckets: [{ quantity: 1, expires_at: null }],
    actions: ['bind'],
  }],
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mocks.apiJson.mockReset()
  mocks.animate.mockClear()
  mocks.onboardingTasksEnabled = true
})

describe('InventorySection idempotent item use', () => {
  it('shows item descriptions and animates one reveal for a batch before opening the rewards dialog', async () => {
    let finishReveal!: () => void
    mocks.animate.mockImplementationOnce(async (_from, values, options) => {
      options.onUpdate(values[1])
      await new Promise<void>((resolve) => { finishReveal = resolve })
    })
    const chest: InventoryResponse = {
      ...inventory,
      stacks: [{
        ...inventory.stacks[0],
        item: { ...inventory.stacks[0].item, code: 'chest', name: '随机宝箱', kind: 'gift_pack', effect_code: 'open_gift_pack' },
        quantity: 3,
        actions: ['open'],
        gift_pack_version_id: 'chest-v1',
        gift_pack: {
          opening_rule: { mode: 'random', count: 1 },
          contents: [
            { item_code: 'priority_compute_coupon', name: '优先计算券', description: '排班优先处理。', icon_key: 'placeholder', quantity: 1, expiry: { mode: 'never' } },
            { item_code: 'training_diagnosis_coupon', name: '培养诊断券', description: '获取养成建议。', icon_key: 'placeholder', quantity: 1, expiry: { mode: 'never' } },
          ],
        },
      }],
    }
    let opened = false
    mocks.apiJson.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/api/user/onboarding-tasks') return { tasks: [] }
      if (options?.method === 'POST') {
        opened = true
        return { rewards: [{ item_code: 'training_diagnosis_coupon', name: '培养诊断券', icon_key: 'placeholder', quantity: 2, expires_at: null }] }
      }
      return opened ? { ...chest, stacks: [] } : chest
    })
    const user = userEvent.setup()
    render(<InventorySection onPayload={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /随机宝箱/ }))
    await user.hover(screen.getByText('优先计算券 × 1'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('排班优先处理。')
    const quantity = screen.getByRole('spinbutton', { name: '使用数量' })
    await user.clear(quantity)
    await user.type(quantity, '2')
    await user.click(screen.getByRole('button', { name: '开启宝箱' }))
    expect(await screen.findByText('正在揭晓奖励…')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '获得的道具' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '随机宝箱' })).toBeInTheDocument()
    await act(async () => finishReveal())
    const rewards = await screen.findByRole('dialog', { name: '获得的道具' })
    expect(within(rewards).getByText('培养诊断券 × 2')).toBeInTheDocument()
    expect(mocks.animate).toHaveBeenCalledOnce()
    expect(mocks.animate).toHaveBeenCalledWith(0, [0, 7, 7], expect.objectContaining({ ease: ['easeInOut', 'linear'] }))
    expect(mocks.apiJson).toHaveBeenCalledWith('/api/user/inventory', expect.objectContaining({
      method: 'POST', json: expect.objectContaining({ quantity: 2 }),
    }))
    await user.click(within(rewards).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '获得的道具' })).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: '按道具名称筛选' })).toHaveFocus()
  })

  it('bounds batch capacity upgrades by stock and remaining capacity', async () => {
    const folders: InventoryResponse = {
      ...inventory,
      stacks: [{
        ...inventory.stacks[0],
        item: { ...inventory.stacks[0].item, code: 'result_archive_folder', name: '结果封存夹', kind: 'capacity_upgrade', effect_code: 'result_archive_capacity' },
        quantity: 5,
      }],
      capacities: [{
        profile_id: 'profile-1', display_name: '我的档案',
        plan_slots: { used: 0, limit: 3, maximum: 20 },
        history_slots: { used: 0, limit: 5, maximum: 50 },
        archive_slots: { used: 0, limit: 18, maximum: 20 },
      }],
    }
    mocks.apiJson.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/api/user/onboarding-tasks') return { tasks: [] }
      if (options?.method === 'POST') return { previous_limit: 18, next_limit: 20, maximum: 20 }
      return folders
    })
    const user = userEvent.setup()
    render(<InventorySection onPayload={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /结果封存夹/ }))
    await user.selectOptions(screen.getByRole('combobox'), 'profile-1')
    const quantity = screen.getByRole('spinbutton', { name: '使用数量' })
    expect(quantity).toHaveAttribute('max', '2')
    await user.clear(quantity)
    await user.type(quantity, '3')
    expect(screen.getByRole('button', { name: '使用道具' })).toBeDisabled()
    await user.clear(quantity)
    await user.type(quantity, '2')
    await user.click(screen.getByRole('button', { name: '使用道具' }))
    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledWith('/api/user/inventory', expect.objectContaining({
      method: 'POST', json: expect.objectContaining({ item_code: 'result_archive_folder', quantity: 2, profile_id: 'profile-1' }),
    })))
  })

  it('requires the configured number of choices and reuses the request after a lost chest response', async () => {
    const chest: InventoryResponse = { ...inventory, stacks: [{
      ...inventory.stacks[0],
      stack_id: 'chest:chest-v1',
      item: { ...inventory.stacks[0].item, code: 'chest', name: '自选宝箱', kind: 'gift_pack', effect_code: 'open_gift_pack' },
      gift_pack_version_id: 'chest-v1',
      actions: ['open'],
      gift_pack: {
        opening_rule: { mode: 'choice', count: 2 },
        contents: [
          { item_code: 'priority_compute_coupon', name: '优先计算券', icon_key: 'placeholder', quantity: 3, expiry: { mode: 'never' } },
          { item_code: 'training_diagnosis_coupon', name: '培养诊断券', icon_key: 'placeholder', quantity: 2, expiry: { mode: 'relative_days', days: 7 } },
          { item_code: 'plan_capacity_certificate', name: '方案扩容证', icon_key: 'placeholder', quantity: 1, expiry: { mode: 'never' } },
        ],
      },
    }] }
    const requests: ItemUseRequest[] = []
    mocks.apiJson.mockImplementation(async (path: string, options?: { json?: ItemUseRequest }) => {
      if (path === '/api/user/onboarding-tasks') return { tasks: [] }
      if (!options?.json) return chest
      requests.push(options.json)
      if (requests.length === 1) throw new Error('response lost')
      return { rewards: [] }
    })
    const user = userEvent.setup()
    render(<InventorySection onPayload={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /自选宝箱/ }))
    const open = screen.getByRole('button', { name: '开启宝箱' })
    expect(open).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /优先计算券/ }))
    expect(open).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /培养诊断券/ }))
    expect(screen.getByRole('checkbox', { name: /方案扩容证/ })).toBeDisabled()
    await user.click(open)
    await screen.findByText('response lost')
    await user.click(open)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[0]).toEqual(requests[1])
    expect(requests[0].selected_item_codes).toEqual(['priority_compute_coupon', 'training_diagnosis_coupon'])
  })

  it('uses the local dialog contract and restores item focus on Escape', async () => {
    mocks.apiJson.mockImplementation(async (path: string) => {
      if (path === '/api/user/onboarding-tasks') return { tasks: [] }
      if (path === '/api/user/inventory') return inventory
      throw new Error(`unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    render(<InventorySection onPayload={vi.fn()} />)

    const trigger = await screen.findByRole('button', { name: /限时 CDK/ })
    trigger.focus()
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '限时 CDK' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(dialog).toHaveClass('block')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('shows onboarding reward details and recent asset events', async () => {
    mocks.apiJson.mockImplementation(async (path: string) => {
      if (path === '/api/user/onboarding-tasks') return { tasks: [{
        code: 'welcome_inventory',
        version_id: 'welcome-v2',
        version: 2,
        title: '认识网站',
        description: '浏览库存页面',
        enabled: true,
        status: 'claimable',
        completed_at: '2026-08-01T00:00:00.000Z',
        claimed_at: null,
        rewards: [{
          item_code: 'priority_compute_coupon',
          name: '优先计算券',
          icon_key: 'priority_compute_coupon',
          quantity: 2,
          expiry: { mode: 'never' },
        }],
      }] }
      if (path === '/api/user/inventory') return {
        ...inventory,
        recent_events: [{
          id: 'event-1',
          item_code: 'priority_compute_coupon',
          item_name: '优先计算券',
          icon_key: 'priority_compute_coupon',
          event_type: 'grant',
          quantity: 2,
          reference_type: 'onboarding_task',
          reference_id: 'welcome-v2',
          created_at: '2026-08-01T00:00:00.000Z',
          metadata: {},
        }],
      }
      throw new Error(`unexpected request: ${path}`)
    })

    render(<InventorySection onPayload={vi.fn()} />)

    expect(await screen.findByRole('list', { name: '认识网站奖励' })).toHaveTextContent('优先计算券 × 2 · 永久')
    const user = userEvent.setup()
    const historyToggle = screen.getByText('最近道具记录').closest('summary')!
    const history = historyToggle.closest('details')!
    expect(history).not.toHaveAttribute('open')
    await user.click(historyToggle)
    expect(history).toHaveAttribute('open')
    expect(screen.getByText('已获得 × 2')).toBeInTheDocument()
    await user.click(historyToggle)
    expect(history).not.toHaveAttribute('open')
  })

  it('loads inventory without requesting onboarding tasks when the feature is disabled', async () => {
    mocks.onboardingTasksEnabled = false
    mocks.apiJson.mockImplementation(async (path: string) => {
      if (path === '/api/user/inventory') return inventory
      throw new Error(`unexpected request: ${path}`)
    })

    render(<InventorySection onPayload={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /限时 CDK/ })).toBeInTheDocument()
    expect(mocks.apiJson).not.toHaveBeenCalledWith('/api/user/onboarding-tasks')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps inventory available when onboarding tasks cannot be loaded', async () => {
    mocks.apiJson.mockImplementation(async (path: string) => {
      if (path === '/api/user/onboarding-tasks') throw new Error('该功能当前未开放。')
      if (path === '/api/user/inventory') return inventory
      throw new Error(`unexpected request: ${path}`)
    })

    render(<InventorySection onPayload={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /限时 CDK/ })).toBeInTheDocument()
    expect(screen.queryByText('该功能当前未开放。')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reuses the key after an unknown failure and rotates it only after success', async () => {
    const itemRequests: ItemUseRequest[] = []
    mocks.apiJson.mockImplementation(async (path: string, options?: { method?: string; json?: ItemUseRequest }) => {
      if (path === '/api/user/onboarding-tasks') return { tasks: [] }
      if (path === '/api/user/inventory' && options?.method === 'POST') {
        itemRequests.push(options.json!)
        if (itemRequests.length === 1) throw new Error('network result unknown')
        return {}
      }
      if (path === '/api/user/inventory') return inventory
      throw new Error(`unexpected request: ${path}`)
    })

    const user = userEvent.setup()
    render(<InventorySection onPayload={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /限时 CDK/ }))
    await user.click(screen.getByRole('button', { name: '使用道具' }))
    expect(await screen.findByText('network result unknown')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '使用道具' }))
    await waitFor(() => expect(itemRequests).toHaveLength(2))
    expect(itemRequests[1].idempotency_key).toBe(itemRequests[0].idempotency_key)

    await user.click(await screen.findByRole('button', { name: /限时 CDK/ }))
    await user.click(screen.getByRole('button', { name: '使用道具' }))
    await waitFor(() => expect(itemRequests).toHaveLength(3))
    expect(itemRequests[2].idempotency_key).not.toBe(itemRequests[1].idempotency_key)
  })

  it('syncs the activated profile and offers a route to the updated profiles page', async () => {
    const onPayload = vi.fn()
    const onViewProfiles = vi.fn()
    const payload = {
      user: { id: 'user-1' },
      profiles: [{ id: 'preview-1', display_name: '主账号' }],
      active_profile: { id: 'preview-1', display_name: '主账号' },
      workspace: null,
    }
    let inventoryLoads = 0
    mocks.apiJson.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/api/user/onboarding-tasks') return { tasks: [] }
      if (path === '/api/user/inventory' && options?.method === 'POST') {
        return {
          operation_id: 'operation-1',
          item_code: 'limited_profile_voucher',
          profile_id: 'preview-1',
          permission: 'advanced',
          starts_at: '2026-08-01T00:00:00.000Z',
          ends_at: '2026-08-19T16:00:00.000Z',
          auth: payload,
        }
      }
      if (path === '/api/user/inventory') {
        inventoryLoads += 1
        return inventoryLoads === 1 ? inventory : { ...inventory, stacks: [] }
      }
      throw new Error(`unexpected request: ${path}`)
    })

    const user = userEvent.setup()
    render(<InventorySection onPayload={onPayload} onViewProfiles={onViewProfiles} />)

    await user.click(await screen.findByRole('button', { name: /限时 CDK/ }))
    await user.click(screen.getByRole('button', { name: '使用道具' }))

    const notice = await screen.findByText(/「主账号」的高级版限时体验已生效/)
    expect(notice).toHaveTextContent('有效至 2026/08/20 00:00')
    expect(screen.queryByText('道具操作已完成。')).not.toBeInTheDocument()
    expect(onPayload).toHaveBeenCalledOnce()
    expect(onPayload).toHaveBeenCalledWith(payload)
    await waitFor(() => expect(inventoryLoads).toBe(2))

    await user.click(screen.getByRole('button', { name: '查看账号档案' }))
    expect(onViewProfiles).toHaveBeenCalledOnce()
  })

  it('creates a lifetime profile for JSON import without requiring Skland', async () => {
    const onPayload = vi.fn()
    const onLifetimeProfileCreated = vi.fn()
    const payload = { user: { id: 'user-1' }, profiles: [], active_profile: { id: 'lifetime-1' }, workspace: null }
    mocks.apiJson.mockImplementation(async (path: string, options?: { method?: string; json?: Record<string, unknown> }) => {
      if (path === '/api/user/onboarding-tasks') return { tasks: [] }
      if (path === '/api/user/inventory/lifetime-profile' && options?.method === 'POST') return payload
      if (path === '/api/user/inventory') return lifetimeInventory
      throw new Error(`unexpected request: ${path}`)
    })

    const user = userEvent.setup()
    render(<InventorySection onPayload={onPayload} onLifetimeProfileCreated={onLifetimeProfileCreated} />)

    await user.click(await screen.findByRole('button', { name: /终身版兑换 CDK/ }))
    expect(screen.getByRole('button', { name: '绑定森空岛并使用' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('档案名称（可选）'), 'JSON 终身档案')
    await user.type(screen.getByLabelText('备注（可选）'), '手动导入')
    await user.click(screen.getByRole('button', { name: '使用 JSON 创建档案' }))

    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledWith('/api/user/inventory/lifetime-profile', {
      method: 'POST',
      json: {
        idempotency_key: expect.any(String),
        display_name: 'JSON 终身档案',
        note: '手动导入',
      },
      fallbackMessage: '暂时无法使用终身版兑换 CDK 创建档案，请稍后重试。',
    }))
    expect(onPayload).toHaveBeenCalledWith(payload)
    expect(onLifetimeProfileCreated).toHaveBeenCalledOnce()
  })
})
