import { setTimeout as delay } from 'node:timers/promises'
import { SKLAND_MAX_AGE_MS, sklandResourceState, type SklandResource, type SklandSnapshot } from '../src/lib/skland-snapshot'
import { convertSklandCharactersToOperators, decryptSklandCredential, SklandClient, SklandClientError } from './handlers/skland-client'
import { query, withPostgresAdvisoryLock, withTransaction } from './storage/postgres'
import { readSklandSnapshot, saveSklandSnapshot, type SklandSnapshotRecord, type StoredSklandSnapshot } from './storage/skland-snapshot-store'
import { getProfileForUser, type UserGameAccountRecord } from './storage/user-store'
import { EXP_ITEM_VALUES } from './handlers/material-value'

const pending = new Map<string, Promise<StoredSklandSnapshot>>()

export class SklandSnapshotError extends Error {
  constructor(message: string, readonly status = 502, readonly code = 'skland_snapshot_failed') { super(message) }
}

export async function requireSklandProfile(userId: string, profileId: string): Promise<UserGameAccountRecord> {
  const profile = await getProfileForUser(userId, profileId)
  if (!profile) throw new SklandSnapshotError('账号档案不存在。', 404, 'profile_not_found')
  if (profile.status !== 'active' || profile.archived_at) throw new SklandSnapshotError('当前档案不可用。', 403, 'profile_unavailable')
  if (!profile.skland_binding?.encrypted_cred || profile.skland_binding.credential_status === 'invalid') {
    throw new SklandSnapshotError('请重新绑定森空岛，再更新游戏数据。', 400, 'skland_credential_invalid')
  }
  return profile
}

export function readSnapshotItems(value: unknown): Record<string, number> {
  const data = value as { data?: unknown; items?: unknown } | null
  const items = ((data?.data ?? data) as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) throw new SklandSnapshotError('森空岛库存格式异常，请稍后重试。')
  const result: Record<string, number> = {}
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new SklandSnapshotError('森空岛库存物品格式异常。')
    const row = item as Record<string, unknown>
    const id = row.id ?? row.itemId
    const rawCount = row.count ?? row.have ?? row.quantity
    const count = typeof rawCount === 'number' || typeof rawCount === 'string' && rawCount.trim() ? Number(rawCount) : NaN
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || !Number.isSafeInteger(count) || count < 0 || count > 1e12 || !Number.isSafeInteger((result[id] ?? 0) + count)) {
      throw new SklandSnapshotError('森空岛库存数量无效。')
    }
    result[id] = (result[id] ?? 0) + count
  }
  return result
}

export function publicSklandSnapshot(uid: string, snapshot: StoredSklandSnapshot): SklandSnapshot {
  const status = (resource: SklandResource) => ({ fetchedAt: snapshot[resource]?.fetchedAt ?? null,
    state: sklandResourceState(snapshot[resource]?.fetchedAt ?? null), error: snapshot.errors[resource] ?? null })
  const inventoryStatus = status('inventory')
  const items = inventoryStatus.state === 'fresh' || inventoryStatus.state === 'stale' ? readSnapshotItems(snapshot.inventory!.data) : null
  const exp = items ? Object.entries(EXP_ITEM_VALUES).reduce((sum, [id, value]) => sum + (items[id] ?? 0) * value, 0) : null
  if (exp !== null && (!Number.isSafeInteger(exp) || exp > 1e12)) throw new SklandSnapshotError('森空岛作战经验数量无效。')
  return { uid, version: snapshot.version, game: status('game'), inventory: { ...inventoryStatus, items,
    lmd: items ? items['4001'] ?? 0 : null, exp }, retryAt: snapshot.retryAt }
}

function usable(snapshot: StoredSklandSnapshot | null, resources: SklandResource[]) {
  return Boolean(snapshot && resources.every((resource) => snapshot[resource] && Date.now() - Date.parse(snapshot[resource]!.fetchedAt) < SKLAND_MAX_AGE_MS))
}

async function fetchSnapshot(profile: UserGameAccountRecord, previous: StoredSklandSnapshot | null): Promise<StoredSklandSnapshot> {
  const binding = profile.skland_binding!
  const startedAt = new Date().toISOString()
  let results: PromiseSettledResult<unknown>[]
  try {
    const client = new SklandClient(decryptSklandCredential(binding.encrypted_cred))
    const accounts = await client.getArknightsBindings()
    if (!accounts.some((account) => account.uid === binding.uid)) throw new SklandClientError('credential_invalid', '绑定账号已不在森空岛授权列表中，请重新绑定。')
    results = await Promise.allSettled([client.getGamePlayerInfo(binding.uid).then((data) => {
      convertSklandCharactersToOperators(data)
      return data
    }), client.getCultivatePlayer(binding.uid).then((data) => { readSnapshotItems(data); return data })])
    const invalid = results.find((result) => result.status === 'rejected' && result.reason instanceof SklandClientError && result.reason.code.startsWith('credential_'))
    if (invalid?.status === 'rejected') throw invalid.reason
  } catch (error) {
    if (error instanceof SklandClientError && error.code.startsWith('credential_')) {
      await query(`update user_game_accounts set record_json = jsonb_set(record_json, '{skland_binding}',
        (record_json->'skland_binding') || jsonb_build_object('credential_status', 'invalid', 'credential_invalid_at', $3::text,
          'credential_invalid_reason', $4::text)) || jsonb_build_object('updated_at', $3::text), updated_at = $3::timestamptz
        where id = $1 and record_json->'skland_binding'->>'encrypted_cred' = $2`,
      [profile.id, binding.encrypted_cred, startedAt, error.code === 'credential_format_invalid' ? 'credential_format_invalid' : 'expired_or_revoked'])
      throw new SklandSnapshotError(error.message, 400, 'skland_credential_invalid')
    }
    results = [{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }]
  }
  const next: SklandSnapshotRecord = { game: usable(previous, ['game']) ? previous!.game : undefined,
    inventory: usable(previous, ['inventory']) ? previous!.inventory : undefined, errors: {}, errorCodes: {}, lastAttemptAt: startedAt, retryAt: null }
  for (const [index, resource] of (['game', 'inventory'] as const).entries()) {
    const result = results[index]
    if (result.status === 'fulfilled') next[resource] = { data: result.value, fetchedAt: new Date().toISOString() }
    else {
      next.errors[resource] = result.reason instanceof Error ? result.reason.message : '森空岛数据更新失败，请稍后重试。'
      if (result.reason instanceof SklandClientError) next.errorCodes![resource] = result.reason.publicCode ?? 'skland_upstream_failed'
    }
  }
  const retryAfterMs = Math.max(Object.keys(next.errors).length ? 60_000 : 30_000,
    ...results.map((result) => result.status === 'rejected' && result.reason instanceof SklandClientError ? result.reason.retryAfterMs ?? 0 : 0))
  next.retryAt = new Date(Date.now() + retryAfterMs).toISOString()
  const saved = await withTransaction((client) => saveSklandSnapshot(client, profile, next))
  if (!saved) throw new SklandSnapshotError('森空岛授权已变更，请重新读取当前账号。', 409, 'skland_binding_changed')
  return saved
}

async function refreshSnapshot(profile: UserGameAccountRecord, force: boolean): Promise<StoredSklandSnapshot> {
  const uid = profile.skland_binding!.uid
  const key = JSON.stringify([profile.user_id, uid])
  const existing = pending.get(key)
  if (existing) return existing
  const operation = (async () => {
    const initial = await readSklandSnapshot(profile.user_id, uid)
    if (initial?.retryAt && Date.parse(initial.retryAt) > Date.now()) return initial
    const locked = await withPostgresAdvisoryLock(`skland-snapshot:${key}`, async () => {
      const currentProfile = await requireSklandProfile(profile.user_id, profile.id)
      if (currentProfile.skland_binding?.uid !== uid || currentProfile.skland_binding.encrypted_cred !== profile.skland_binding!.encrypted_cred) {
        throw new SklandSnapshotError('森空岛授权已变更，请重新读取当前账号。', 409, 'skland_binding_changed')
      }
      const current = await readSklandSnapshot(profile.user_id, uid)
      if (current && (current.retryAt && Date.parse(current.retryAt) > Date.now()
        || !force && ['game', 'inventory'].every((resource) => sklandResourceState(current[resource as SklandResource]?.fetchedAt ?? null) === 'fresh'))) return current
      return fetchSnapshot(currentProfile, current)
    })
    if (locked.acquired) return locked.value
    // Refreshes in another API process are shared through the persisted version.
    const deadline = Date.now() + 85_000
    while (Date.now() < deadline) {
      await delay(250)
      const current = await readSklandSnapshot(profile.user_id, uid)
      if (current && current.version !== initial?.version) return current
    }
    throw new SklandSnapshotError('森空岛数据正在更新，请稍后重试。', 503, 'skland_refresh_busy')
  })()
  pending.set(key, operation)
  try { return await operation } finally { if (pending.get(key) === operation) pending.delete(key) }
}

export async function getSklandSnapshot(profile: UserGameAccountRecord, resources: SklandResource[] = ['game', 'inventory'],
  options: { force?: boolean; wait?: boolean } = {}): Promise<StoredSklandSnapshot> {
  profile = await requireSklandProfile(profile.user_id, profile.id)
  const current = await readSklandSnapshot(profile.user_id, profile.skland_binding!.uid)
  if (!options.force && usable(current, resources)) {
    if (resources.every((resource) => sklandResourceState(current![resource]!.fetchedAt) === 'fresh')) return current!
    if (!options.wait) {
      void refreshSnapshot(profile, false).catch(() => undefined)
      return current!
    }
  }
  const next = await refreshSnapshot(profile, Boolean(options.force))
  // Recheck access after waiting on a refresh started by another profile/process.
  const authorized = await requireSklandProfile(profile.user_id, profile.id)
  if (authorized.skland_binding!.uid !== profile.skland_binding!.uid || authorized.skland_binding!.encrypted_cred !== profile.skland_binding!.encrypted_cred) {
    throw new SklandSnapshotError('森空岛授权已变更，请重新读取当前账号。', 409, 'skland_binding_changed')
  }
  if (!usable(next, resources)) {
    const resource = resources.find((resource) => !usable(next, [resource]))!
    throw new SklandSnapshotError(next.errors[resource] ?? '森空岛数据已过期，请刷新后重试。', 502, next.errorCodes?.[resource] ?? 'skland_snapshot_failed')
  }
  return next
}

export async function seedSklandSnapshot(client: Parameters<typeof saveSklandSnapshot>[0], profile: UserGameAccountRecord,
  input: { game: unknown; inventory?: unknown; fetchedAt: string }): Promise<void> {
  convertSklandCharactersToOperators(input.game)
  if (input.inventory !== undefined) readSnapshotItems(input.inventory)
  const previous = await readSklandSnapshot(profile.user_id, profile.skland_binding!.uid, client)
  await saveSklandSnapshot(client, profile, { game: { data: input.game, fetchedAt: input.fetchedAt },
    inventory: input.inventory !== undefined ? { data: input.inventory, fetchedAt: input.fetchedAt }
      : usable(previous, ['inventory']) ? previous!.inventory : undefined,
    errors: input.inventory === undefined ? { inventory: '养成库存暂未更新，请稍后重试。' } : {},
    lastAttemptAt: input.fetchedAt, retryAt: null })
}
