import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  getBrevoOfficialQuotaSnapshot: vi.fn(),
  recordBrevoOfficialQuotaSyncFailure: vi.fn(),
  reserveBrevoEmail: vi.fn(),
  saveBrevoOfficialQuotaSnapshot: vi.fn(),
}))

vi.mock('./storage/brevo-email-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('./storage/brevo-email-store')>(),
  ...store,
}))

vi.mock('./storage/registration-settings-store', () => ({
  getRegistrationSettings: vi.fn().mockResolvedValue({
    admin_invite_email_reserve: 20,
    password_reset_email_reserve: 10,
  }),
}))

import {
  parseBrevoAccountRemainingCredits,
  refreshBrevoOfficialQuotaIfStale,
  reserveBrevoEmailWithOfficialQuota,
} from './brevo-quota'

const now = new Date('2026-07-21T12:00:00.000Z')
const snapshot = {
  quotaDate: '2026-07-21',
  reportedRemainingCount: 250,
  reportedUsedCount: 50,
  localUsedAtSync: 10,
  externalUsedOffset: 40,
  syncStatus: 'success' as const,
  lastAttemptAt: now.toISOString(),
  syncedAt: now.toISOString(),
}

describe('Brevo official quota synchronization', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key'
    store.getBrevoOfficialQuotaSnapshot.mockResolvedValue(null)
    store.saveBrevoOfficialQuotaSnapshot.mockResolvedValue(snapshot)
    store.reserveBrevoEmail.mockResolvedValue({ id: 'reservation', quotaDate: '2026-07-21', purpose: 'email_verification' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      plan: [
        { type: 'sms', creditsType: 'sendLimit', credits: 15 },
        { type: 'free', creditsType: 'sendLimit', credits: 250 },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.BREVO_API_KEY
  })

  it('selects the free email send-limit plan and clamps credits to the local limit', () => {
    expect(parseBrevoAccountRemainingCredits({
      plan: [
        { type: 'sms', creditsType: 'sendLimit', credits: 12 },
        { type: 'free', creditsType: 'sendLimit', credits: '245' },
      ],
    })).toBe(245)
    expect(parseBrevoAccountRemainingCredits({
      plan: [{ type: 'free', creditsType: 'sendLimit', credits: 500 }],
    })).toBe(300)
    expect(() => parseBrevoAccountRemainingCredits({ plan: [] })).toThrow(/plan was not found/)
  })

  it('fetches account credits and persists the official snapshot', async () => {
    expect(await refreshBrevoOfficialQuotaIfStale(now, true)).toEqual(snapshot)
    expect(fetch).toHaveBeenCalledWith('https://api.brevo.com/v3/account', expect.objectContaining({
      method: 'GET',
      headers: { 'api-key': 'test-key' },
    }))
    expect(store.saveBrevoOfficialQuotaSnapshot).toHaveBeenCalledWith(250, now)
    expect(store.recordBrevoOfficialQuotaSyncFailure).not.toHaveBeenCalled()
  })

  it('reuses a fresh snapshot before reserving locally', async () => {
    store.getBrevoOfficialQuotaSnapshot.mockResolvedValue(snapshot)
    await reserveBrevoEmailWithOfficialQuota('email_verification', new Date(now.getTime() + 30_000))
    expect(fetch).not.toHaveBeenCalled()
    expect(store.reserveBrevoEmail).toHaveBeenCalledWith(
      'email_verification',
      new Date(now.getTime() + 30_000),
      { adminInviteReserve: 20, passwordResetReserve: 10 },
    )
  })

  it('records sync failure and falls back to the previous snapshot', async () => {
    const stale = { ...snapshot, syncStatus: 'error' as const }
    store.getBrevoOfficialQuotaSnapshot.mockResolvedValue(stale)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await refreshBrevoOfficialQuotaIfStale(now, true)).toEqual(stale)
    expect(store.recordBrevoOfficialQuotaSyncFailure).toHaveBeenCalledWith(now)
    expect(store.saveBrevoOfficialQuotaSnapshot).not.toHaveBeenCalled()

    vi.mocked(fetch).mockClear()
    await refreshBrevoOfficialQuotaIfStale(new Date(now.getTime() + 30_000))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not share an in-flight refresh across the UTC day boundary', async () => {
    await Promise.all([
      refreshBrevoOfficialQuotaIfStale(new Date('2026-07-21T23:59:59.000Z'), true),
      refreshBrevoOfficialQuotaIfStale(new Date('2026-07-22T00:00:00.000Z'), true),
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
