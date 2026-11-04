import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getQqBotAccount: vi.fn(), deliverQqBotReward: vi.fn(), listQqBotRewardItems: vi.fn(),
  reservePersistentRateLimit: vi.fn(), requireSiteFeatures: vi.fn(),
}))
vi.mock('../storage/qqbot-store', async (original) => ({
  ...await original<typeof import('../storage/qqbot-store')>(), getQqBotAccount: mocks.getQqBotAccount,
}))
vi.mock('../storage/qqbot-reward-store', () => ({ deliverQqBotReward: mocks.deliverQqBotReward, listQqBotRewardItems: mocks.listQqBotRewardItems }))
vi.mock('../security/persistent-rate-limit', () => ({ reservePersistentRateLimit: mocks.reservePersistentRateLimit }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: mocks.requireSiteFeatures }))
import handler from './qqbot-rewards'
import { QqBotError } from '../storage/qqbot-store'
import { InventoryError } from '../storage/inventory-store'

const token = 'test-private-qqbot-token-at-least-32-bytes'
const body = { delivery_id: 'grant:123456:award-1', qq_number: '123456789', group_id: '123456', actor_qq: '987654321',
  item_code: 'maa_export_coupon', quantity: 2, validity_days: 30, gift_pack_version_id: null, reason: '群奖励' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('WEBSITE_QQBOT_TOKEN', token)
  vi.stubEnv('WEBSITE_EVENTS_TOKEN', 'test-public-feed-token-at-least-32-bytes')
  vi.stubEnv('WEBSITE_RELEASE_CONFIRMATION_TOKEN', 'test-release-token-at-least-32-bytes')
  mocks.reservePersistentRateLimit.mockResolvedValue({ allowed: true, attempt: { retain: vi.fn() } })
  mocks.requireSiteFeatures.mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

function request(path: string, value?: unknown, credential = token): Request {
  return new Request(`https://example.test/api/integrations/qqbot/${path}`, {
    method: value ? 'POST' : 'GET', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    ...(value ? { body: JSON.stringify(value) } : {}),
  })
}

describe('QQ bot rewards integration boundary', () => {
  it('requires the private integration token before touching any state', async () => {
    for (const credential of ['wrong', process.env.WEBSITE_EVENTS_TOKEN!, process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN!]) {
      expect((await handler(request('rewards', body, credential))).status).toBeGreaterThanOrEqual(401)
    }
    expect(mocks.deliverQqBotReward).not.toHaveBeenCalled()
    expect(mocks.reservePersistentRateLimit).not.toHaveBeenCalled()
  })

  it('returns only the website account ID, with no email, profile or credentials', async () => {
    mocks.getQqBotAccount.mockResolvedValue({ binding: { id: 'binding' }, user: { id: 'user-id', email: 'secret@example.test', password_hash: 'secret' } })
    const response = await handler(request('member-account?qq_number=123456789'))
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ schema_version: 1, user_id: 'user-id' })
    expect(mocks.requireSiteFeatures).not.toHaveBeenCalled()
    expect((await handler(request('member-account?qq_number=email@example.test'))).status).toBe(400)
  })

  it('rejects unsafe quantities, expirations, missing IDs and caller-selected user IDs', async () => {
    for (const changes of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: 10001 }, { validity_days: -1 },
      { validity_days: 3651 }, { delivery_id: '' }, { qq_number: '1234' }, { actor_qq: 'x' }, { user_id: 'another-user' }]) {
      expect((await handler(request('rewards', { ...body, ...changes }))).status).toBe(400)
    }
    expect(mocks.deliverQqBotReward).not.toHaveBeenCalled()
  })

  it('passes the immutable reward snapshot and propagates idempotency and inventory errors', async () => {
    mocks.deliverQqBotReward.mockResolvedValue({ schema_version: 1, delivery_id: body.delivery_id, user_id: 'user', grant_id: 'grant' })
    expect((await handler(request('rewards', body))).status).toBe(201)
    expect(mocks.deliverQqBotReward).toHaveBeenCalledWith(body)
    mocks.deliverQqBotReward.mockRejectedValue(new QqBotError('idempotency_conflict', 'conflict', 409))
    expect(await (await handler(request('rewards', body))).json()).toMatchObject({ code: 'idempotency_conflict' })
    mocks.deliverQqBotReward.mockRejectedValue(new InventoryError('item_issuance_disabled', 'disabled', 409))
    expect((await handler(request('rewards', body))).status).toBe(409)
  })

  it('shares the account request quota and respects inventory availability', async () => {
    mocks.requireSiteFeatures.mockResolvedValue(Response.json({ code: 'feature_disabled' }, { status: 503 }))
    expect((await handler(request('rewards', body))).status).toBe(503)
    expect(mocks.deliverQqBotReward).not.toHaveBeenCalled()
    mocks.reservePersistentRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 })
    const response = await handler(request('reward-items'))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(mocks.listQqBotRewardItems).not.toHaveBeenCalled()
  })
})
