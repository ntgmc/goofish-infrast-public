import { copy } from '../copy'
import { ApiError, apiJson } from './api-client'
import { SKLAND_FRESH_MS, type SklandSnapshot } from './skland-snapshot'
import type { AuthSuccessResponse, UserGameAccount } from './types'

type State = { data: SklandSnapshot | null; busy: boolean; error: string; revision: number; checkedAt: number; blocked: boolean }
type Entry = { state: State; listeners: Set<() => void>; request: Promise<SklandSnapshot> | null; generation: number }
const entries = new Map<string, Entry>()
let user: string | null = null
let profiles = new Map<string, string>()
let channel: BroadcastChannel | null = null
let subscribers = 0
function broadcast(message: { key?: string; logout?: true }): void {
  if (channel) channel.postMessage(message)
  else if (typeof BroadcastChannel !== 'undefined') {
    const notification = new BroadcastChannel('maatool:skland-snapshot')
    notification.postMessage(message)
    notification.close()
  }
}
export const sklandSnapshotKey = (userId: string, uid: string) => JSON.stringify([userId, uid])

function entry(key: string): Entry {
  let current = entries.get(key)
  if (!current) {
    current = { state: { data: null, busy: false, error: '', revision: 0, checkedAt: 0, blocked: false }, listeners: new Set(), request: null, generation: 0 }
    entries.set(key, current)
  }
  return current
}

function update(current: Entry, patch: Partial<State>) {
  current.state = { ...current.state, ...patch }
  for (const listener of current.listeners) listener()
}

export function readSklandSnapshotState(key: string): State { return entry(key).state }

export function subscribeSklandSnapshot(key: string, listener: () => void): () => void {
  const current = entry(key)
  current.listeners.add(listener)
  subscribers++
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('maatool:skland-snapshot')
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data as { key?: unknown; logout?: unknown } | null
      if (value?.logout === true) { syncSklandSnapshotSession(null); return }
      if (typeof value?.key === 'string' && entries.has(value.key)) invalidateSklandSnapshot(value.key)
    }
  }
  return () => {
    current.listeners.delete(listener)
    if (--subscribers === 0) { channel?.close(); channel = null }
  }
}

export function invalidateSklandSnapshot(key: string, notify = false): void {
  const current = entries.get(key)
  if (current) {
    current.generation++
    current.request = null
    update(current, { checkedAt: 0, busy: false, error: '', blocked: false, revision: current.state.revision + 1 })
  }
  if (notify) broadcast({ key })
}

export function clearSklandAccountSnapshot(uid: string): void {
  if (!user) return
  const key = sklandSnapshotKey(user, uid)
  invalidateSklandSnapshot(key, true)
  const current = entries.get(key)
  if (current) update(current, { data: null, blocked: true })
}

export function syncSklandSnapshotSession(payload: Pick<AuthSuccessResponse, 'user' | 'profiles'> | null): void {
  const nextUser = payload?.user.id ?? null
  if (user !== nextUser) {
    user = nextUser
    profiles = new Map()
    for (const current of entries.values()) {
      current.generation++
      current.request = null
      update(current, { data: null, busy: false, error: '', checkedAt: 0, blocked: false, revision: current.state.revision + 1 })
    }
    if (!payload) broadcast({ logout: true })
  }
  for (const profile of payload?.profiles ?? []) {
    const binding = profile.skland_binding
    const signature = JSON.stringify([binding?.uid, binding?.bound_at, binding?.credential_status, binding?.last_imported_at, profile.status, profile.archived_at])
    const old = profiles.get(profile.id)
    if (old && old !== signature && binding?.uid) invalidateSklandSnapshot(sklandSnapshotKey(nextUser!, binding.uid), true)
    profiles.set(profile.id, signature)
  }
}

export function loadSklandSnapshot(userId: string, profile: Pick<UserGameAccount, 'id' | 'skland_binding'>,
  options: { force?: boolean; reload?: boolean } = {}): Promise<SklandSnapshot> {
  const key = sklandSnapshotKey(userId, profile.skland_binding!.uid)
  const current = entry(key)
  if (current.request) return current.request
  if (!options.force && !options.reload && current.state.data && Date.now() - current.state.checkedAt < SKLAND_FRESH_MS) return Promise.resolve(current.state.data)
  const generation = current.generation
  update(current, { busy: true, error: '' })
  const request = (async () => {
    let data = await apiJson<SklandSnapshot>(options.force ? '/api/user/skland/snapshot/refresh'
      : `/api/user/skland/snapshot?profile_id=${encodeURIComponent(profile.id)}`, {
      ...(options.force ? { method: 'POST', json: { profile_id: profile.id } } : {}),
      timeoutMs: 90_000, fallbackMessage: copy.skland.failed,
    })
    if (!options.force && (data.inventory.state === 'stale' || data.game.state === 'stale') && (!data.retryAt || Date.parse(data.retryAt) <= Date.now())) {
      if (current.generation === generation) update(current, { data })
      data = await apiJson<SklandSnapshot>('/api/user/skland/snapshot/refresh', { method: 'POST', json: { profile_id: profile.id, force: false },
        timeoutMs: 90_000, fallbackMessage: copy.skland.failed })
    }
    if (current.generation === generation) {
      const changed = current.state.data?.version !== data.version
      update(current, { data, checkedAt: Date.now(), blocked: false, error: data.inventory.error ?? data.game.error ?? '' })
      if (changed) broadcast({ key })
    }
    return data
  })()
  const tracked = request.catch((error) => {
    if (current.generation === generation) update(current, {
      ...(error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status) ? { data: null, blocked: true } : {}),
      error: error instanceof Error ? error.message : copy.skland.failed,
    })
    throw error
  }).finally(() => {
    if (current.request === tracked) { current.request = null; update(current, { busy: false }) }
  })
  current.request = tracked
  return tracked
}
