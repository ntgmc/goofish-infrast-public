import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), profile: vi.fn(), snapshot: vi.fn(), gate: vi.fn() }))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.auth,
  jsonResponse: (body: unknown, status = 200, headers = {}) => Response.json(body, { status, headers }) }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: mocks.gate }))
vi.mock('../skland-snapshot', async (original) => ({ ...await original<typeof import('../skland-snapshot')>(),
  requireSklandProfile: mocks.profile, getSklandSnapshot: mocks.snapshot }))
import handler from './skland-snapshot'
import { SklandSnapshotError } from '../skland-snapshot'
const request = (method = 'GET', body: unknown = { profile_id: 'mine' }) => new Request(
  `http://local/api/user/skland/snapshot${method === 'POST' ? '/refresh' : '?profile_id=mine'}`, {
    method, ...(method === 'POST' ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'user' } })
  mocks.profile.mockResolvedValue({ id: 'mine', skland_binding: { uid: 'uid', encrypted_cred: 'private-credential' } })
  const fetchedAt = new Date().toISOString()
  mocks.snapshot.mockResolvedValue({ version: '1', game: { data: { secretField: 'server-only' }, fetchedAt },
    inventory: { data: { items: [{ id: '4001', count: 500 }, { id: '2004', count: 5 }] }, fetchedAt }, errors: {}, retryAt: null })
  mocks.gate.mockResolvedValue(null)
})

describe('Skland snapshot HTTP boundary', () => {
  it('requires login and validates profile ownership before reading cached data', async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await handler(request())).status).toBe(401)
    mocks.profile.mockRejectedValueOnce(new SklandSnapshotError('Not found', 404, 'profile_not_found'))
    expect((await handler(request())).status).toBe(404)
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('returns a private projection with source timestamps rather than raw player data or credentials', async () => {
    const response = await handler(request())
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ uid: 'uid', version: '1', inventory: { lmd: 500, exp: 10000, state: 'fresh' } })
    expect(body).not.toContain('server-only')
    expect(body).not.toContain('private-credential')
    expect(mocks.profile).toHaveBeenCalledWith('user', 'mine')
  })

  it('validates explicit refreshes and supports automatic revalidation without bypassing freshness', async () => {
    expect((await handler(request('POST', { profile_id: 'mine', arbitrary: true }))).status).toBe(400)
    expect((await handler(request('POST'))).status).toBe(200)
    expect(mocks.snapshot).toHaveBeenLastCalledWith(expect.any(Object), ['inventory'], { force: true, wait: true })
    await handler(request('POST', { profile_id: 'mine', force: false }))
    expect(mocks.snapshot).toHaveBeenLastCalledWith(expect.any(Object), ['inventory'], { force: false, wait: true })
    expect((await handler(new Request('http://local/api/user/skland/snapshot/refresh'))).status).toBe(405)
  })
})
