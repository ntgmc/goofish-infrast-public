import { Buffer } from 'node:buffer'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import type {
  WorkspaceResultHistoryExportItem,
  WorkspaceResultHistoryItem,
  WorkspaceResultHistoryPage,
  WorkspaceResultHistorySummary,
} from '../../src/lib/types'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'

const OPTIMIZATION_RESULT_PAGE_SIZE = 20
export const OPTIMIZATION_RESULT_PAGE_MAX_SIZE = 50

type ResultScope = 'active' | 'archived'
interface QueryClient {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>
}

type OptimizationResultRow = {
  profile_id: string
  id: string
  job_id: string | null
  name: string
  created_at: string
  config_json: unknown
  result_json: unknown
  operator_count: number | string
  source: string
  archived_at: string | Date | null
  position: string | number
}

type OptimizationResultSummaryRow = Omit<OptimizationResultRow, 'config_json' | 'result_json'> & {
  has_config: boolean
  schedule_mode: string | null
}

export interface WorkspaceOptimizationResultOverview {
  latest_result: WorkspaceResultHistorySummary | null
  result_history: WorkspaceResultHistoryPage
  archived_results: WorkspaceResultHistoryPage
}

export class OptimizationResultCursorError extends Error {
  readonly code = 'result_cursor_invalid'
  readonly status = 400

  constructor() {
    super('结果列表游标无效，请刷新后重试。')
    this.name = 'OptimizationResultCursorError'
  }
}

export class OptimizationResultMutationError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
    readonly code: 'result_not_found' | 'result_archive_full' | 'result_history_full',
  ) {
    super(message)
    this.name = 'OptimizationResultMutationError'
  }
}

let schemaReady: Promise<void> | null = null

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}

export async function listProfileOptimizationResults(
  profileId: string,
  scope: ResultScope,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<WorkspaceResultHistoryPage> {
  await ensureSchema()
  return listProfileOptimizationResultsWithClient({ query }, profileId, scope, options)
}

async function listProfileOptimizationResultsWithClient(
  client: QueryClient,
  profileId: string,
  scope: ResultScope,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<WorkspaceResultHistoryPage> {
  const limit = normalizePageLimit(options.limit)
  const cursorPosition = options.cursor ? decodeOptimizationResultCursor(options.cursor) : null
  const rows = await client.query<OptimizationResultSummaryRow>(
    `select profile_id, id, job_id, name, created_at, operator_count, source, archived_at, position,
            config_json is not null as has_config,
            nullif(result_json->>'schedule_mode', '') as schedule_mode
       from optimization_result_history
      where profile_id = $1
        and archived_at is ${scope === 'archived' ? 'not null' : 'null'}
        and ($2::bigint is null or position < $2::bigint)
      order by position desc
      limit $3`,
    [profileId, cursorPosition, limit + 1],
  )
  const visibleRows = rows.rows.slice(0, limit)
  return {
    items: visibleRows.map((row) => toSummary(row, scope)),
    next_cursor: rows.rows.length > limit && visibleRows.length > 0
      ? encodeOptimizationResultCursor(String(visibleRows[visibleRows.length - 1].position))
      : null,
  }
}

export async function getProfileOptimizationResult(
  profileId: string,
  resultId: string,
): Promise<WorkspaceResultHistoryExportItem | null> {
  await ensureSchema()
  return getProfileOptimizationResultWithClient({ query }, profileId, resultId)
}

export async function getProfileOptimizationResultWithClient(
  client: QueryClient,
  profileId: string,
  resultId: string,
): Promise<WorkspaceResultHistoryExportItem | null> {
  const result = await client.query<OptimizationResultRow>(
    `select profile_id, id, job_id, name, created_at, config_json, result_json,
            operator_count, source, archived_at, position
       from optimization_result_history
      where profile_id = $1 and id = $2`,
    [profileId, resultId],
  )
  return result.rows[0] ? toHistoryItem(result.rows[0]) : null
}

export async function getLatestProfileOptimizationResult(
  profileId: string,
): Promise<WorkspaceResultHistoryExportItem | null> {
  await ensureSchema()
  const result = await query<OptimizationResultRow>(
    `select profile_id, id, job_id, name, created_at, config_json, result_json,
            operator_count, source, archived_at, position
       from optimization_result_history
      where profile_id = $1 and archived_at is null
      order by position desc
      limit 1`,
    [profileId],
  )
  return result.rows[0] ? toHistoryItem(result.rows[0]) : null
}

export async function getLatestProfileOptimizationResultSummaries(
  profileIds: string[],
): Promise<Map<string, WorkspaceResultHistorySummary>> {
  if (profileIds.length === 0) return new Map()
  await ensureSchema()
  const result = await query<OptimizationResultSummaryRow>(
    `select distinct on (profile_id)
            profile_id, id, job_id, name, created_at, operator_count, source,
            archived_at, position, config_json is not null as has_config,
            nullif(result_json->>'schedule_mode', '') as schedule_mode
       from optimization_result_history
      where profile_id = any($1::text[]) and archived_at is null
      order by profile_id, position desc`,
    [profileIds],
  )
  return new Map(result.rows.map((row) => [row.profile_id, toSummary(row, 'active')]))
}

export async function getWorkspaceOptimizationResultOverview(
  profileId: string,
): Promise<WorkspaceOptimizationResultOverview> {
  await ensureSchema()
  return withTransaction((client) => getWorkspaceOptimizationResultOverviewWithClient(client, profileId))
}

export async function getWorkspaceOptimizationResultOverviewWithClient(
  client: QueryClient,
  profileId: string,
): Promise<WorkspaceOptimizationResultOverview> {
  const resultHistory = await listProfileOptimizationResultsWithClient(client, profileId, 'active')
  const archivedResults = await listProfileOptimizationResultsWithClient(client, profileId, 'archived')
  return {
    latest_result: resultHistory.items[0] ?? null,
    result_history: resultHistory,
    archived_results: archivedResults,
  }
}

export async function listOptimizationResultsForProfiles(
  profileIds: string[],
): Promise<Map<string, WorkspaceResultHistoryExportItem[]>> {
  if (profileIds.length === 0) return new Map()
  await ensureSchema()
  const result = await query<OptimizationResultRow>(
    `select profile_id, id, job_id, name, created_at, config_json, result_json,
            operator_count, source, archived_at, position
       from optimization_result_history
      where profile_id = any($1::text[])
      order by profile_id, archived_at nulls first, position desc`,
    [profileIds],
  )
  const byProfile = new Map<string, WorkspaceResultHistoryExportItem[]>()
  for (const row of result.rows) {
    const items = byProfile.get(row.profile_id) ?? []
    items.push(toHistoryItem(row))
    byProfile.set(row.profile_id, items)
  }
  return byProfile
}

export async function insertProfileOptimizationResultInTransaction(
  client: PoolClient,
  profileId: string,
  item: WorkspaceResultHistoryItem,
  historyLimit: number,
): Promise<boolean> {
  await lockProfileResults(client, profileId)
  const inserted = await insertResultRow(client, profileId, item, null)
  if (!inserted) return false
  await client.query(
    `delete from optimization_result_history
      where (profile_id, id) in (
        select profile_id, id
          from optimization_result_history
         where profile_id = $1 and archived_at is null
         order by position desc
         offset $2
      )`,
    [profileId, Math.max(0, Math.floor(historyLimit))],
  )
  return true
}

export async function migrateLegacyWorkspaceResultsInTransaction(
  client: PoolClient,
  profileId: string,
  legacy: {
    updated_at: string
    config: WorkspaceResultHistoryItem['config']
    last_result: WorkspaceResultHistoryItem['result'] | null
    result_history?: WorkspaceResultHistoryItem[]
    archived_results?: WorkspaceResultHistoryItem[]
    operator_count: number
  },
): Promise<void> {
  await lockProfileResults(client, profileId)
  for (const item of [...(legacy.result_history ?? [])].reverse()) {
    await insertResultRow(client, profileId, item, null)
  }
  for (const item of [...(legacy.archived_results ?? [])].reverse()) {
    await insertResultRow(client, profileId, item, legacy.updated_at)
  }
  if ((legacy.result_history?.length ?? 0) === 0 && legacy.last_result) {
    await insertResultRow(client, profileId, {
      id: 'legacy-last-result',
      name: '上次排班结果',
      created_at: legacy.updated_at,
      config: legacy.config,
      result: legacy.last_result,
      operator_count: legacy.operator_count,
      source: 'legacy',
    }, null)
  }
}

export async function mutateProfileOptimizationResultInTransaction(
  client: PoolClient,
  input: {
    profileId: string
    resultId: string
    action: 'archive' | 'unarchive' | 'delete'
    historyLimit: number
    archiveLimit: number
    now: string
  },
): Promise<void> {
  await lockProfileResults(client, input.profileId)
  const selected = await client.query<{ archived_at: string | Date | null }>(
    `select archived_at
       from optimization_result_history
      where profile_id = $1 and id = $2
      for update`,
    [input.profileId, input.resultId],
  )
  const row = selected.rows[0]
  if (!row) throw new OptimizationResultMutationError('排班结果不存在。', 404, 'result_not_found')
  const archived = row.archived_at !== null

  if (input.action === 'archive') {
    if (archived) return
    const count = await countScopeWithClient(client, input.profileId, 'archived')
    if (count >= input.archiveLimit) {
      throw new OptimizationResultMutationError(
        '封存区已满，请先取消封存或使用结果封存夹扩容。',
        409,
        'result_archive_full',
      )
    }
    await client.query(
      `update optimization_result_history
          set archived_at = $3::timestamptz,
              position = nextval('optimization_result_history_position_seq'),
              updated_at = $3::timestamptz
        where profile_id = $1 and id = $2`,
      [input.profileId, input.resultId, input.now],
    )
    return
  }

  if (input.action === 'delete') {
    if (archived) throw new OptimizationResultMutationError('普通历史中不存在该结果。', 404, 'result_not_found')
    await client.query(
      'delete from optimization_result_history where profile_id = $1 and id = $2 and archived_at is null',
      [input.profileId, input.resultId],
    )
    return
  }

  if (!archived) return
  const count = await countScopeWithClient(client, input.profileId, 'active')
  if (count >= input.historyLimit) {
    throw new OptimizationResultMutationError(
      '普通历史区已满，请先删除一个普通结果后再取消封存。',
      409,
      'result_history_full',
    )
  }
  await client.query(
    `update optimization_result_history
        set archived_at = null,
            position = nextval('optimization_result_history_position_seq'),
            updated_at = $3::timestamptz
      where profile_id = $1 and id = $2`,
    [input.profileId, input.resultId, input.now],
  )
}

function normalizePageLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return OPTIMIZATION_RESULT_PAGE_SIZE
  return Math.max(1, Math.min(OPTIMIZATION_RESULT_PAGE_MAX_SIZE, Math.floor(value as number)))
}

function encodeOptimizationResultCursor(position: string): string {
  return Buffer.from(JSON.stringify({ version: 1, position }), 'utf8').toString('base64url')
}

function decodeOptimizationResultCursor(cursor: string): string {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    const record = value as Record<string, unknown>
    if (record.version !== 1 || typeof record.position !== 'string' || !/^[1-9][0-9]*$/.test(record.position)) {
      throw new Error('invalid')
    }
    return record.position
  } catch {
    throw new OptimizationResultCursorError()
  }
}

async function lockProfileResults(client: QueryClient, profileId: string): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended('workspace:' || $1, 0))", [profileId])
}

async function insertResultRow(
  client: QueryClient,
  profileId: string,
  item: WorkspaceResultHistoryItem,
  archivedAt: string | null,
): Promise<boolean> {
  const result = await client.query(
    `insert into optimization_result_history
      (profile_id, id, job_id, name, created_at, config_json, result_json,
       operator_count, source, archived_at, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::timestamptz, now())
     on conflict (profile_id, id) do nothing`,
    [
      profileId,
      item.id,
      item.job_id ?? null,
      item.name,
      item.created_at,
      item.config === null ? null : JSON.stringify(item.config),
      JSON.stringify(item.result),
      Math.max(0, Math.floor(item.operator_count)),
      item.source,
      archivedAt,
    ],
  )
  return Boolean(result.rowCount)
}

async function countScopeWithClient(client: QueryClient, profileId: string, scope: ResultScope): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
       from optimization_result_history
      where profile_id = $1 and archived_at is ${scope === 'archived' ? 'not null' : 'null'}`,
    [profileId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

function toSummary(row: OptimizationResultSummaryRow, scope: ResultScope): WorkspaceResultHistorySummary {
  const scheduleMode = row.schedule_mode || null
  return {
    id: row.id,
    ...(row.job_id ? { job_id: row.job_id } : {}),
    name: row.name,
    created_at: row.created_at,
    operator_count: Number(row.operator_count),
    source: normalizeSource(row.source),
    archived: scope === 'archived',
    schedule_mode: scheduleMode,
    maa_exportable: scheduleMode !== 'rotation',
    has_config: row.has_config,
  }
}

function toHistoryItem(row: OptimizationResultRow): WorkspaceResultHistoryExportItem {
  return {
    id: row.id,
    ...(row.job_id ? { job_id: row.job_id } : {}),
    name: row.name,
    created_at: row.created_at,
    config: isRecord(row.config_json) ? row.config_json as WorkspaceResultHistoryItem['config'] : null,
    result: row.result_json as WorkspaceResultHistoryItem['result'],
    operator_count: Number(row.operator_count),
    source: normalizeSource(row.source),
    archived_at: normalizeTimestamp(row.archived_at),
  }
}

function normalizeSource(value: string): WorkspaceResultHistoryItem['source'] {
  return value === 'applied_suggestions' || value === 'legacy' ? value : 'generated'
}

function normalizeTimestamp(value: string | Date | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
