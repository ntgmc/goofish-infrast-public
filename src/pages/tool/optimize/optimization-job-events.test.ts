import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withOptimizationSubmissionLock } from './optimization-job-events'

const values = new Map<string, string>()
const storage = {
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  removeItem: vi.fn((key: string) => { values.delete(key) }),
}
beforeEach(() => {
  values.clear()
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => { vi.unstubAllGlobals() })

const unavailable = () => { throw new DOMException('Storage disabled', 'SecurityError') }

describe('optimization submission storage fallback', () => {
  it.each(['getItem', 'setItem', 'removeItem'] as const)('preserves successful submission when %s throws', async (method) => {
    storage[method].mockImplementationOnce(unavailable)
    const operation = vi.fn(async () => 'accepted')
    expect(await withOptimizationSubmissionLock('profile-1', operation)).toBe('accepted')
    expect(operation).toHaveBeenCalledOnce()
  })

  it('propagates operation errors without retrying even when cleanup fails', async () => {
    storage.removeItem.mockImplementationOnce(unavailable)
    const operation = vi.fn(async () => { throw new Error('submission failed') })
    await expect(withOptimizationSubmissionLock('profile-1', operation)).rejects.toThrow('submission failed')
    expect(operation).toHaveBeenCalledOnce()
  })

  it('rejects another tab lease without executing the operation', async () => {
    values.set('maa:optimization-submit-lease:v1:profile-1', JSON.stringify({ owner: 'other-tab', expiresAt: Date.now() + 30_000 }))
    const operation = vi.fn(async () => 'accepted')
    await expect(withOptimizationSubmissionLock('profile-1', operation)).rejects.toMatchObject({ name: 'OptimizationSubmissionLockedError' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('releases its own lease after a successful submission', async () => {
    expect(await withOptimizationSubmissionLock('profile-1', async () => 'accepted')).toBe('accepted')
    expect(values.size).toBe(0)
  })
})
