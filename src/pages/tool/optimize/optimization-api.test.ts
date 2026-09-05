// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiJson } from '../../../lib/api-client'
import { getOrCreateExportIdempotencyKey, requestMaaExport } from './optimization-api'

vi.mock('../../../lib/api-client', () => ({ apiJson: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(apiJson).mockReset()
})

describe('requestMaaExport', () => {
  it('submits explicit coupon confirmation with a caller-owned key and revokes the URL later', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:test-export')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.mocked(apiJson).mockResolvedValueOnce({
      result: { title: '导出结果' },
      result_id: 'result-1',
      filename: 'schedule.json',
      consumed_coupon: true,
      operation_id: 'operation-1',
    })

    const response = await requestMaaExport('profile-1', 'result-1', {
      idempotencyKey: 'stable-export-key',
      useCoupon: true,
    })

    expect(apiJson).toHaveBeenCalledWith('/api/user/maa-export', expect.objectContaining({
      method: 'POST',
      json: {
        profile_id: 'profile-1',
        result_id: 'result-1',
        idempotency_key: 'stable-export-key',
        use_coupon: true,
      },
    }))
    expect(response).toMatchObject({ consumed_coupon: true, operation_id: 'operation-1' })
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download="schedule.json"]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    await vi.runOnlyPendingTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-export')
  })
})

describe('getOrCreateExportIdempotencyKey', () => {
  it('reuses a pending key after an unknown result and rotates only after success clears it', () => {
    const pending = new Map<string, string>()
    const create = vi.fn()
      .mockReturnValueOnce('export-key-1')
      .mockReturnValueOnce('export-key-2')

    expect(getOrCreateExportIdempotencyKey(pending, 'maa:profile-1:result-1', create)).toBe('export-key-1')
    expect(getOrCreateExportIdempotencyKey(pending, 'maa:profile-1:result-1', create)).toBe('export-key-1')
    expect(create).toHaveBeenCalledOnce()

    pending.delete('maa:profile-1:result-1')
    expect(getOrCreateExportIdempotencyKey(pending, 'maa:profile-1:result-1', create)).toBe('export-key-2')
  })
})
