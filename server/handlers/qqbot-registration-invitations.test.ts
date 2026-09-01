import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  issueQqBotRegistrationInvitation: vi.fn(),
  reservePersistentRateLimit: vi.fn(),
  retain: vi.fn(),
}))

vi.mock('../storage/admin-registration-invitation-store', () => ({
  issueQqBotRegistrationInvitation: mocks.issueQqBotRegistrationInvitation,
}))
vi.mock('../security/persistent-rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('../security/persistent-rate-limit')>(),
  reservePersistentRateLimit: mocks.reservePersistentRateLimit,
}))

import handler from './qqbot-registration-invitations'

const originalEventsToken = process.env.WEBSITE_EVENTS_TOKEN
const originalReleaseToken = process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN
const originalPublicUrl = process.env.PUBLIC_APP_URL
const eventsToken = 'qqbot-integration-token-that-is-at-least-32-bytes'
const releaseToken = 'release-confirmation-token-at-least-32-bytes'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WEBSITE_EVENTS_TOKEN = eventsToken
  process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN = releaseToken
  process.env.PUBLIC_APP_URL = 'https://example.test/'
  mocks.reservePersistentRateLimit.mockResolvedValue({
    allowed: true,
    attempt: { retain: mocks.retain, refund: vi.fn() },
  })
  mocks.issueQqBotRegistrationInvitation.mockResolvedValue({
    status: 'created',
    code: '12AB34CD5E6F7G8H',
    expiresAt: '2026-09-02T00:00:00.000Z',
  })
})

afterEach(() => {
  restoreEnvironment('WEBSITE_EVENTS_TOKEN', originalEventsToken)
  restoreEnvironment('WEBSITE_RELEASE_CONFIRMATION_TOKEN', originalReleaseToken)
  restoreEnvironment('PUBLIC_APP_URL', originalPublicUrl)
})

describe('QQ Bot registration invitation handler', () => {
  it('reuses the event-feed bearer token and returns a fragment registration URL', async () => {
    const response = await handler(request())

    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      schema_version: 1,
      status: 'created',
      invitation_code: '12AB34CD5E6F7G8H',
      expires_at: '2026-09-02T00:00:00.000Z',
      registration_url: 'https://example.test/tool/profiles#invite=12AB34CD5E6F7G8H',
    })
    expect(mocks.issueQqBotRegistrationInvitation).toHaveBeenCalledWith({
      qqNumber: '123456789',
      encryptionSecret: eventsToken,
    })
    expect(mocks.retain).toHaveBeenCalledOnce()
  })

  it('returns the same generic authentication failures as the event feed', async () => {
    for (const authorization of [null, 'Bearer incorrect-token']) {
      const response = await handler(request(authorization))
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    }

    const forbidden = await handler(request(`Bearer ${releaseToken}`))
    expect(forbidden.status).toBe(403)
    expect(mocks.issueQqBotRegistrationInvitation).not.toHaveBeenCalled()
  })

  it('returns bound without exposing account or invitation data', async () => {
    mocks.issueQqBotRegistrationInvitation.mockResolvedValue({ status: 'bound' })

    const response = await handler(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ schema_version: 1, status: 'bound' })
  })

  it('rejects malformed QQ numbers before issuing an invitation', async () => {
    const response = await handler(request(undefined, { qq_number: '1234' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_request' })
    expect(mocks.reservePersistentRateLimit).not.toHaveBeenCalled()
    expect(mocks.issueQqBotRegistrationInvitation).not.toHaveBeenCalled()
  })

  it('returns Retry-After when issuance is rate limited', async () => {
    mocks.reservePersistentRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 19 })

    const response = await handler(request())

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('19')
    expect(mocks.issueQqBotRegistrationInvitation).not.toHaveBeenCalled()
  })
})

function request(
  authorization: string | null | undefined = `Bearer ${eventsToken}`,
  body: unknown = { qq_number: '123456789' },
): Request {
  return new Request('https://example.test/api/integrations/qqbot/registration-invitations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  })
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
