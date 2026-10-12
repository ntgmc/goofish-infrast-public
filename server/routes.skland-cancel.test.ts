import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  profile: { id: 'profile-1', skland_pending_binding: null as null | { confirmation_id: string } },
  freePending: new Set<string>(),
  lifetimePending: new Set<string>(),
}))

vi.mock('./handlers/user-auth', async (original) => ({
  ...await original<typeof import('./handlers/user-auth')>(),
  requireUserSession: async () => ({ user: { id: 'user-1' } }),
}))
vi.mock('./storage/user-store', async (original) => ({
  ...await original<typeof import('./storage/user-store')>(),
  getProfileForUser: async () => state.profile,
  deleteFreePreviewPendingClaim: async (userId: string, pendingId: string) => state.freePending.delete(`${userId}:${pendingId}`),
  deleteLifetimeVoucherPendingBinding: async (userId: string, pendingId: string) => state.lifetimePending.delete(`${userId}:${pendingId}`),
}))
vi.mock('./storage/postgres', async (original) => ({
  ...await original<typeof import('./storage/postgres')>(),
  withTransaction: async (work: (client: unknown) => Promise<unknown>) => work({ query: async () => ({ rows: [{ record_json: state.profile }] }) }),
}))
vi.mock('./storage/cdk-redemption', async (original) => ({
  ...await original<typeof import('./storage/cdk-redemption')>(),
  saveProfileInTransaction: async (_client: unknown, profile: typeof state.profile) => { state.profile = profile },
}))
vi.mock('./security/layered-auth-rate-limit', async (original) => ({
  ...await original<typeof import('./security/layered-auth-rate-limit')>(),
  reserveSklandAttemptLayered: async () => ({ allowed: true, attempt: { retainFailure() {} } }),
}))
vi.mock('./storage/feature-settings-store', async (original) => ({
  ...await original<typeof import('./storage/feature-settings-store')>(),
  getSiteFeatureSettings: async () => ({}),
}))

import { createApiServer } from './http-server'
const server = createApiServer()
let baseUrl: string
beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})
beforeEach(() => {
  state.profile = { id: 'profile-1', skland_pending_binding: { confirmation_id: 'pending-1' } }
  state.freePending.add('user-1:pending-1')
  state.lifetimePending.add('user-1:pending-1')
})

describe('Skland cancellation HTTP routes', () => {
  it.each(['', '/free-preview', '/lifetime-voucher'])('routes %s cancellation to its handler and clears pending state', async (suffix) => {
    const path = `/api/user/skland${suffix}/pending/cancel`
    const response = await fetch(baseUrl + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending_id: 'pending-1', ...(!suffix && { profile_id: 'profile-1' }) }),
    })
    expect(response.status).toBe(204)
    if (!suffix) expect(state.profile.skland_pending_binding).toBeNull()
    if (suffix === '/free-preview') expect(state.freePending.has('user-1:pending-1')).toBe(false)
    if (suffix === '/lifetime-voucher') expect(state.lifetimePending.has('user-1:pending-1')).toBe(false)
    const invalid = await fetch(baseUrl + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(invalid.status).toBe(400)
  })
})
