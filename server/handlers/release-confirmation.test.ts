import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createWebsiteNotificationEvent: vi.fn(),
  getValidatedJson: vi.fn(),
}))

vi.mock('../../src/lib/build-meta', () => ({
  APP_BUILD_META: { frontend_version: '2.1.0', backend_version: '2.1.0' },
}))
vi.mock('../../src/lib/changelog', () => ({
  CHANGELOG_RELEASES: [{
    id: 'release-2.1.0',
    version: '2.1.0',
    displayVersion: '2.1.0 正式版',
    releasedAt: '2026-08-04T08:00:00.000Z',
    kind: 'release',
    sections: [{ id: 'feature', kind: 'feature', items: ['新增批量操作', '修复登录异常'] }],
  }],
}))
vi.mock('../security/request-policy', () => ({ requestSchemas: { releaseConfirmation: {} } }))
vi.mock('../security/request-validation', () => ({ getValidatedJson: mocks.getValidatedJson }))
vi.mock('../storage/website-notification-event-store', () => ({
  WebsiteNotificationEventConflictError: class WebsiteNotificationEventConflictError extends Error {},
  createWebsiteNotificationEvent: mocks.createWebsiteNotificationEvent,
}))

import handler from './release-confirmation'

const token = 'release-confirmation-token-at-least-32-bytes'
const originalToken = process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN
const originalPublicAppUrl = process.env.PUBLIC_APP_URL

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN = token
  process.env.PUBLIC_APP_URL = 'https://example.test'
  mocks.getValidatedJson.mockResolvedValue({ version: '2.1.0' })
  mocks.createWebsiteNotificationEvent.mockResolvedValue({
    created: true,
    event: { id: 'release:2.1.0' },
  })
})

afterEach(() => {
  restoreEnvironment('WEBSITE_RELEASE_CONFIRMATION_TOKEN', originalToken)
  restoreEnvironment('PUBLIC_APP_URL', originalPublicAppUrl)
})

describe('release confirmation handler', () => {
  it('creates an event only for the deployed public changelog release', async () => {
    const response = await handler(request())

    expect(response.status).toBe(201)
    expect(mocks.createWebsiteNotificationEvent).toHaveBeenCalledWith({
      id: 'release:2.1.0',
      type: 'release.published',
      title: '2.1.0 正式版',
      summary: '新增批量操作；修复登录异常',
      url: 'https://example.test/changelog#release-release-2.1.0',
      published_at: '2026-08-04T08:00:00.000Z',
      version: '2.1.0',
    })
    await expect(response.json()).resolves.toEqual({ ok: true, created: true, event_id: 'release:2.1.0' })
  })

  it('returns an idempotent success when the release event already exists unchanged', async () => {
    mocks.createWebsiteNotificationEvent.mockResolvedValue({
      created: false,
      event: { id: 'release:2.1.0' },
    })

    const response = await handler(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ created: false })
  })

  it('rejects a release version that does not match the running build', async () => {
    mocks.getValidatedJson.mockResolvedValue({ version: '2.0.9' })

    const response = await handler(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'deployed_release_mismatch' })
    expect(mocks.createWebsiteNotificationEvent).not.toHaveBeenCalled()
  })

  it('requires an independent release confirmation token', async () => {
    const response = await handler(request('Bearer wrong-token'))

    expect(response.status).toBe(401)
    expect(mocks.getValidatedJson).not.toHaveBeenCalled()
  })
})

function request(authorization = `Bearer ${token}`): Request {
  return new Request('https://example.test/api/internal/releases/confirm', {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: '2.1.0' }),
  })
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
