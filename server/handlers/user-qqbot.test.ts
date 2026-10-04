import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  requireUserSession: vi.fn(), getUserQqBotBinding: vi.fn(), createQqBotBindingCode: vi.fn(),
  setQqBotNotifications: vi.fn(), unbindQqBotAccount: vi.fn(),
}))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.requireUserSession }))
vi.mock('../storage/qqbot-store', async (original) => ({
  ...await original<typeof import('../storage/qqbot-store')>(),
  getUserQqBotBinding: mocks.getUserQqBotBinding, createQqBotBindingCode: mocks.createQqBotBindingCode,
  setQqBotNotifications: mocks.setQqBotNotifications, unbindQqBotAccount: mocks.unbindQqBotAccount,
}))
import handler from './user-qqbot'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('WEBSITE_QQBOT_TOKEN', 'test-private-qqbot-token-at-least-32-bytes')
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.getUserQqBotBinding.mockResolvedValue(null)
  mocks.setQqBotNotifications.mockResolvedValue({ notifications_enabled: false })
})
afterEach(() => vi.unstubAllEnvs())

describe('website QQ bot settings authorization', () => {
  it('requires a website session for all operations', async () => {
    mocks.requireUserSession.mockResolvedValue(null)
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) expect((await handler(request(method))).status).toBe(401)
    expect(mocks.createQqBotBindingCode).not.toHaveBeenCalled()
    expect(mocks.unbindQqBotAccount).not.toHaveBeenCalled()
  })

  it('uses only the session user and exposes no stored account or code hashes', async () => {
    mocks.getUserQqBotBinding.mockResolvedValue({ id: 'binding-1', user_id: 'private-user-id', qq_number: '123456789',
      notifications_enabled: true, created_at: '2026-10-04T08:00:00.000Z' })
    const response = await handler(request('GET'))
    expect(mocks.getUserQqBotBinding).toHaveBeenCalledWith('user-1')
    expect(await response.json()).toEqual({ available: true, binding: {
      binding_id: 'binding-1', qq_number: '123456789', notifications_enabled: true, bound_at: '2026-10-04T08:00:00.000Z',
    } })
  })

  it('permits disable and unbind after service credentials are removed, but prevents new bindings and opt-in', async () => {
    vi.stubEnv('WEBSITE_QQBOT_TOKEN', '')
    expect((await handler(request('POST'))).status).toBe(503)
    expect((await handler(request('PATCH', { notifications_enabled: true }))).status).toBe(503)
    expect((await handler(request('PATCH', { notifications_enabled: false }))).status).toBe(200)
    expect((await handler(request('DELETE'))).status).toBe(200)
    expect(mocks.setQqBotNotifications).toHaveBeenCalledWith('user-1', false)
    expect(mocks.unbindQqBotAccount).toHaveBeenCalledWith('user-1')
  })
})
function request(method: string, body?: unknown): Request {
  return new Request('https://example.test/api/user/qqbot', { method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
}
