// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InventoryResponse, ItemUseRequest } from '../../../lib/inventory-contracts'
import InventorySection from './InventorySection'

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }))

vi.mock('../../../lib/api-client', () => ({
  apiJson: mocks.apiJson,
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}))

vi.mock('../../../components/SklandBindingDialog', () => ({ default: () => null }))

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
  reorder_quotas: [],
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

afterEach(() => {
  cleanup()
  mocks.apiJson.mockReset()
})

describe('InventorySection idempotent item use', () => {
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
      fallbackMessage: '使用终身版兑换 CDK 创建档案失败。',
    }))
    expect(onPayload).toHaveBeenCalledWith(payload)
    expect(onLifetimeProfileCreated).toHaveBeenCalledOnce()
  })
})
