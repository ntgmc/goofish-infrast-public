import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserGameAccountRecord } from './storage/user-store'
import type { StoredSklandSnapshot } from './storage/skland-snapshot-store'
import { SKLAND_FRESH_MS, SKLAND_MAX_AGE_MS } from '../src/lib/skland-snapshot'

const mocks = vi.hoisted(() => ({ profiles: new Map<string, UserGameAccountRecord>(), rows: new Map<string, StoredSklandSnapshot>(),
  game: vi.fn(), inventory: vi.fn(), bindings: vi.fn(), save: vi.fn(), lock: vi.fn(), decrypt: vi.fn(), query: vi.fn(), version: 0 }))
vi.mock('./storage/user-store', () => ({ getProfileForUser: vi.fn(async (userId, id) => {
  const profile = mocks.profiles.get(id)
  return profile?.user_id === userId ? profile : null
}) }))
vi.mock('./storage/postgres', () => ({ query: mocks.query, withTransaction: async (work: (client: object) => unknown) => work({}),
  withPostgresAdvisoryLock: mocks.lock }))
vi.mock('./storage/skland-snapshot-store', () => ({ readSklandSnapshot: async (userId: string, uid: string) => mocks.rows.get(`${userId}:${uid}`) ?? null,
  saveSklandSnapshot: async (_client: unknown, profile: UserGameAccountRecord, data: StoredSklandSnapshot) => {
    mocks.save()
    if (mocks.profiles.get(profile.id)?.skland_binding?.encrypted_cred !== profile.skland_binding?.encrypted_cred) return null
    const row = { ...data, version: String(++mocks.version) }
    mocks.rows.set(`${profile.user_id}:${profile.skland_binding!.uid}`, row)
    return row
  } }))
vi.mock('./handlers/skland-client', async (original) => ({ ...await original<typeof import('./handlers/skland-client')>(),
  decryptSklandCredential: mocks.decrypt, convertSklandCharactersToOperators: (value: unknown) => { if (!value) throw new Error('invalid game'); return [] },
  SklandClient: class { getArknightsBindings = mocks.bindings; getGamePlayerInfo = mocks.game; getCultivatePlayer = mocks.inventory } }))
import { getSklandSnapshot, publicSklandSnapshot, readSnapshotItems, requireSklandProfile } from './skland-snapshot'
import { SklandClientError } from './handlers/skland-client'

const profile = { id: 'profile', user_id: 'user', status: 'active', skland_binding: { uid: 'uid', encrypted_cred: 'encrypted', credential_status: 'available' } } as UserGameAccountRecord
const inventory = { items: [{ id: '4001', count: 1234 }, { id: '2004', count: 3 }] }
function saved(age = 0): StoredSklandSnapshot {
  const time = new Date(Date.now() - age).toISOString()
  return { version: 'previous', game: { data: { chars: [] }, fetchedAt: time }, inventory: { data: inventory, fetchedAt: time }, errors: {}, lastAttemptAt: time, retryAt: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.profiles.clear(); mocks.rows.clear()
  mocks.profiles.set(profile.id, structuredClone(profile))
  mocks.decrypt.mockReturnValue('credential')
  mocks.bindings.mockResolvedValue([{ uid: 'uid' }, { uid: 'other' }])
  mocks.lock.mockImplementation(async (_key: string, work: () => Promise<unknown>) => ({ acquired: true, value: await work() }))
  mocks.game.mockResolvedValue({ chars: [] })
  mocks.inventory.mockResolvedValue(inventory)
})

describe('shared Skland snapshots', () => {
  it('reuses persisted data across businesses without upstream requests', async () => {
    mocks.rows.set('user:uid', saved())
    await getSklandSnapshot(profile, ['inventory'])
    await getSklandSnapshot(profile)
    expect(mocks.bindings).not.toHaveBeenCalled()
    expect(mocks.game).not.toHaveBeenCalled()
    expect(mocks.inventory).not.toHaveBeenCalled()
  })

  it('shares concurrent refreshes across profiles bound to the same account', async () => {
    const second = { ...profile, id: 'second' }
    mocks.profiles.set(second.id, second)
    let complete!: (value: unknown) => void
    mocks.inventory.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    const reads = [getSklandSnapshot(profile), getSklandSnapshot(second, ['inventory'])]
    await vi.waitFor(() => expect(mocks.inventory).toHaveBeenCalledTimes(1))
    complete(inventory)
    const [a, b] = await Promise.all(reads)
    expect(a.version).toBe(b.version)
    expect(mocks.game).toHaveBeenCalledTimes(1)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it('waits for the version published by another API process instead of fetching again', async () => {
    mocks.rows.set('user:uid', saved(SKLAND_FRESH_MS + 1000))
    mocks.lock.mockResolvedValueOnce({ acquired: false })
    const result = getSklandSnapshot(profile, ['inventory'], { force: true })
    await vi.waitFor(() => expect(mocks.lock).toHaveBeenCalledOnce())
    mocks.rows.set('user:uid', { ...saved(), version: 'external-version' })
    expect((await result).version).toBe('external-version')
    expect(mocks.inventory).not.toHaveBeenCalled()
  })

  it('isolates different users and game accounts', async () => {
    const other = { ...profile, id: 'other', user_id: 'other-user', skland_binding: { ...profile.skland_binding!, uid: 'other' } }
    mocks.profiles.set(other.id, other)
    await Promise.all([getSklandSnapshot(profile), getSklandSnapshot(other)])
    expect(mocks.inventory).toHaveBeenCalledTimes(2)
    expect(mocks.rows.size).toBe(2)
    await expect(requireSklandProfile('other-user', profile.id)).rejects.toMatchObject({ status: 404 })
  })

  it('forces a fresh read but coalesces repeated clicks during the cooldown', async () => {
    mocks.rows.set('user:uid', saved())
    await getSklandSnapshot(profile, ['inventory'], { force: true })
    await getSklandSnapshot(profile, ['inventory'], { force: true })
    expect(mocks.inventory).toHaveBeenCalledTimes(1)
  })

  it('retains the last successful inventory and timestamp when refreshing it fails', async () => {
    const old = saved(SKLAND_FRESH_MS + 1000)
    mocks.rows.set('user:uid', old)
    mocks.inventory.mockRejectedValue(new Error('inventory unavailable'))
    const result = await getSklandSnapshot(profile, ['inventory'], { force: true })
    expect(result.inventory).toEqual(old.inventory)
    expect(result.game!.fetchedAt).not.toBe(old.game!.fetchedAt)
    expect(publicSklandSnapshot('uid', result).inventory).toMatchObject({ lmd: 1234, exp: 6000, error: 'inventory unavailable', state: 'stale' })
    await getSklandSnapshot(profile, ['inventory'], { force: true })
    expect(mocks.inventory).toHaveBeenCalledTimes(1)
  })

  it('rejects failed first imports and expired inventories instead of returning zero', async () => {
    mocks.inventory.mockRejectedValue(new Error('inventory unavailable'))
    await expect(getSklandSnapshot(profile, ['inventory'])).rejects.toThrow('inventory unavailable')
    mocks.rows.set('user:uid', saved(SKLAND_MAX_AGE_MS + 1000))
    await expect(getSklandSnapshot(profile, ['inventory'])).rejects.toThrow('inventory unavailable')
    expect(mocks.rows.get('user:uid')?.inventory).toBeUndefined()
  })

  it('respects upstream retry intervals across businesses', async () => {
    mocks.inventory.mockRejectedValue(new SklandClientError('request_failed', 'rate limited', 429, undefined, 120_000))
    const started = Date.now()
    await expect(getSklandSnapshot(profile, ['inventory'])).rejects.toThrow('rate limited')
    expect(Date.parse(mocks.rows.get('user:uid')!.retryAt!) - started).toBeGreaterThanOrEqual(120_000)
    await expect(getSklandSnapshot(profile, ['inventory'], { force: true })).rejects.toThrow('rate limited')
    expect(mocks.inventory).toHaveBeenCalledTimes(1)
  })

  it('cannot publish a late response after credentials were cleared', async () => {
    let complete!: (value: unknown) => void
    mocks.inventory.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    const result = getSklandSnapshot(profile)
    const rejected = expect(result).rejects.toMatchObject({ code: 'skland_binding_changed' })
    await vi.waitFor(() => expect(mocks.inventory).toHaveBeenCalledTimes(1))
    mocks.profiles.set(profile.id, { ...profile, skland_binding: { ...profile.skland_binding!, encrypted_cred: '' } })
    complete(inventory)
    await rejected
    expect(mocks.rows.size).toBe(0)
  })

  it('does not reuse cached data for frozen, archived or unauthorized profiles', async () => {
    mocks.rows.set('user:uid', saved())
    for (const update of [{ status: 'frozen' }, { archived_at: new Date().toISOString() }, { skland_binding: null }]) {
      mocks.profiles.set(profile.id, { ...profile, ...update } as UserGameAccountRecord)
      await expect(getSklandSnapshot(profile)).rejects.toBeDefined()
    }
    expect(mocks.game).not.toHaveBeenCalled()
  })

  it('marks malformed encrypted credentials invalid before any upstream request', async () => {
    mocks.decrypt.mockImplementationOnce(() => { throw new SklandClientError('credential_format_invalid', 'bad credential') })
    await expect(getSklandSnapshot(profile)).rejects.toMatchObject({ code: 'skland_credential_invalid', status: 400 })
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('credential_invalid_reason'),
      [profile.id, profile.skland_binding!.encrypted_cred, expect.any(String), 'credential_format_invalid'])
    expect(mocks.bindings).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('invalidates revoked credentials instead of accepting partial refreshes', async () => {
    mocks.inventory.mockRejectedValue(new SklandClientError('credential_invalid', 'credential revoked'))
    await expect(getSklandSnapshot(profile)).rejects.toMatchObject({ code: 'skland_credential_invalid' })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it.each([null, {}, { items: [{ id: '4001', count: '' }] }, { items: [{ id: '4001', count: false }] },
    { items: [{ id: '4001', count: -1 }] }, { items: [{ id: '4001', count: Infinity }] }])('rejects invalid inventory input %j', (value) => {
    expect(() => readSnapshotItems(value)).toThrow()
  })
})
