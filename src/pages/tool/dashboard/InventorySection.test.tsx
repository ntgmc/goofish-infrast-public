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
})
