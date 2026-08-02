import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insertBehaviorRiskEvent: vi.fn(),
  insertBehaviorRiskEventInTransaction: vi.fn(),
  getTrackedGenerationEvent: vi.fn(),
  recordBehaviorRiskCollectionStatus: vi.fn(),
  runBehaviorRiskEvaluation: vi.fn(),
}))

vi.mock('../storage/postgres', () => ({ hasDatabaseUrl: () => true }))
vi.mock('../storage/behavior-risk-store', () => ({
  getTrackedGenerationEvent: mocks.getTrackedGenerationEvent,
  insertBehaviorRiskEvent: mocks.insertBehaviorRiskEvent,
  insertBehaviorRiskEventInTransaction: mocks.insertBehaviorRiskEventInTransaction,
  recordBehaviorRiskCollectionStatus: mocks.recordBehaviorRiskCollectionStatus,
  runBehaviorRiskEvaluation: mocks.runBehaviorRiskEvaluation,
}))

import { ensureBehaviorRiskDeviceCookie, recordRequestBehaviorEvent } from './service'

const originalEnvironment = { ...process.env }

beforeEach(() => {
  mocks.insertBehaviorRiskEvent.mockReset().mockResolvedValue(true)
  mocks.recordBehaviorRiskCollectionStatus.mockReset().mockResolvedValue(undefined)
  process.env.NODE_ENV = 'test'
  process.env.BEHAVIOR_RISK_HMAC_SECRET = 'a'.repeat(64)
  process.env.BEHAVIOR_RISK_HMAC_KEY_VERSION = 'v1'
  delete process.env.BEHAVIOR_RISK_HMAC_PREVIOUS_SECRET
  delete process.env.BEHAVIOR_RISK_HMAC_PREVIOUS_KEY_VERSION
})

afterEach(() => {
  process.env = { ...originalEnvironment }
})

describe('behavior risk device identity and key rotation', () => {
  it('ignores a client-controlled browser header when no signed cookie is present', async () => {
    await recordRequestBehaviorEvent({
      req: new Request('https://example.test/api/user/behavior-risk/engagement', {
        headers: { 'X-Maa-Behavior-Instance': 'attacker-controlled-shared-id' },
      }),
      eventType: 'page_view',
      userId: 'user-1',
    })

    expect(mocks.insertBehaviorRiskEvent).toHaveBeenCalledWith(expect.objectContaining({
      browserHmac: null,
      keyVersion: 'v1',
    }))
  })

  it('reuses a valid HttpOnly device cookie and replaces a tampered cookie', () => {
    const now = new Date()
    const issued = ensureBehaviorRiskDeviceCookie(new Request('https://example.test/'), now)
    expect(issued).toContain('HttpOnly')
    expect(issued).toContain('SameSite=Strict')
    const cookie = cookiePair(issued!)

    expect(ensureBehaviorRiskDeviceCookie(new Request('https://example.test/', { headers: { cookie } }), now)).toBeNull()
    const tampered = `${cookie.slice(0, -1)}x`
    expect(ensureBehaviorRiskDeviceCookie(new Request('https://example.test/', { headers: { cookie: tampered } }), now))
      .toContain('maa_behavior_device=')
  })

  it('accepts the previous signed cookie while dual-writing current and previous HMAC aliases', async () => {
    const now = new Date()
    const oldCookie = cookiePair(ensureBehaviorRiskDeviceCookie(new Request('https://example.test/'), now)!)

    process.env.BEHAVIOR_RISK_HMAC_SECRET = 'b'.repeat(64)
    process.env.BEHAVIOR_RISK_HMAC_KEY_VERSION = 'v2'
    process.env.BEHAVIOR_RISK_HMAC_PREVIOUS_SECRET = 'a'.repeat(64)
    process.env.BEHAVIOR_RISK_HMAC_PREVIOUS_KEY_VERSION = 'v1'

    const req = new Request('https://example.test/api/user/behavior-risk/engagement', {
      headers: { cookie: oldCookie, 'user-agent': 'risk-test-agent' },
    })
    expect(ensureBehaviorRiskDeviceCookie(req, now)).toContain('.v2.')

    await recordRequestBehaviorEvent({ req, eventType: 'page_view', userId: 'user-1' })
    const event = mocks.insertBehaviorRiskEvent.mock.calls[0]?.[0]
    expect(event).toMatchObject({ keyVersion: 'v2' })
    expect(event.browserHmac).toMatch(/^[a-f0-9]{64}$/)
    expect(event.signalAliases.browser).toHaveLength(2)
    expect(new Set(event.signalAliases.browser).size).toBe(2)
  })
})

function cookiePair(setCookie: string): string {
  return setCookie.split(';', 1)[0]!
}
