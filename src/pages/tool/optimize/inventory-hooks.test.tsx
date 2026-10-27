// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '../../../test/query-render'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InventoryResponse } from '../../../lib/inventory-contracts'
import { useInventoryBalances } from './useInventoryBalances'
import { markInventoryStale } from '../../../lib/inventory-refresh'

const apiJson = vi.fn()

vi.mock('../../../lib/api-client', () => ({
  apiJson: (...args: unknown[]) => apiJson(...args),
}))

afterEach(() => {
  cleanup()
  apiJson.mockReset()
})

describe('inventory optimization hooks', () => {
  it('refreshes stale inventory and preserves invalidations received while loading', async () => {
    let complete!: (inventory: InventoryResponse) => void
    apiJson.mockResolvedValueOnce(inventorySnapshot())
      .mockImplementationOnce(() => new Promise<InventoryResponse>((resolve) => { complete = resolve }))
      .mockResolvedValueOnce({ ...inventorySnapshot(), stacks: [] })
    const { result } = renderHook(() => useInventoryBalances('user', 'profile-1'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => markInventoryStale())
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(2))
    act(() => markInventoryStale())
    expect(apiJson).toHaveBeenCalledTimes(2)
    await act(async () => complete(inventorySnapshot()))
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(result.current.balances).toEqual({}))
  })

  it('invalidates another profile cache when a shared inventory balance changes', async () => {
    apiJson.mockResolvedValue(inventorySnapshot())
    const { result, rerender } = renderHook(({ profileId }) => useInventoryBalances('user', profileId), {
      initialProps: { profileId: 'profile-1' },
    })
    await waitFor(() => expect(result.current.balances.training_diagnosis_coupon).toBe(2))
    rerender({ profileId: 'profile-2' })
    await waitFor(() => expect(result.current.balances.training_diagnosis_coupon).toBe(2))
    expect(apiJson).toHaveBeenCalledTimes(2)
    apiJson.mockResolvedValue({ ...inventorySnapshot(), stacks: [] })
    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.balances).toEqual({}))
    rerender({ profileId: 'profile-1' })
    await waitFor(() => expect(result.current.balances).toEqual({}))
    expect(apiJson).toHaveBeenCalledTimes(4)
  })

  it('keeps inventory unresolved and exposes the first load failure', async () => {
    apiJson.mockRejectedValue(new Error('inventory unavailable'))

    const { result } = renderHook(() => useInventoryBalances('user', 'profile-1'))

    await waitFor(() => expect(result.current.error).toBe('inventory unavailable'))
    expect(result.current.loaded).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it('preserves the last successful inventory snapshot when refresh fails', async () => {
    apiJson.mockResolvedValueOnce(inventorySnapshot())
    const { result } = renderHook(() => useInventoryBalances('user', 'profile-1'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.balances.training_diagnosis_coupon).toBe(2)

    apiJson.mockRejectedValueOnce(new Error('refresh failed'))
    await act(async () => { await result.current.refresh() })

    await waitFor(() => expect(result.current.error).toBe('refresh failed'))
    expect(result.current.loaded).toBe(true)
    expect(result.current.balances.training_diagnosis_coupon).toBe(2)
  })

  it('shares priority coupon data between consumers and keeps its last snapshot on refresh failure', async () => {
    const inventory = inventorySnapshot()
    const stack = { ...inventory.stacks[0], item: { ...inventory.stacks[0].item, code: 'priority_compute_coupon' } }
    apiJson.mockResolvedValueOnce({ ...inventory, stacks: [
      { ...stack, quantity: 2, permanent: 1, next_expiry_at: '2026-11-01T00:00:00Z' },
      { ...stack, stack_id: 'another-priority-stack', quantity: 3, permanent: 0, next_expiry_at: '2026-10-30T00:00:00Z' },
    ] })
    const { result } = renderHook(() => ({
      first: useInventoryBalances('user', 'profile-1'), second: useInventoryBalances('user', 'profile-1'),
    }))
    await waitFor(() => expect(result.current.first.priorityCouponBalance).toEqual({
      type: 'priority_compute_coupon', available: 5, permanent: 1, next_expiry_at: '2026-10-30T00:00:00Z',
    }))
    expect(result.current.second.priorityCouponBalance).toEqual(result.current.first.priorityCouponBalance)
    expect(apiJson).toHaveBeenCalledTimes(1)
    expect(apiJson).toHaveBeenCalledWith('/api/user/inventory', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    apiJson.mockRejectedValueOnce(new Error('coupon refresh failed'))
    await act(async () => { await result.current.first.refresh() })
    await waitFor(() => expect(result.current.first.error).toBe('coupon refresh failed'))
    expect(result.current.first.priorityCouponBalance?.available).toBe(5)
    expect(result.current.second.error).toBe('coupon refresh failed')
  })
})

function inventorySnapshot(): InventoryResponse {
  return {
    stacks: [{
      stack_id: 'training_diagnosis_coupon',
      item: {
        code: 'training_diagnosis_coupon',
        kind: 'consumable',
        effect_code: 'training_diagnosis',
        name: '练度诊断券',
        description: '测试',
        icon_key: 'training_diagnosis_coupon',
        system_owned: true,
        issuance_enabled: true,
        created_at: null,
        updated_at: null,
      },
      gift_pack_version_id: null,
      quantity: 2,
      permanent: 2,
      next_expiry_at: null,
      expiry_buckets: [{ quantity: 2, expires_at: null }],
      actions: ['context_only'],
    }],
    capacities: [],
    recent_events: [],
  }
}
