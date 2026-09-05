// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InventoryResponse } from '../../../lib/inventory-contracts'
import { useInventoryBalances } from './useInventoryBalances'
import { usePriorityCoupon } from './usePriorityCoupon'

const apiJson = vi.fn()

vi.mock('../../../lib/api-client', () => ({
  apiJson: (...args: unknown[]) => apiJson(...args),
}))

afterEach(() => {
  cleanup()
  apiJson.mockReset()
})

describe('inventory optimization hooks', () => {
  it('keeps inventory unresolved and exposes the first load failure', async () => {
    apiJson.mockRejectedValue(new Error('inventory unavailable'))

    const { result } = renderHook(() => useInventoryBalances('profile-1'))

    await waitFor(() => expect(result.current.error).toBe('inventory unavailable'))
    expect(result.current.loaded).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it('preserves the last successful inventory snapshot when refresh fails', async () => {
    apiJson.mockResolvedValueOnce(inventorySnapshot())
    const { result } = renderHook(() => useInventoryBalances('profile-1'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.balances.training_diagnosis_coupon).toBe(2)

    apiJson.mockRejectedValueOnce(new Error('refresh failed'))
    await act(async () => { await result.current.refresh() })

    expect(result.current.error).toBe('refresh failed')
    expect(result.current.loaded).toBe(true)
    expect(result.current.balances.training_diagnosis_coupon).toBe(2)
  })

  it('preserves the last priority balance while exposing refresh failure', async () => {
    apiJson.mockResolvedValueOnce({
      balances: [{ type: 'priority_compute_coupon', available: 1, permanent: 1, next_expiry_at: null }],
    })
    const { result } = renderHook(() => usePriorityCoupon('profile-1'))
    await waitFor(() => expect(result.current.balance?.available).toBe(1))
    act(() => result.current.setSelected(true))

    apiJson.mockRejectedValueOnce(new Error('coupon refresh failed'))
    await act(async () => { await result.current.refresh() })

    expect(result.current.error).toBe('coupon refresh failed')
    expect(result.current.balance?.available).toBe(1)
    expect(result.current.selected).toBe(false)
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
