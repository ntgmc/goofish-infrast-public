import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import {
  BEHAVIOR_RISK_MODEL_VERSION,
  evaluateBehaviorRiskEvents,
  type BehaviorRiskEvent,
  type BehaviorRiskEventType,
  type BehaviorRiskEvaluation,
  type BehaviorRiskPageCategory,
} from '../behavior-risk/scoring'
import type {
  BehaviorRiskAuditDto,
  BehaviorRiskCaseDto,
  BehaviorRiskCasePageDto,
  BehaviorRiskHealthDto,
  BehaviorRiskMemberDto,
} from '../../src/lib/behavior-risk-contracts'
import { getPool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const AUDIT_RETENTION_MS = 7 * 365 * 24 * 60 * 60 * 1000
const MAX_OCCURRED_AT_FUTURE_MS = 5 * 60 * 1000
const MAINTENANCE_LOCK_KEY = 1_743_861_291
const PURGE_LOCK_KEY = 1_743_861_292
const AUDIT_CHAIN_LOCK_KEY = 1_743_861_293
const HEALTH_KEY = 'global'
const DEFAULT_EVALUATION_BATCH_SIZE = 500
const MODEL_RECALIBRATION_ADMIN = `system:${BEHAVIOR_RISK_MODEL_VERSION}`
const MODEL_RECALIBRATION_NOTE = `评分模型升级至 ${BEHAVIOR_RISK_MODEL_VERSION}，旧待复核单已自动归档并按新模型重算。`
const DEFAULT_MAINTENANCE_STATEMENT_TIMEOUT_MS = 30_000
const DEFAULT_MAINTENANCE_LOCK_TIMEOUT_MS = 5_000

export type BehaviorRiskEventInput = {
  eventKey?: string | null
  eventType: BehaviorRiskEventType
  userId?: string | null
  profileId?: string | null
  jobId?: string | null
  browserHmac?: string | null
  sessionHmac?: string | null
  networkHmac?: string | null
  uaHmac?: string | null
  uidHmac?: string | null
  signalAliases?: Partial<Record<'browser' | 'session' | 'network' | 'ua' | 'uid', string[]>> | null
  outputHash?: string | null
  pageCategory?: BehaviorRiskPageCategory | null
  keyVersion: string
  optimizerVersion?: string | null
  structureSummary?: Record<string, unknown> | null
  activityClaimedAt?: string | null
  declarationVersion?: string | null
  declarationAcceptedAt?: string | null
  occurredAt?: Date
}

type BehaviorRiskReviewAction = {
  userId: string
  action: 'freeze_account' | 'freeze_profile'
  profileId?: string | null
}

export type BehaviorRiskReviewInput = {
  caseId: string
  outcome: 'dismiss' | 'restrict'
  note: string
  actions: BehaviorRiskReviewAction[]
  adminUsername: string
  now?: Date
}

type StoredEventRow = BehaviorRiskEvent & {
  key_version: string
  model_version: string
  optimizer_version: string | null
  structure_summary: Record<string, unknown> | null
  activity_claimed_at: string | null
  declaration_version: string | null
  declaration_accepted_at: string | null
  signal_aliases: NonNullable<BehaviorRiskEvent['signal_aliases']>
}

type CaseRow = {
  id: string
  group_key: string
  evidence_key: string
  status: 'pending' | 'dismissed' | 'actioned'
  score: number
  categories_json: string[]
  rules_json: BehaviorRiskEvaluation['rules']
  model_version: string
  first_seen_at: Date | string
  last_seen_at: Date | string
  expires_at: Date | string
  created_at: Date | string
  updated_at: Date | string
  reviewed_at: Date | string | null
  reviewed_by: string | null
}

type ReviewAuditRow = {
  id: string
  case_id: string | null
  admin_username: string
  outcome: 'dismiss' | 'restrict'
  note: string
  actions_json: Array<Record<string, unknown>>
  case_snapshot_json: Record<string, unknown>
  created_at: Date | string
  entry_hash: string | null
}

export async function insertBehaviorRiskEvent(input: BehaviorRiskEventInput): Promise<boolean> {
  await ensureDatabaseSchema()
  return insertBehaviorRiskEventInTransaction({ query }, input)
}

export async function insertBehaviorRiskEventInTransaction(
  client: Pick<PoolClient, 'query'>,
  input: BehaviorRiskEventInput,
): Promise<boolean> {
  const occurredAt = input.occurredAt ?? new Date()
  validateBehaviorRiskEventInput(input, occurredAt)
  const expiresAt = new Date(occurredAt.getTime() + RETENTION_MS)
  const result = await client.query<{ id: string }>(
    `insert into behavior_risk_events
      (id, event_key, event_type, user_id, profile_id, job_id, browser_hmac, session_hmac, network_hmac, ua_hmac,
       uid_hmac, signal_aliases_json, output_hash, page_category, key_version, model_version, optimizer_version, structure_summary,
       activity_claimed_at, declaration_version, declaration_accepted_at, occurred_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23)
     on conflict (event_key) do nothing
     returning id`,
    [
      randomUUID(), input.eventKey ?? null, input.eventType, input.userId ?? null, input.profileId ?? null,
      input.jobId ?? null, input.browserHmac ?? null, input.sessionHmac ?? null, input.networkHmac ?? null,
      input.uaHmac ?? null, input.uidHmac ?? null, JSON.stringify(input.signalAliases ?? {}), input.outputHash ?? null,
      input.pageCategory ?? null, input.keyVersion, BEHAVIOR_RISK_MODEL_VERSION, input.optimizerVersion ?? null,
      input.structureSummary ? JSON.stringify(input.structureSummary) : null, input.activityClaimedAt ?? null,
      input.declarationVersion ?? null, input.declarationAcceptedAt ?? null, occurredAt.toISOString(), expiresAt.toISOString(),
    ],
  )
  if (result.rowCount === 1 && input.userId) {
    await client.query(
      `insert into behavior_risk_dirty_users (user_id, first_event_at, last_event_at, updated_at)
       values ($1, $2, $2, now())
       on conflict (user_id) do update
         set first_event_at = least(behavior_risk_dirty_users.first_event_at, excluded.first_event_at),
             last_event_at = greatest(behavior_risk_dirty_users.last_event_at, excluded.last_event_at),
             updated_at = now()`,
      [input.userId, occurredAt.toISOString()],
    )
    await client.query(
      `insert into behavior_risk_health (key, last_collection_at, last_collection_status, updated_at)
       values ($1, $2, 'success', $2)
       on conflict (key) do update set
         last_collection_at = excluded.last_collection_at,
         last_collection_status = excluded.last_collection_status,
         updated_at = excluded.updated_at`,
      [HEALTH_KEY, occurredAt.toISOString()],
    )
  }
  return result.rowCount === 1
}

export async function getTrackedGenerationEvent(
  userId: string,
  profileId: string,
  jobId: string,
): Promise<StoredEventRow | null> {
  await ensureDatabaseSchema()
  const result = await query<StoredEventRow>(
    `select id, event_type, user_id, profile_id, job_id, browser_hmac, session_hmac, network_hmac, ua_hmac,
            uid_hmac, signal_aliases_json as signal_aliases, output_hash, page_category, key_version, model_version, optimizer_version, structure_summary,
            activity_claimed_at::text, declaration_version, declaration_accepted_at::text,
            occurred_at::text, expires_at::text
       from behavior_risk_events
      where event_type = 'generate' and user_id = $1 and profile_id = $2 and job_id = $3 and expires_at > now()
      order by occurred_at desc limit 1`,
    [userId, profileId, jobId],
  )
  return result.rows[0] ?? null
}

function validateBehaviorRiskEventInput(input: BehaviorRiskEventInput, occurredAt: Date): void {
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + MAX_OCCURRED_AT_FUTURE_MS) {
    throw new Error('Behavior risk event occurredAt is invalid or too far in the future.')
  }
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(input.keyVersion)) throw new Error('Behavior risk key version is invalid.')
  if (input.eventKey && input.eventKey.length > 256) throw new Error('Behavior risk event key is too long.')
  if (input.optimizerVersion && input.optimizerVersion.length > 256) throw new Error('Behavior risk optimizer version is too long.')
  if (input.declarationVersion && input.declarationVersion.length > 128) throw new Error('Behavior risk declaration version is too long.')
  for (const value of [input.browserHmac, input.sessionHmac, input.networkHmac, input.uaHmac, input.uidHmac, input.outputHash]) {
    if (value !== undefined && value !== null && !/^[a-f0-9]{64}$/.test(value)) {
      throw new Error('Behavior risk digest must be a lowercase SHA-256 value.')
    }
  }
  for (const aliases of Object.values(input.signalAliases ?? {})) {
    if (!Array.isArray(aliases) || aliases.length > 2 || aliases.some((value) => !/^[a-f0-9]{64}$/.test(value))) {
      throw new Error('Behavior risk signal aliases are invalid.')
    }
  }
}

export type BehaviorRiskEvaluationRun = {
  status: 'success' | 'lock_busy'
  cases: number
  purgedEvents: number
  eventsProcessed: number
  backlog: number
  durationMs: number
}

type DirtyUserClaim = { user_id: string; last_event_at: Date | string }

export async function runBehaviorRiskEvaluation(now = new Date()): Promise<BehaviorRiskEvaluationRun> {
  const startedAt = Date.now()
  await ensureDatabaseSchema()
  const client = await getPool().connect()
  let locked = false
  let transactionStarted = false
  let discardClient = false
  let previousTimeouts: { statement_timeout: string; lock_timeout: string } | null = null
  try {
    previousTimeouts = (await client.query<{ statement_timeout: string; lock_timeout: string }>(
      `select current_setting('statement_timeout') as statement_timeout,
              current_setting('lock_timeout') as lock_timeout`,
    )).rows[0] ?? null
    await client.query(
      `select set_config('statement_timeout', $1, false),
              set_config('lock_timeout', $2, false)`,
      [
        `${readPositiveInteger('BEHAVIOR_RISK_STATEMENT_TIMEOUT_MS', DEFAULT_MAINTENANCE_STATEMENT_TIMEOUT_MS)}ms`,
        `${readPositiveInteger('BEHAVIOR_RISK_LOCK_TIMEOUT_MS', DEFAULT_MAINTENANCE_LOCK_TIMEOUT_MS)}ms`,
      ],
    )
    locked = Boolean((await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [MAINTENANCE_LOCK_KEY])).rows[0]?.locked)
    if (!locked) {
      const backlog = await behaviorRiskBacklogCount(client)
      const durationMs = Date.now() - startedAt
      await writeBehaviorRiskHealth(client, {
        evaluationStatus: 'lock_busy',
        evaluatedAt: now,
        eventsProcessed: 0,
        durationMs,
      })
      return { status: 'lock_busy', cases: 0, purgedEvents: 0, eventsProcessed: 0, backlog, durationMs }
    }

    await client.query('begin')
    transactionStarted = true
    try {
      await enqueueLegacyModelUsers(client, now)
      const batchSize = readPositiveInteger('BEHAVIOR_RISK_EVALUATION_BATCH_SIZE', DEFAULT_EVALUATION_BATCH_SIZE)
      const dirty = await client.query<DirtyUserClaim>(
        `select user_id, last_event_at
           from behavior_risk_dirty_users
          order by updated_at, user_id
          limit $1
          for update skip locked`,
        [batchSize],
      )
      const eventRows = await loadAffectedBehaviorRiskEvents(client, dirty.rows.map((row) => row.user_id), now)
      const evaluations = evaluateBehaviorRiskEvents(eventRows, now).filter((evaluation) => evaluation.createCase)
      await archiveLegacyPendingCases(client, now)
      for (const evaluation of evaluations) {
        await upsertEvaluation(client, evaluation, eventRows, now)
      }
      await acknowledgeDirtyUsers(client, dirty.rows)
      const backlog = await behaviorRiskBacklogCount(client)
      const durationMs = Date.now() - startedAt
      await writeBehaviorRiskHealth(client, {
        evaluationStatus: 'success',
        evaluatedAt: now,
        eventsProcessed: eventRows.length,
        durationMs,
      })
      await client.query('commit')
      transactionStarted = false
      return {
        status: 'success',
        cases: evaluations.length,
        purgedEvents: 0,
        eventsProcessed: eventRows.length,
        backlog,
        durationMs,
      }
    } catch (error) {
      await client.query('rollback')
      transactionStarted = false
      throw error
    }
  } catch (error) {
    if (transactionStarted) await client.query('rollback').catch(() => undefined)
    await writeBehaviorRiskHealth(client, {
      evaluationStatus: 'failed',
      evaluatedAt: now,
      failureStage: 'evaluation',
      eventsProcessed: 0,
      durationMs: Date.now() - startedAt,
    }).catch(() => undefined)
    throw error
  } finally {
    if (locked) {
      const unlocked = await client.query<{ unlocked: boolean }>(
        'select pg_advisory_unlock($1) as unlocked',
        [MAINTENANCE_LOCK_KEY],
      ).then((result) => result.rows[0]?.unlocked === true).catch(() => false)
      discardClient ||= !unlocked
    }
    if (previousTimeouts) {
      const restored = await client.query(
        `select set_config('statement_timeout', $1, false),
                set_config('lock_timeout', $2, false)`,
        [previousTimeouts.statement_timeout, previousTimeouts.lock_timeout],
      ).then(() => true).catch(() => false)
      discardClient ||= !restored
    }
    client.release(discardClient)
  }
}

async function enqueueLegacyModelUsers(client: PoolClient, now: Date): Promise<void> {
  await client.query(
    `insert into behavior_risk_dirty_users (user_id, first_event_at, last_event_at, updated_at)
     select event.user_id, min(event.occurred_at), max(event.occurred_at), $2
       from behavior_risk_events event
      where event.user_id is not null and event.expires_at > $2
        and exists (
          select 1 from behavior_risk_cases risk_case
           where risk_case.status = 'pending' and risk_case.model_version <> $1
        )
      group by event.user_id
     on conflict (user_id) do update
       set first_event_at = least(behavior_risk_dirty_users.first_event_at, excluded.first_event_at),
           last_event_at = greatest(behavior_risk_dirty_users.last_event_at, excluded.last_event_at),
           updated_at = excluded.updated_at`,
    [BEHAVIOR_RISK_MODEL_VERSION, now.toISOString()],
  )
}

async function loadAffectedBehaviorRiskEvents(
  client: PoolClient,
  dirtyUserIds: string[],
  now: Date,
): Promise<StoredEventRow[]> {
  if (dirtyUserIds.length === 0) return []
  const seed = await selectBehaviorRiskEvents(client, dirtyUserIds, [], [], [], now)
  const firstSignals = collectEnvironmentSignals(seed)
  const firstExpansion = await selectBehaviorRiskEvents(
    client,
    dirtyUserIds,
    firstSignals.browser,
    firstSignals.network,
    firstSignals.ua,
    now,
  )
  const firstPass = dedupeEvents([...seed, ...firstExpansion])
  const expandedUserIds = [...new Set(firstPass.flatMap((event) => event.user_id ? [event.user_id] : []))]
  const expandedSignals = collectEnvironmentSignals(firstPass)
  const secondExpansion = await selectBehaviorRiskEvents(
    client,
    expandedUserIds,
    expandedSignals.browser,
    expandedSignals.network,
    expandedSignals.ua,
    now,
  )
  return dedupeEvents([...firstPass, ...secondExpansion])
    .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at))
}

async function selectBehaviorRiskEvents(
  client: PoolClient,
  userIds: string[],
  browserSignals: string[],
  networkSignals: string[],
  uaSignals: string[],
  now: Date,
): Promise<StoredEventRow[]> {
  const result = await client.query<StoredEventRow>(
    `select id, event_type, user_id, profile_id, job_id, browser_hmac, session_hmac, network_hmac, ua_hmac,
            uid_hmac, signal_aliases_json as signal_aliases, output_hash, page_category, key_version, model_version,
            optimizer_version, structure_summary, activity_claimed_at::text, declaration_version,
            declaration_accepted_at::text, occurred_at::text, expires_at::text
       from behavior_risk_events
      where expires_at > $1 and (
        user_id = any($2::text[])
        or browser_hmac = any($3::text[])
        or coalesce(signal_aliases_json->'browser', '[]'::jsonb) ?| $3::text[]
        or (
          (network_hmac = any($4::text[]) or coalesce(signal_aliases_json->'network', '[]'::jsonb) ?| $4::text[])
          and (ua_hmac = any($5::text[]) or coalesce(signal_aliases_json->'ua', '[]'::jsonb) ?| $5::text[])
        )
      )
      order by occurred_at asc`,
    [now.toISOString(), userIds, browserSignals, networkSignals, uaSignals],
  )
  return result.rows
}

function collectEnvironmentSignals(events: StoredEventRow[]): { browser: string[]; network: string[]; ua: string[] } {
  const collect = (namespace: 'browser' | 'network' | 'ua', primary: keyof StoredEventRow): string[] => [
    ...new Set(events.flatMap((event) => [
      typeof event[primary] === 'string' ? event[primary] as string : null,
      ...(event.signal_aliases?.[namespace] ?? []),
    ]).filter((value): value is string => Boolean(value))),
  ]
  return {
    browser: collect('browser', 'browser_hmac'),
    network: collect('network', 'network_hmac'),
    ua: collect('ua', 'ua_hmac'),
  }
}

function dedupeEvents(events: StoredEventRow[]): StoredEventRow[] {
  return [...new Map(events.map((event) => [event.id, event])).values()]
}

async function acknowledgeDirtyUsers(client: PoolClient, claims: DirtyUserClaim[]): Promise<void> {
  if (claims.length === 0) return
  await client.query(
    `delete from behavior_risk_dirty_users dirty
      using jsonb_to_recordset($1::jsonb) as claim(user_id text, last_event_at timestamptz)
      where dirty.user_id = claim.user_id and dirty.last_event_at <= claim.last_event_at`,
    [JSON.stringify(claims.map((claim) => ({ user_id: claim.user_id, last_event_at: toIso(claim.last_event_at) })))],
  )
}

async function behaviorRiskBacklogCount(client: Pick<PoolClient, 'query'>): Promise<number> {
  const result = await client.query<{ total: string }>('select count(*)::text as total from behavior_risk_dirty_users')
  return safeCount(result.rows[0]?.total)
}

async function writeBehaviorRiskHealth(
  client: Pick<PoolClient, 'query'>,
  input: {
    evaluationStatus: 'success' | 'lock_busy' | 'failed'
    evaluatedAt: Date
    failureStage?: string
    eventsProcessed: number
    durationMs: number
    purgedEvents?: number
  },
): Promise<void> {
  await client.query(
    `insert into behavior_risk_health
      (key, last_evaluation_at, last_evaluation_status, last_failure_at, last_failure_stage,
       events_processed, duration_ms, purged_events, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $2)
     on conflict (key) do update set
       last_evaluation_at = excluded.last_evaluation_at,
       last_evaluation_status = excluded.last_evaluation_status,
       last_failure_at = case when excluded.last_evaluation_status = 'failed' then excluded.last_failure_at else behavior_risk_health.last_failure_at end,
       last_failure_stage = case when excluded.last_evaluation_status = 'failed' then excluded.last_failure_stage else behavior_risk_health.last_failure_stage end,
       events_processed = excluded.events_processed,
       duration_ms = excluded.duration_ms,
       purged_events = greatest(behavior_risk_health.purged_events, excluded.purged_events),
       updated_at = excluded.updated_at`,
    [
      HEALTH_KEY,
      input.evaluatedAt.toISOString(),
      input.evaluationStatus,
      input.evaluationStatus === 'failed' ? input.evaluatedAt.toISOString() : null,
      input.failureStage ?? null,
      Math.max(0, input.eventsProcessed),
      Math.max(0, input.durationMs),
      Math.max(0, input.purgedEvents ?? 0),
    ],
  )
}

export async function purgeExpiredBehaviorRiskData(
  now = new Date(),
): Promise<{ status: 'success' | 'lock_busy'; purgedEvents: number; purgedCases: number }> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    const locked = Boolean((await client.query<{ locked: boolean }>(
      'select pg_try_advisory_xact_lock($1) as locked',
      [PURGE_LOCK_KEY],
    )).rows[0]?.locked)
    if (!locked) return { status: 'lock_busy', purgedEvents: 0, purgedCases: 0 }
    const purgedCases = await client.query('delete from behavior_risk_cases where expires_at <= $1', [now.toISOString()])
    const purgedEvents = await client.query('delete from behavior_risk_events where expires_at <= $1', [now.toISOString()])
    await client.query('delete from behavior_risk_review_audit where expires_at <= $1', [now.toISOString()])
    await writeBehaviorRiskHealth(client, {
      evaluationStatus: 'success',
      evaluatedAt: now,
      eventsProcessed: 0,
      durationMs: 0,
      purgedEvents: purgedEvents.rowCount ?? 0,
    })
    return {
      status: 'success',
      purgedEvents: purgedEvents.rowCount ?? 0,
      purgedCases: purgedCases.rowCount ?? 0,
    }
  })
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export async function listBehaviorRiskCases(options: {
  status?: 'pending' | 'dismissed' | 'actioned' | 'all'
  page?: number
  pageSize?: number
} = {}): Promise<BehaviorRiskCasePageDto> {
  await ensureDatabaseSchema()
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25))
  const status = options.status ?? 'pending'
  const where = status === 'all' ? '' : 'where status = $1'
  const values: unknown[] = status === 'all' ? [] : [status]
  const totalResult = await query<{ total: string }>(`select count(*)::text as total from behavior_risk_cases ${where}`, values)
  const total = safeCount(totalResult.rows[0]?.total)
  const totalPages = Math.ceil(total / pageSize)
  const page = totalPages === 0 ? 1 : Math.min(totalPages, Math.max(1, options.page ?? 1))
  const rows = await query<CaseRow>(
    `select * from behavior_risk_cases ${where} order by last_seen_at desc, id asc limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  )
  const [cases, health] = await Promise.all([buildAdminCases(rows.rows), getBehaviorRiskHealth()])
  return { cases, pagination: { page, page_size: pageSize, total, total_pages: totalPages }, health }
}

export async function reviewBehaviorRiskCase(input: BehaviorRiskReviewInput): Promise<Record<string, unknown>> {
  const note = input.note.trim()
  if (!note) throw new BehaviorRiskReviewError('复核说明不能为空。', 400)
  if (input.outcome === 'restrict' && input.actions.length === 0) {
    throw new BehaviorRiskReviewError('限制处置至少需要选择一个账号成员。', 400)
  }
  if (input.outcome === 'dismiss' && input.actions.length > 0) {
    throw new BehaviorRiskReviewError('误报关闭不能同时执行限制操作。', 400)
  }
  if (new Set(input.actions.map((action) => action.userId)).size !== input.actions.length) {
    throw new BehaviorRiskReviewError('每个复核单成员只能选择一种处置操作。', 400)
  }
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    const now = input.now ?? new Date()
    const caseResult = await client.query<CaseRow>('select * from behavior_risk_cases where id = $1 for update', [input.caseId])
    const caseRow = caseResult.rows[0]
    if (!caseRow) throw new BehaviorRiskReviewError('风控复核单不存在。', 404)
    if (caseRow.status !== 'pending') throw new BehaviorRiskReviewError('该复核单已经处理。', 409)
    const members = await client.query<{ user_id: string; evidence_json: Record<string, unknown> }>(
      'select user_id, evidence_json from behavior_risk_case_members where case_id = $1 order by user_id',
      [input.caseId],
    )
    const memberIds = new Set(members.rows.map((member) => member.user_id))
    const actionResults: Array<Record<string, unknown>> = []
    for (const action of input.actions) {
      if (!memberIds.has(action.userId)) throw new BehaviorRiskReviewError('所选账号不属于该复核单。', 409)
      if (action.action === 'freeze_account') {
        const updated = await client.query(
          `update user_accounts
              set status = 'frozen', record_json = jsonb_set(record_json, '{status}', '"frozen"'::jsonb, true), updated_at = $2
            where id = $1 and status <> 'revoked'`,
          [action.userId, now.toISOString()],
        )
        if (updated.rowCount !== 1) throw new BehaviorRiskReviewError('目标账号不存在或不可冻结。', 409)
        await client.query('delete from user_sessions where user_id = $1', [action.userId])
        actionResults.push({ user_id: action.userId, action: action.action, sessions_deleted: true })
      } else {
        if (!action.profileId) throw new BehaviorRiskReviewError('冻结档案时必须选择档案。', 400)
        const updated = await client.query(
          `update user_game_accounts
              set status = 'frozen', record_json = jsonb_set(record_json, '{status}', '"frozen"'::jsonb, true), updated_at = $3
            where id = $1 and user_id = $2 and status <> 'revoked'`,
          [action.profileId, action.userId, now.toISOString()],
        )
        if (updated.rowCount !== 1) throw new BehaviorRiskReviewError('目标档案不存在、归属不符或不可冻结。', 409)
        actionResults.push({ user_id: action.userId, profile_id: action.profileId, action: action.action })
      }
    }

    const status = input.outcome === 'dismiss' ? 'dismissed' : 'actioned'
    const transitioned = await client.query(
      `update behavior_risk_cases
          set status = $2, reviewed_at = $3, reviewed_by = $4, updated_at = $3
        where id = $1 and status = 'pending'`,
      [input.caseId, status, now.toISOString(), input.adminUsername],
    )
    if (transitioned.rowCount !== 1) throw new BehaviorRiskReviewError('该复核单已经处理。', 409)
    const snapshot = {
      id: caseRow.id,
      score: caseRow.score,
      categories: caseRow.categories_json,
      rules: caseRow.rules_json,
      model_version: caseRow.model_version,
      members: members.rows,
    }
    await insertBehaviorRiskReviewAudit(client, {
      caseId: input.caseId,
      adminUsername: input.adminUsername,
      outcome: input.outcome,
      note,
      actions: actionResults,
      snapshot,
      now,
    })
    return { ok: true, case_id: input.caseId, status, actions: actionResults, reviewed_at: now.toISOString() }
  })
}

async function archiveLegacyPendingCases(client: PoolClient, now: Date): Promise<void> {
  const legacyCases = await client.query<CaseRow>(
    `select * from behavior_risk_cases
      where status = 'pending' and model_version <> $1
      order by created_at, id
      for update`,
    [BEHAVIOR_RISK_MODEL_VERSION],
  )
  for (const caseRow of legacyCases.rows) {
    const members = await client.query<{ user_id: string; evidence_json: Record<string, unknown> }>(
      'select user_id, evidence_json from behavior_risk_case_members where case_id = $1 order by user_id',
      [caseRow.id],
    )
    const snapshot = {
      id: caseRow.id,
      score: caseRow.score,
      categories: caseRow.categories_json,
      rules: caseRow.rules_json,
      model_version: caseRow.model_version,
      members: members.rows,
    }
    await insertBehaviorRiskReviewAudit(client, {
      caseId: caseRow.id,
      adminUsername: MODEL_RECALIBRATION_ADMIN,
      outcome: 'dismiss',
      note: MODEL_RECALIBRATION_NOTE,
      actions: [],
      snapshot,
      now,
    })
    await client.query(
      `update behavior_risk_cases
          set status = 'dismissed', reviewed_at = $2, reviewed_by = $3, updated_at = $2
        where id = $1`,
      [caseRow.id, now.toISOString(), MODEL_RECALIBRATION_ADMIN],
    )
  }
}

async function upsertEvaluation(
  client: PoolClient,
  evaluation: BehaviorRiskEvaluation,
  events: StoredEventRow[],
  now: Date,
): Promise<void> {
  const groupKey = createHash('sha256').update(`${BEHAVIOR_RISK_MODEL_VERSION}:${evaluation.userIds.join(',')}`).digest('hex')
  const evidenceKey = createHash('sha256').update(`${groupKey}:${JSON.stringify(evaluation.rules)}`).digest('hex')
  const reviewed = await client.query<{ id: string }>(
    `select id from behavior_risk_cases
      where group_key = $1 and evidence_key = $2 and status in ('dismissed', 'actioned')
      order by reviewed_at desc nulls last limit 1`,
    [groupKey, evidenceKey],
  )
  if (reviewed.rowCount) return
  const overlappingResult = await client.query<{ id: string }>(
    `select c.id from behavior_risk_cases c
       join behavior_risk_case_members m on m.case_id = c.id
      where c.status = 'pending' and m.user_id = any($1::text[])
      order by c.id
      for update of c`,
    [evaluation.userIds],
  )
  const overlapping = [...new Map(overlappingResult.rows.map((row) => [row.id, row])).values()]
  const caseId = overlapping[0]?.id ?? randomUUID()
  for (const duplicate of overlapping.slice(1)) {
    await client.query('delete from behavior_risk_cases where id = $1 and status = \'pending\'', [duplicate.id])
  }
  const existing = overlapping.length > 0
  const parameters = [
    caseId, groupKey, evidenceKey, evaluation.score, JSON.stringify(evaluation.categories), JSON.stringify(evaluation.rules),
    BEHAVIOR_RISK_MODEL_VERSION, evaluation.firstSeenAt, evaluation.lastSeenAt, evaluation.expiresAt, now.toISOString(),
  ]
  if (existing) {
    const updated = await client.query(
      `update behavior_risk_cases
          set group_key = $2, evidence_key = $3, score = $4, categories_json = $5::jsonb, rules_json = $6::jsonb,
              model_version = $7, first_seen_at = least(first_seen_at, $8), last_seen_at = $9,
              expires_at = $10, updated_at = $11
        where id = $1 and status = 'pending'`,
      parameters,
    )
    if (updated.rowCount !== 1) return
    await client.query('delete from behavior_risk_case_members where case_id = $1 and not (user_id = any($2::text[]))', [caseId, evaluation.userIds])
  } else {
    await client.query(
      `insert into behavior_risk_cases
        (id, group_key, evidence_key, status, score, categories_json, rules_json, model_version, first_seen_at, last_seen_at, expires_at, created_at, updated_at)
       values ($1, $2, $3, 'pending', $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $11)`,
      parameters,
    )
  }
  for (const userId of evaluation.userIds) {
    const memberEvents = events.filter((event) => event.user_id === userId)
    const evidence = summarizeMemberEvidence(memberEvents)
    await client.query(
      `insert into behavior_risk_case_members (case_id, user_id, evidence_json, created_at, updated_at)
       values ($1, $2, $3::jsonb, $4, $4)
       on conflict (case_id, user_id) do update
         set evidence_json = excluded.evidence_json, updated_at = excluded.updated_at`,
      [caseId, userId, JSON.stringify(evidence), now.toISOString()],
    )
  }
}

async function insertBehaviorRiskReviewAudit(
  client: PoolClient,
  input: {
    caseId: string
    adminUsername: string
    outcome: 'dismiss' | 'restrict'
    note: string
    actions: Array<Record<string, unknown>>
    snapshot: Record<string, unknown>
    now: Date
  },
): Promise<void> {
  await client.query('select pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK_KEY])
  const previous = await client.query<{ entry_hash: string | null }>(
    `select entry_hash from behavior_risk_review_audit
      where entry_hash is not null
      order by created_at desc, id desc
      limit 1`,
  )
  const id = randomUUID()
  const previousHash = previous.rows[0]?.entry_hash ?? null
  const payload = {
    id,
    case_id: input.caseId,
    admin_username: input.adminUsername,
    outcome: input.outcome,
    note: input.note,
    actions: input.actions,
    case_snapshot: input.snapshot,
    created_at: input.now.toISOString(),
  }
  const entryHash = createHash('sha256').update(`${previousHash ?? ''}:${JSON.stringify(payload)}`).digest('hex')
  await client.query(
    `insert into behavior_risk_review_audit
      (id, case_id, admin_username, outcome, note, actions_json, case_snapshot_json,
       previous_hash, entry_hash, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)`,
    [
      id,
      input.caseId,
      input.adminUsername,
      input.outcome,
      input.note,
      JSON.stringify(input.actions),
      JSON.stringify(input.snapshot),
      previousHash,
      entryHash,
      input.now.toISOString(),
      new Date(input.now.getTime() + AUDIT_RETENTION_MS).toISOString(),
    ],
  )
}

function summarizeMemberEvidence(events: StoredEventRow[]): Record<string, unknown> {
  const counts = Object.fromEntries([...new Set(events.map((event) => event.event_type))].map((type) => [type, events.filter((event) => event.event_type === type).length]))
  const prefix = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value)))].slice(0, 5).map((value) => value.slice(0, 12))
  const operatorFingerprintHashes = events.map((event) => {
    const value = event.structure_summary?.operator_fingerprint_hash
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value : null
  })
  return {
    counts,
    first_seen_at: events[0]?.occurred_at ?? null,
    last_seen_at: events.at(-1)?.occurred_at ?? null,
    browser_prefixes: prefix(events.map((event) => event.browser_hmac)),
    network_prefixes: prefix(events.map((event) => event.network_hmac)),
    uid_prefixes: prefix(events.map((event) => event.uid_hmac)),
    output_prefixes: prefix(events.map((event) => event.output_hash)),
    operator_fingerprint_prefixes: prefix(operatorFingerprintHashes),
  }
}

async function buildAdminCases(caseRows: CaseRow[]): Promise<BehaviorRiskCaseDto[]> {
  if (caseRows.length === 0) return []
  const caseIds = caseRows.map((caseRow) => caseRow.id)
  const members = await query<{ case_id: string; user_id: string; evidence_json: Record<string, unknown> }>(
    `select case_id, user_id, evidence_json
       from behavior_risk_case_members
      where case_id = any($1::text[])
      order by case_id, user_id`,
    [caseIds],
  )
  const userIds = [...new Set(members.rows.map((member) => member.user_id))]
  const [accounts, profiles, audits] = await Promise.all([
    userIds.length > 0
      ? query<{ id: string; email: string }>('select id, email from user_accounts where id = any($1::text[]) order by id', [userIds])
      : Promise.resolve({ rows: [] as Array<{ id: string; email: string }> }),
    userIds.length > 0
      ? query<{ id: string; user_id: string; display_name: string; kind: string; status: string }>(
        `select id, user_id, display_name, coalesce(record_json->>'kind', 'cdk') as kind, status
           from user_game_accounts where user_id = any($1::text[]) order by user_id, created_at`,
        [userIds],
      )
      : Promise.resolve({ rows: [] as Array<{ id: string; user_id: string; display_name: string; kind: string; status: string }> }),
    query<ReviewAuditRow>(
      `select id, case_id, admin_username, outcome, note, actions_json, case_snapshot_json,
              created_at, entry_hash
         from behavior_risk_review_audit
        where case_id = any($1::text[])
        order by case_id, created_at desc, id desc`,
      [caseIds],
    ),
  ])
  const emailsByUserId = new Map(accounts.rows.map((account) => [account.id, account.email]))
  const profilesByUserId = groupBy(profiles.rows, (profile) => profile.user_id)
  const membersByCaseId = groupBy(members.rows, (member) => member.case_id)
  const auditsByCaseId = groupBy(audits.rows.filter((audit): audit is ReviewAuditRow & { case_id: string } => Boolean(audit.case_id)), (audit) => audit.case_id)

  return caseRows.map((caseRow) => ({
    id: caseRow.id,
    status: caseRow.status,
    score: caseRow.score,
    categories: caseRow.categories_json,
    rules: caseRow.rules_json,
    model_version: caseRow.model_version,
    first_seen_at: toIso(caseRow.first_seen_at),
    last_seen_at: toIso(caseRow.last_seen_at),
    expires_at: toIso(caseRow.expires_at),
    reviewed_at: caseRow.reviewed_at ? toIso(caseRow.reviewed_at) : null,
    reviewed_by: caseRow.reviewed_by,
    members: (membersByCaseId.get(caseRow.id) ?? []).map((member): BehaviorRiskMemberDto => {
      const evidence = { ...member.evidence_json }
      delete evidence.account_label
      return {
        user_id: member.user_id,
        counts: readCountRecord(evidence.counts),
        first_seen_at: readNullableString(evidence.first_seen_at),
        last_seen_at: readNullableString(evidence.last_seen_at),
        browser_prefixes: readStringArray(evidence.browser_prefixes),
        network_prefixes: readStringArray(evidence.network_prefixes),
        uid_prefixes: readStringArray(evidence.uid_prefixes),
        output_prefixes: readStringArray(evidence.output_prefixes),
        operator_fingerprint_prefixes: readStringArray(evidence.operator_fingerprint_prefixes),
        account_email: emailsByUserId.get(member.user_id) ?? null,
        profiles: (profilesByUserId.get(member.user_id) ?? []).map((profile) => ({
          profile_id: profile.id,
          profile_label: profile.display_name,
          kind: profile.kind,
          status: profile.status,
        })),
      }
    }),
    audits: (auditsByCaseId.get(caseRow.id) ?? []).map((audit): BehaviorRiskAuditDto => ({
      id: audit.id,
      admin_username: audit.admin_username,
      outcome: audit.outcome,
      note: audit.note,
      actions: Array.isArray(audit.actions_json) ? audit.actions_json : [],
      case_snapshot: audit.case_snapshot_json ?? {},
      created_at: toIso(audit.created_at),
      integrity_hash: audit.entry_hash,
    })),
  }))
}

async function getBehaviorRiskHealth(): Promise<BehaviorRiskHealthDto> {
  const [healthResult, backlogResult] = await Promise.all([
    query<{
      last_collection_at: Date | string | null
      last_collection_status: 'success' | 'disabled' | 'failed' | null
      last_evaluation_at: Date | string | null
      last_evaluation_status: 'success' | 'lock_busy' | 'failed' | null
      last_failure_at: Date | string | null
      last_failure_stage: string | null
      events_processed: number
      duration_ms: number
      purged_events: number
    }>('select * from behavior_risk_health where key = $1', [HEALTH_KEY]),
    query<{ total: string }>('select count(*)::text as total from behavior_risk_dirty_users'),
  ])
  const row = healthResult.rows[0]
  const backlog = safeCount(backlogResult.rows[0]?.total)
  const healthy = row?.last_collection_status === 'success' && row.last_evaluation_status === 'success'
  const degraded = row?.last_collection_status === 'disabled' || row?.last_collection_status === 'failed'
    || row?.last_evaluation_status === 'lock_busy' || row?.last_evaluation_status === 'failed'
  return {
    status: !row ? 'unknown' : healthy ? 'ok' : degraded ? 'degraded' : 'unknown',
    last_collection_at: row?.last_collection_at ? toIso(row.last_collection_at) : null,
    last_collection_status: row?.last_collection_status ?? null,
    last_evaluation_at: row?.last_evaluation_at ? toIso(row.last_evaluation_at) : null,
    last_evaluation_status: row?.last_evaluation_status ?? null,
    last_failure_at: row?.last_failure_at ? toIso(row.last_failure_at) : null,
    last_failure_stage: row?.last_failure_stage ?? null,
    backlog_count: backlog,
    events_processed: Math.max(0, Number(row?.events_processed ?? 0)),
    duration_ms: Math.max(0, Number(row?.duration_ms ?? 0)),
    purged_events: Math.max(0, Number(row?.purged_events ?? 0)),
  }
}

export async function recordBehaviorRiskCollectionStatus(
  status: 'disabled' | 'failed',
  now = new Date(),
): Promise<void> {
  await ensureDatabaseSchema()
  await query(
    `insert into behavior_risk_health (key, last_collection_at, last_collection_status, updated_at)
     values ($1, $2, $3, $2)
     on conflict (key) do update set
       last_collection_at = excluded.last_collection_at,
       last_collection_status = excluded.last_collection_status,
       updated_at = excluded.updated_at`,
    [HEALTH_KEY, now.toISOString(), status],
  )
}

export async function recordBehaviorRiskAdminAudit(input: {
  adminUsername: string | null
  capability: 'risk_view' | 'risk_review' | 'risk_config'
  action: string
  decision: 'allow' | 'deny'
  reason: string
  requestId: string
  now?: Date
}): Promise<void> {
  await ensureDatabaseSchema()
  await query(
    `insert into behavior_risk_admin_audit
      (id, admin_username, capability, action, decision, reason, request_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      input.adminUsername,
      input.capability,
      input.action.slice(0, 128),
      input.decision,
      input.reason.slice(0, 500),
      input.requestId.slice(0, 128),
      (input.now ?? new Date()).toISOString(),
    ],
  )
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value])
  return grouped
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readCountRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, count]) => (
    Number.isSafeInteger(count) && Number(count) >= 0 ? [[key, Number(count)]] : []
  )))
}

function safeCount(value: string | undefined): number {
  const count = Number(value ?? 0)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Behavior risk count exceeds the safe integer range.')
  return count
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export class BehaviorRiskReviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'BehaviorRiskReviewError'
  }
}
