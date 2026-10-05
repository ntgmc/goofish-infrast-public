import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getQqBotAccount: vi.fn(), bindQqBotAccount: vi.fn(), listQqBotScheduleNotifications: vi.fn(),
  acknowledgeQqBotNotification: vi.fn(), setQqBotNotifications: vi.fn(), unbindQqBotAccount: vi.fn(),
  handleUserResultsRequest: vi.fn(), listProfilesForUser: vi.fn(), reservePersistentRateLimit: vi.fn(), requireSiteFeatures: vi.fn(),
}))
vi.mock('../storage/qqbot-store', async (original) => ({
  ...await original<typeof import('../storage/qqbot-store')>(),
  ...Object.fromEntries(Object.entries(mocks).filter(([key]) => !['handleUserResultsRequest', 'listProfilesForUser', 'reservePersistentRateLimit', 'requireSiteFeatures'].includes(key))),
}))
vi.mock('./user-results', () => ({ handleUserResultsRequest: mocks.handleUserResultsRequest }))
vi.mock('../storage/user-store', () => ({ listProfilesForUser: mocks.listProfilesForUser }))
vi.mock('../security/persistent-rate-limit', () => ({ reservePersistentRateLimit: mocks.reservePersistentRateLimit }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: mocks.requireSiteFeatures }))
import handler from './qqbot-account'

const token = 'test-private-qqbot-token-at-least-32-bytes'
const binding = { id: 'binding-1', user_id: 'user-1', qq_number: '123456789', notifications_enabled: true }
const user = { id: 'user-1', status: 'active' }
const exportBody = {
  qq_number: binding.qq_number, binding_id: binding.id, profile_id: 'profile-1',
  result_id: 'result-1', idempotency_key: 'export-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('WEBSITE_QQBOT_TOKEN', token)
  vi.stubEnv('WEBSITE_EVENTS_TOKEN', 'test-public-feed-token-at-least-32-bytes')
  vi.stubEnv('WEBSITE_RELEASE_CONFIRMATION_TOKEN', 'test-release-token-at-least-32-bytes')
  mocks.reservePersistentRateLimit.mockResolvedValue({ allowed: true, attempt: { retain: vi.fn() } })
  mocks.getQqBotAccount.mockResolvedValue({ binding, user })
  mocks.requireSiteFeatures.mockResolvedValue(null)
  mocks.handleUserResultsRequest.mockImplementation(async (_req, authenticate) => {
    expect(await authenticate()).toEqual({ user, tokenHash: null })
    return Response.json({ result: {}, filename: 'maa_schedule_result-1.json' })
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('QQ bot private account boundary', () => {
  it('rejects unauthenticated callers and tokens from public feed or release domains', async () => {
    for (const [presented, status] of [['wrong', 401], [process.env.WEBSITE_EVENTS_TOKEN, 403], [process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN, 403]] as const) {
      expect((await handler(request('account', undefined, presented))).status).toBe(status)
    }
    expect(mocks.getQqBotAccount).not.toHaveBeenCalled()
    expect(mocks.reservePersistentRateLimit).not.toHaveBeenCalled()
  })

  it('does not expose website account identifiers or credential records in the bot account response', async () => {
    mocks.listProfilesForUser.mockResolvedValue([
      { id: 'profile-1', display_name: '主号', status: 'active', skland_binding: { encrypted_cred: 'private' } },
      { id: 'profile-2', archived_at: '2026-10-01' }, { id: 'profile-3', kind: 'depot_value' },
    ])
    const response = await handler(request(`account?qq_number=${binding.qq_number}`))
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ schema_version: 1, binding_id: binding.id, notifications_enabled: true,
      profiles: [{ id: 'profile-1', display_name: '主号', status: 'active' }] })
  })

  it('uses the bound account and shared result authorization for manual coupon exports', async () => {
    const response = await handler(request('maa-export', { ...exportBody, use_coupon: true }))
    expect(response.status).toBe(200)
    const forwarded = mocks.handleUserResultsRequest.mock.calls[0][0] as Request
    expect(new URL(forwarded.url).pathname).toBe('/api/user/maa-export')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    expect(forwarded.headers.has('Idempotency-Key')).toBe(false)
    expect(await forwarded.json()).toEqual({ profile_id: 'profile-1', result_id: 'result-1',
      idempotency_key: 'qqbot:binding-1:export-1', use_coupon: true })
  })

  it('forwards automatic exports without authorizing coupon consumption', async () => {
    await handler(request('maa-export', { ...exportBody, automatic: true }))
    expect(await (mocks.handleUserResultsRequest.mock.calls[0][0] as Request).json()).not.toHaveProperty('use_coupon')
    expect((await handler(request('maa-export', { ...exportBody, automatic: true, use_coupon: true }))).status).toBe(400)
    expect(mocks.handleUserResultsRequest).toHaveBeenCalledOnce()
  })

  it('rejects stale bindings and automatic exports after notifications are disabled', async () => {
    expect((await handler(request('maa-export', { ...exportBody, binding_id: 'previous-binding' }))).status).toBe(409)
    mocks.getQqBotAccount.mockResolvedValue({ user, binding: { ...binding, notifications_enabled: false } })
    expect((await handler(request('maa-export', { ...exportBody, automatic: true }))).status).toBe(403)
    expect(mocks.handleUserResultsRequest).not.toHaveBeenCalled()
  })

  it('preserves permission errors from shared export logic and respects service switches', async () => {
    mocks.handleUserResultsRequest.mockResolvedValue(Response.json({ code: 'maa_export_coupon_required' }, { status: 403 }))
    expect((await handler(request('maa-export', exportBody))).status).toBe(403)
    mocks.requireSiteFeatures.mockResolvedValue(Response.json({ code: 'feature_disabled' }, { status: 503 }))
    expect((await handler(request('maa-export', exportBody))).status).toBe(503)
    expect(mocks.handleUserResultsRequest).toHaveBeenCalledOnce()
    expect(mocks.requireSiteFeatures).toHaveBeenLastCalledWith(['profiles', 'inventory', 'maa_export'])
  })

  it('requires valid paging and propagates persistent rate limits', async () => {
    expect((await handler(request('notifications?limit=101'))).status).toBe(400)
    mocks.reservePersistentRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 })
    const response = await handler(request('notifications'))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(mocks.listQqBotScheduleNotifications).not.toHaveBeenCalled()
  })
})

function request(path: string, body?: unknown, presented: string | undefined = token): Request {
  return new Request(`https://example.test/api/integrations/qqbot/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${presented}`, 'Content-Type': 'application/json', Cookie: 'ignored-session',
      ...(body ? { 'Idempotency-Key': exportBody.idempotency_key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
