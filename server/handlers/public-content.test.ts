import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PUBLIC_CONTENT_DRAFT, cloneDefaultPublicContentSettings } from '../../src/lib/public-content'

const auth = vi.hoisted(() => ({ authenticateAdminRequest: vi.fn() }))
const store = vi.hoisted(() => ({ getPublicContentSettings: vi.fn(), savePublicContentSettings: vi.fn() }))

vi.mock('./admin-auth', () => auth)
vi.mock('../storage/public-content-settings-store', () => store)

import adminHandler from './admin-public-content'
import siteHandler from './site-public-content'
import { SettingsConflictError } from '../storage/settings-conflict'

describe('public content handlers', () => {
  beforeEach(() => {
    const settings = cloneDefaultPublicContentSettings()
    auth.authenticateAdminRequest.mockReset().mockResolvedValue({ ok: true })
    store.getPublicContentSettings.mockReset().mockResolvedValue({ ...settings, revision: 3 })
    store.savePublicContentSettings.mockReset().mockResolvedValue({ ...settings, revision: 4, updated_at: '2026-07-22T00:00:00.000Z' })
  })

  it('serves public content without authentication and disables caching', async () => {
    const response = await siteHandler(new Request('http://localhost/api/site/public-content'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({ version: 1, defaults_revision: 2, qq_group: { number: '891655477' } })
    expect(body).not.toHaveProperty('revision')
    expect(auth.authenticateAdminRequest).not.toHaveBeenCalled()
  })

  it('returns a no-store 503 when public storage is unavailable', async () => {
    store.getPublicContentSettings.mockRejectedValue(new Error('offline'))
    const response = await siteHandler(new Request('http://localhost/api/site/public-content'))
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('authenticates admin reads and complete writes', async () => {
    const getResponse = await adminHandler(new Request('http://localhost/api/admin/public-content'))
    expect(getResponse.status).toBe(200)

    const putResponse = await adminHandler(jsonRequest({ ...DEFAULT_PUBLIC_CONTENT_DRAFT, expected_revision: 3 }))
    expect(putResponse.status).toBe(200)
    expect(store.savePublicContentSettings).toHaveBeenCalledWith(DEFAULT_PUBLIC_CONTENT_DRAFT, 3)
  })

  it('rejects unauthenticated and invalid admin writes', async () => {
    auth.authenticateAdminRequest.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 401 }) })
    expect((await adminHandler(new Request('http://localhost/api/admin/public-content'))).status).toBe(401)

    const invalid = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    invalid.qq_group.join_url = 'javascript:alert(1)'
    const invalidResponse = await adminHandler(jsonRequest({ ...invalid, expected_revision: 3 }))
    expect(invalidResponse.status).toBe(400)
    await expect(invalidResponse.json()).resolves.toMatchObject({ code: 'invalid_request', issues: expect.any(Array) })
    expect(store.savePublicContentSettings).not.toHaveBeenCalled()
  })

  it('returns a stable conflict and lets unexpected store failures propagate', async () => {
    store.savePublicContentSettings.mockRejectedValueOnce(new SettingsConflictError())
    const conflict = await adminHandler(jsonRequest({ ...DEFAULT_PUBLIC_CONTENT_DRAFT, expected_revision: 3 }))
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: 'settings_conflict' })

    store.savePublicContentSettings.mockRejectedValueOnce(new Error('postgres password leaked'))
    await expect(adminHandler(jsonRequest({ ...DEFAULT_PUBLIC_CONTENT_DRAFT, expected_revision: 3 }))).rejects.toThrow('postgres password leaked')
  })
})

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/public-content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
