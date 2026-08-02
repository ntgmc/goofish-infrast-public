import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  countReorderCheckQuota: vi.fn(),
  countReorderCheckQuotas: vi.fn(),
  countSuccessfulUsageEventsForProfileInRange: vi.fn(),
  hasDatabaseUrl: vi.fn(),
}))

vi.mock('../../storage/reorder-quota-store', () => ({
  countReorderCheckQuota: mocks.countReorderCheckQuota,
  countReorderCheckQuotas: mocks.countReorderCheckQuotas,
}))

vi.mock('../../storage/postgres', () => ({
  hasDatabaseUrl: mocks.hasDatabaseUrl,
}))

vi.mock('../../handlers/usage-stats', () => ({
  countSuccessfulUsageEventsForProfileInRange: mocks.countSuccessfulUsageEventsForProfileInRange,
  recordUsageEvent: vi.fn(),
}))

import { getReorderCheckQuota, getReorderCheckQuotas } from './entitlements'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasDatabaseUrl.mockReturnValue(true)
})

describe('reorder-check quota projection', () => {
  it('uses the entitlement ledger as the authority when PostgreSQL is configured', async () => {
    mocks.countReorderCheckQuota.mockResolvedValue(2)

    await expect(getReorderCheckQuota('profile-1')).resolves.toMatchObject({
      limit: 2,
      used: 2,
      remaining: 0,
      timezone: 'Asia/Shanghai',
    })
    expect(mocks.countReorderCheckQuota).toHaveBeenCalledWith('profile-1', expect.stringMatching(/^\d{4}-\d{2}$/))
    expect(mocks.countSuccessfulUsageEventsForProfileInRange).not.toHaveBeenCalled()
  })

  it('uses successful usage events in the database-free runtime', async () => {
    mocks.hasDatabaseUrl.mockReturnValue(false)
    mocks.countSuccessfulUsageEventsForProfileInRange.mockResolvedValue(1)

    await expect(getReorderCheckQuota('profile-1')).resolves.toMatchObject({
      limit: 2,
      used: 1,
      remaining: 1,
      timezone: 'Asia/Shanghai',
    })
    expect(mocks.countSuccessfulUsageEventsForProfileInRange).toHaveBeenCalledWith(
      'reorder_check',
      'profile-1',
      expect.any(String),
      expect.any(String),
    )
    expect(mocks.countReorderCheckQuota).not.toHaveBeenCalled()
  })

  it('loads all PostgreSQL profile quotas with one aggregate query', async () => {
    mocks.countReorderCheckQuotas.mockResolvedValue(new Map([['profile-1', 1]]))

    const quotas = await getReorderCheckQuotas(['profile-1', 'profile-2', 'profile-1'])

    expect(mocks.countReorderCheckQuotas).toHaveBeenCalledOnce()
    expect(mocks.countReorderCheckQuotas).toHaveBeenCalledWith(
      ['profile-1', 'profile-2'],
      expect.stringMatching(/^\d{4}-\d{2}$/),
    )
    expect(quotas.get('profile-1')).toMatchObject({ used: 1, remaining: 1 })
    expect(quotas.get('profile-2')).toMatchObject({ used: 0, remaining: 2 })
  })
})
