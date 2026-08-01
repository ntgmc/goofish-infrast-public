import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ countReorderCheckQuota: vi.fn() }))

vi.mock('../../storage/reorder-quota-store', () => ({
  countReorderCheckQuota: mocks.countReorderCheckQuota,
}))

import { getReorderCheckQuota } from './entitlements'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reorder-check quota projection', () => {
  it('uses the entitlement ledger count as its only authority', async () => {
    mocks.countReorderCheckQuota.mockResolvedValue(2)

    await expect(getReorderCheckQuota('profile-1')).resolves.toMatchObject({
      limit: 2,
      used: 2,
      remaining: 0,
      timezone: 'Asia/Shanghai',
    })
    expect(mocks.countReorderCheckQuota).toHaveBeenCalledWith('profile-1', expect.stringMatching(/^\d{4}-\d{2}$/))
  })
})
