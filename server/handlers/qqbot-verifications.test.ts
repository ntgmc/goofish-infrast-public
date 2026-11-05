import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), token: vi.fn(), rate: vi.fn(), gate: vi.fn(), act: vi.fn(), get: vi.fn(), list: vi.fn(), checks: vi.fn(), proof: vi.fn() }))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.session }))
vi.mock('../security/website-integration-auth', async (importOriginal) => ({ ...await importOriginal<typeof import('../security/website-integration-auth')>(), authenticateWebsiteIntegrationRequest: mocks.token }))
vi.mock('../security/persistent-rate-limit', () => ({ reservePersistentRateLimit: mocks.rate }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: mocks.gate }))
vi.mock('../storage/qqbot-verification-store', () => ({ actOnQqBotVerification: mocks.act, getUserQqBotVerification: mocks.get, listUserQqBotActivities: mocks.list, listQqBotMembershipChecks: mocks.checks, recordQqBotVerification: mocks.proof }))
import handler from './qqbot-verifications'
const id = '00000000-0000-4000-8000-000000000001'
function request(path = '/api/user/qqbot/verification', body?: unknown) {
  return new Request(`https://example.test${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('WEBSITE_QQBOT_TOKEN', 'private-qqbot-token-longer-than-thirty-two-bytes')
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.token.mockReturnValue({ ok: true })
  mocks.rate.mockResolvedValue({ allowed: true, attempt: { retain: vi.fn() } })
  mocks.gate.mockResolvedValue(null)
  mocks.get.mockResolvedValue(null)
  mocks.act.mockResolvedValue({ verification: { id, status: 'pending' } })
  mocks.list.mockResolvedValue([])
  mocks.checks.mockResolvedValue([])
  mocks.proof.mockResolvedValue({ status: 'verified' })
})
describe('QQ website verification boundaries', () => {
  it('requires a website session and takes the account from the session', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await handler(request())).status).toBe(401)
    expect(mocks.get).not.toHaveBeenCalled()
    const body = { action: 'start', qq_number: '123456789', group_id: '2101', campaign_id: 'welcome' }
    expect((await handler(request(undefined, body))).status).toBe(200)
    expect(mocks.act).toHaveBeenCalledWith('owner', body)
    expect((await handler(request(undefined, { ...body, user_id: 'victim' }))).status).toBe(400)
    expect((await handler(request(undefined, { ...body, qq_number: 'qq123' }))).status).toBe(400)
  })
  it('only accepts private bot authentication for proof and pending checks', async () => {
    mocks.token.mockReturnValueOnce({ ok: false, response: new Response(null, { status: 401 }) })
    expect((await handler(request('/api/integrations/qqbot/verifications'))).status).toBe(401)
    expect(mocks.checks).not.toHaveBeenCalled()
    const body = { action: 'message', code: 'A1B2C3-D4E5F6', qq_number: '123456789', group_id: '2101', joined_at: 1 }
    const response = await handler(request('/api/integrations/qqbot/verifications', body))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.proof).toHaveBeenCalledWith(body)
    expect(mocks.session).not.toHaveBeenCalled()
    expect((await handler(request('/api/integrations/qqbot/verifications', { ...body, member: true }))).status).toBe(400)
  })
  it('honors the inventory gate for creation, claiming and confirmation saved on the server', async () => {
    mocks.gate.mockResolvedValue(new Response(null, { status: 503 }))
    expect((await handler(request(undefined, { action: 'claim', group_id: '2101', campaign_id: 'welcome' }))).status).toBe(503)
    mocks.get.mockResolvedValue({ id, campaign_id: 'welcome' })
    expect((await handler(request(undefined, { action: 'confirm', verification_id: id }))).status).toBe(503)
    expect(mocks.get).toHaveBeenCalledWith('owner', id)
    expect(mocks.act).not.toHaveBeenCalled()
  })
  it('limits writes without exposing another user verification and rejects invalid activity filters', async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 23 })
    const response = await handler(request(undefined, { action: 'confirm', verification_id: id }))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('23')
    expect(mocks.act).not.toHaveBeenCalled()
    expect((await handler(request('/api/user/qqbot/activities?group_id=wrong'))).status).toBe(400)
    expect((await handler(request())).status).toBe(200)
    expect(mocks.get).toHaveBeenCalledWith('owner')
  })
})
