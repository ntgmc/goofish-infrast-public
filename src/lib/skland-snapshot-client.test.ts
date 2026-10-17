import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api-client'
import { clearSklandAccountSnapshot, loadSklandSnapshot, readSklandSnapshotState, sklandSnapshotKey, subscribeSklandSnapshot, syncSklandSnapshotSession } from './skland-snapshot-client'
import type { SklandSnapshot } from './skland-snapshot'
import type { AuthSuccessResponse, UserGameAccount } from './types'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('./api-client', async (original) => ({ ...await original<typeof import('./api-client')>(), apiJson: mocks.api }))
const profile = { id: 'profile', status: 'active', skland_binding: { uid: 'uid', credential_status: 'available' } } as UserGameAccount
const key = sklandSnapshotKey('user', 'uid')
const snapshot = (): SklandSnapshot => ({ uid: 'uid', version: '1', retryAt: null,
  game: { state: 'fresh', fetchedAt: new Date().toISOString(), error: null },
  inventory: { state: 'fresh', fetchedAt: new Date().toISOString(), error: null, items: { '4001': 100 }, lmd: 100, exp: 0 } })
beforeEach(() => {
  syncSklandSnapshotSession(null)
  syncSklandSnapshotSession({ user: { id: 'user' }, profiles: [profile] } as AuthSuccessResponse)
  mocks.api.mockReset(); mocks.api.mockResolvedValue(snapshot())
})
afterEach(() => { syncSklandSnapshotSession(null); vi.unstubAllGlobals() })

describe('cross-page Skland data', () => {
  it('shares initial requests, data and manual refreshes between subscribers', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const listener = vi.fn()
    const unsubscribe = subscribeSklandSnapshot(key, listener)
    const [one, two] = await Promise.all([loadSklandSnapshot('user', profile), loadSklandSnapshot('user', profile)])
    expect(one).toBe(two)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    await loadSklandSnapshot('user', profile)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    mocks.api.mockResolvedValue({ ...snapshot(), version: '2' })
    await loadSklandSnapshot('user', profile, { force: true })
    expect(readSklandSnapshotState(key).data?.version).toBe('2')
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('shows a stale inventory while waiting for the unified revalidation', async () => {
    let finish!: (data: SklandSnapshot) => void
    mocks.api.mockResolvedValueOnce({ ...snapshot(), inventory: { ...snapshot().inventory, state: 'stale' } })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const result = loadSklandSnapshot('user', profile)
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2))
    expect(readSklandSnapshotState(key).data?.inventory.lmd).toBe(100)
    expect(readSklandSnapshotState(key).busy).toBe(true)
    finish({ ...snapshot(), version: '2' })
    await result
    expect(readSklandSnapshotState(key).data?.version).toBe('2')
  })

  it('keeps successful data after network failures and removes it after authorization failures', async () => {
    await loadSklandSnapshot('user', profile)
    mocks.api.mockRejectedValueOnce(new Error('offline'))
    await expect(loadSklandSnapshot('user', profile, { force: true })).rejects.toThrow('offline')
    expect(readSklandSnapshotState(key).data?.inventory.lmd).toBe(100)
    await vi.waitFor(() => expect(readSklandSnapshotState(key).busy).toBe(false))
    mocks.api.mockRejectedValueOnce(new ApiError('cleared', 400, { code: 'skland_credential_invalid' }, '/api/user/skland/snapshot/refresh'))
    await expect(loadSklandSnapshot('user', profile, { force: true })).rejects.toThrow('cleared')
    expect(readSklandSnapshotState(key).data).toBeNull()
  })

  it('cannot restore cleared or logged-out data from late responses', async () => {
    let finish!: (data: SklandSnapshot) => void
    mocks.api.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const result = loadSklandSnapshot('user', profile)
    clearSklandAccountSnapshot('uid')
    finish(snapshot())
    await result
    expect(readSklandSnapshotState(key).data).toBeNull()
    await loadSklandSnapshot('user', profile)
    syncSklandSnapshotSession(null)
    expect(readSklandSnapshotState(key).data).toBeNull()
  })
})
