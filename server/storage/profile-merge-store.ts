import { randomUUID } from 'node:crypto'
import { getPermissionRank, resolveRuntimePermission } from '../../src/lib/product-catalog'
import {
  WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT,
  WORKSPACE_RESULT_HISTORY_MAX_LIMIT,
  WORKSPACE_SAVED_CONFIG_MAX_LIMIT,
  WORKSPACE_SAVED_CONFIG_LIMIT,
  WORKSPACE_RESULT_HISTORY_LIMIT,
} from '../../src/lib/workspace-limits'
import { getEffectiveProfilePermission } from '../free-preview-trial'
import { saveProfileInTransaction } from './cdk-redemption'
import { withTransaction } from './postgres'
import {
  emptyWorkspace,
  getProfileWorkspaceForUpdateInTransaction,
  updateProfileWorkspaceInTransaction,
  type UserGameAccountRecord,
} from './user-store'

function mergePairs(profiles: UserGameAccountRecord[]): [UserGameAccountRecord, UserGameAccountRecord][] {
  const available = profiles.filter((profile) => !profile.merged_into_profile_id && !profile.archived_at && profile.status === 'active')
  return available.filter((profile) => profile.kind === 'free_preview' && profile.skland_binding?.uid).flatMap((source) => {
    const target = available.filter((profile) => (profile.kind ?? 'cdk') === 'cdk'
      && profile.skland_binding?.uid === source.skland_binding?.uid
      && (!profile.expires_at || Date.parse(profile.expires_at) > Date.now()))
      .sort((a, b) => getPermissionRank(b.permission) - getPermissionRank(a.permission)
        || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0]
    return target ? [[source, target] as [UserGameAccountRecord, UserGameAccountRecord]] : []
  })
}

export async function mergeDuplicateSklandProfiles(
  userId: string,
  profiles: UserGameAccountRecord[],
): Promise<UserGameAccountRecord[]> {
  const pairs = mergePairs(profiles)
  if (!pairs.length) return profiles.filter((profile) => !profile.merged_into_profile_id)
  return withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended('profile-merge-user:' || $1, 0))", [userId])
    const ids = [...new Set(pairs.flatMap(([source, target]) => [source.id, target.id]))].sort()
    // Admission uses the same owner locks, so no new task can start during a merge.
    for (const id of ids) await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`profile:${id}`])
    const locked = await client.query<{ record_json: UserGameAccountRecord }>(
      'select record_json from user_game_accounts where user_id = $1 and id = any($2::text[]) order by created_at asc, id asc for update',
      [userId, ids],
    )
    for (const [source, target] of mergePairs(locked.rows.map((row) => row.record_json))) {
      const busy = await client.query(
        "select 1 from optimize_jobs where (profile_id = any($1::text[]) or owner_key = any($2::text[])) and status in ('queued', 'running') limit 1",
        [[source.id, target.id], [`profile:${source.id}`, `profile:${target.id}`]],
      )
      if (busy.rowCount) continue
      // A missing/frozen/revoked CDK must never absorb an otherwise usable free profile.
      if (!resolveRuntimePermission(target.permission)) continue
      if (!target.cdk_key && target.authorization_source !== 'admin_grant') continue
      let targetPermission = target.permission
      if (target.cdk_key) {
        const cdk = await client.query<{ permission: string | null }>(
          `select permission from cdk_records where key = $1 and status = 'used' and cdk_type = 'profile'
            and (nullif(record_json->>'profile_expires_at', '') is null
              or (record_json->>'profile_expires_at')::timestamptz > now())`,
          [target.cdk_key],
        )
        const permission = resolveRuntimePermission(cdk.rows[0]?.permission)
        if (!cdk.rowCount || !permission) continue
        targetPermission = permission
      }
      if (getPermissionRank(getEffectiveProfilePermission(source)) > getPermissionRank(targetPermission)) continue
      const sourceWorkspace = await getProfileWorkspaceForUpdateInTransaction(client, source.id) ?? emptyWorkspace(source.id)
      const targetWorkspace = await getProfileWorkspaceForUpdateInTransaction(client, target.id) ?? emptyWorkspace(target.id)
      const savedConfigs = [...targetWorkspace.saved_configs, ...sourceWorkspace.saved_configs.map((item) => ({
        ...item,
        id: targetWorkspace.saved_configs.some((existing) => existing.id === item.id) ? randomUUID() : item.id,
      }))]
      if (targetWorkspace.config && sourceWorkspace.config
        && JSON.stringify(targetWorkspace.config) !== JSON.stringify(sourceWorkspace.config)
        && !savedConfigs.some((item) => JSON.stringify(item.config) === JSON.stringify(sourceWorkspace.config))) {
        savedConfigs.push({ id: randomUUID(), name: source.display_name, config: sourceWorkspace.config,
          created_at: sourceWorkspace.updated_at, updated_at: sourceWorkspace.updated_at, last_used_at: null })
      }
      const counts = await client.query<{ active: number; archived: number }>(
        `select count(*) filter (where archived_at is null)::integer as active,
                count(*) filter (where archived_at is not null)::integer as archived
           from optimization_result_history where profile_id = any($1::text[])`,
        [[source.id, target.id]],
      )
      const count = counts.rows[0]!
      if (savedConfigs.length > WORKSPACE_SAVED_CONFIG_MAX_LIMIT
        || count.active > WORKSPACE_RESULT_HISTORY_MAX_LIMIT || count.archived > WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT) continue
      const now = new Date().toISOString()
      await updateProfileWorkspaceInTransaction(client, target.id, () => ({
        ...targetWorkspace,
        operators: targetWorkspace.operators ?? sourceWorkspace.operators,
        config: targetWorkspace.config ?? sourceWorkspace.config,
        elite_overrides: targetWorkspace.operators ? targetWorkspace.elite_overrides : sourceWorkspace.elite_overrides,
        saved_configs: savedConfigs,
        updated_at: now,
      }))
      await client.query(
        `update optimization_result_history source
            set profile_id = $1,
                id = case when exists (select 1 from optimization_result_history target where target.profile_id = $1 and target.id = source.id)
                          then gen_random_uuid()::text else source.id end
          where source.profile_id = $2`,
        [target.id, source.id],
      )
      // Preserve purchased capacity and enough room to expose every merged item.
      for (const [type, required] of [
        ['plan_slots', Math.max(0, savedConfigs.length - WORKSPACE_SAVED_CONFIG_LIMIT)],
        ['history_slots', Math.max(0, count.active - WORKSPACE_RESULT_HISTORY_LIMIT)],
        ['archive_slots', count.archived],
      ] as const) {
        const balances = await client.query<{ profile_id: string; units: number }>(
          'select profile_id, units from profile_entitlement_balances where profile_id = any($1::text[]) and entitlement_type = $2',
          [[source.id, target.id], type],
        )
        const current = balances.rows.find((row) => row.profile_id === target.id)?.units ?? 0
        const inherited = balances.rows.find((row) => row.profile_id === source.id)?.units ?? 0
        const units = Math.max(current + inherited, required)
        if (units <= current) continue
        await client.query(
          `insert into profile_entitlement_balances (profile_id, entitlement_type, units, updated_at) values ($1, $2, $3, $4)
           on conflict (profile_id, entitlement_type) do update set units = excluded.units, updated_at = excluded.updated_at`,
          [target.id, type, units, now],
        )
        await client.query(
          `insert into entitlement_ledger (id, profile_id, entitlement_type, status, units, reference_type, reference_id, created_at, settled_at)
           values ($1, $2, $3, 'consumed', $4, 'profile_merge', $5, $6, $6)`,
          [randomUUID(), target.id, type, units - current, source.id, now],
        )
      }
      target.note ||= source.note
      target.merged_profile_ids = [...new Set([...(target.merged_profile_ids ?? []), source.id])]
      target.updated_at = now
      await saveProfileInTransaction(client, target)
      // Keep the source workspace and its claim/audit records; only the CDK profile remains selectable.
      await saveProfileInTransaction(client, {
        ...source, status: 'revoked', merged_into_profile_id: target.id, archived_at: now, updated_at: now,
      })
    }
    const result = await client.query<{ record_json: UserGameAccountRecord }>(
      "select record_json from user_game_accounts where user_id = $1 and nullif(record_json->>'merged_into_profile_id', '') is null order by created_at asc",
      [userId],
    )
    return result.rows.map((row) => row.record_json)
  })
}
