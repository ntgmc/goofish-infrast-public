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
import { getPool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const MAINTENANCE_LOCK_KEY = 1_743_861_291

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

export type BehaviorRiskReviewAction = {
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

export async function insertBehaviorRiskEvent(input: BehaviorRiskEventInput): Promise<boolean> {
  await ensureDatabaseSchema()
  const occurredAt = input.occurredAt ?? new Date()
  const expiresAt = new Date(occurredAt.getTime() + RETENTION_MS)
  const result = await query<{ id: string }>(
    `insert into behavior_risk_events
      (id, event_key, event_type, user_id, profile_id, job_id, browser_hmac, session_hmac, network_hmac, ua_hmac,
       uid_hmac, output_hash, page_category, key_version, model_version, optimizer_version, structure_summary,
       activity_claimed_at, declaration_version, declaration_accepted_at, occurred_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22)
     on conflict (event_key) do nothing
     returning id`,
    [
      randomUUID(), input.eventKey ?? null, input.eventType, input.userId ?? null, input.profileId ?? null,
      input.jobId ?? null, input.browserHmac ?? null, input.sessionHmac ?? null, input.networkHmac ?? null,
      input.uaHmac ?? null, input.uidHmac ?? null, input.outputHash ?? null, input.pageCategory ?? null,
      input.keyVersion, BEHAVIOR_RISK_MODEL_VERSION, input.optimizerVersion ?? null,
      input.structureSummary ? JSON.stringify(input.structureSummary) : null, input.activityClaimedAt ?? null,
      input.declarationVersion ?? null, input.declarationAcceptedAt ?? null, occurredAt.toISOString(), expiresAt.toISOString(),
    ],
  )
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
            uid_hmac, output_hash, page_category, key_version, model_version, optimizer_version, structure_summary,
            activity_claimed_at::text, declaration_version, declaration_accepted_at::text,
            occurred_at::text, expires_at::text
       from behavior_risk_events
      where event_type = 'generate' and user_id = $1 and profile_id = $2 and job_id = $3 and expires_at > now()
      order by occurred_at desc limit 1`,
    [userId, profileId, jobId],
  )
  return result.rows[0] ?? null
}

export async function runBehaviorRiskEvaluation(now = new Date()): Promise<{ cases: number; purgedEvents: number }> {
  await ensureDatabaseSchema()
  const client = await getPool().connect()
  let locked = false
  try {
    locked = Boolean((await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [MAINTENANCE_LOCK_KEY])).rows[0]?.locked)
    if (!locked) return { cases: 0, purgedEvents: 0 }

    const eventResult = await client.query<StoredEventRow>(
      `select id, event_type, user_id, profile_id, job_id, browser_hmac, session_hmac, network_hmac, ua_hmac,
              uid_hmac, output_hash, page_category, key_version, model_version, optimizer_version, structure_summary,
              activity_claimed_at::text, declaration_version, declaration_accepted_at::text,
              occurred_at::text, expires_at::text
         from behavior_risk_events where expires_at > $1 order by occurred_at asc`,
      [now.toISOString()],
    )
    const evaluations = evaluateBehaviorRiskEvents(eventResult.rows, now).filter((evaluation) => evaluation.createCase)
    await client.query('begin')
    try {
      for (const evaluation of evaluations) {
        await upsertEvaluation(client, evaluation, eventResult.rows, now)
      }
      const purgedCases = await client.query('delete from behavior_risk_cases where expires_at <= $1', [now.toISOString()])
      const purgedEvents = await client.query('delete from behavior_risk_events where expires_at <= $1', [now.toISOString()])
      await client.query('commit')
      void purgedCases
      return { cases: evaluations.length, purgedEvents: purgedEvents.rowCount ?? 0 }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  } finally {
    if (locked) await client.query('select pg_advisory_unlock($1)', [MAINTENANCE_LOCK_KEY]).catch(() => undefined)
    client.release()
  }
}

export async function listBehaviorRiskCases(options: {
  status?: 'pending' | 'dismissed' | 'actioned' | 'all'
  page?: number
  pageSize?: number
} = {}): Promise<{ cases: Array<Record<string, unknown>>; pagination: { page: number; page_size: number; total: number; total_pages: number } }> {
  await ensureDatabaseSchema()
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25))
  const status = options.status ?? 'pending'
  const where = status === 'all' ? '' : 'where status = $1'
  const values: unknown[] = status === 'all' ? [] : [status]
  const totalResult = await query<{ total: string }>(`select count(*)::text as total from behavior_risk_cases ${where}`, values)
  const total = Number(totalResult.rows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(totalPages, Math.max(1, options.page ?? 1))
  const rows = await query<CaseRow>(
    `select * from behavior_risk_cases ${where} order by last_seen_at desc, id asc limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  )
  const cases = await Promise.all(rows.rows.map((caseRow) => buildAdminCase(caseRow)))
  return { cases, pagination: { page, page_size: pageSize, total, total_pages: totalPages } }
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
          [action.userId, (input.now ?? new Date()).toISOString()],
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
          [action.profileId, action.userId, (input.now ?? new Date()).toISOString()],
        )
        if (updated.rowCount !== 1) throw new BehaviorRiskReviewError('目标档案不存在、归属不符或不可冻结。', 409)
        actionResults.push({ user_id: action.userId, profile_id: action.profileId, action: action.action })
      }
    }

    const now = input.now ?? new Date()
    const status = input.outcome === 'dismiss' ? 'dismissed' : 'actioned'
    await client.query(
      `update behavior_risk_cases
          set status = $2, reviewed_at = $3, reviewed_by = $4, updated_at = $3
        where id = $1`,
      [input.caseId, status, now.toISOString(), input.adminUsername],
    )
    const snapshot = {
      id: caseRow.id,
      score: caseRow.score,
      categories: caseRow.categories_json,
      rules: caseRow.rules_json,
      model_version: caseRow.model_version,
      members: members.rows,
    }
    await client.query(
      `insert into behavior_risk_review_audit
        (id, case_id, admin_username, outcome, note, actions_json, case_snapshot_json, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [randomUUID(), input.caseId, input.adminUsername, input.outcome, note, JSON.stringify(actionResults), JSON.stringify(snapshot), now.toISOString(), caseRow.expires_at],
    )
    return { ok: true, case_id: input.caseId, status, actions: actionResults, reviewed_at: now.toISOString() }
  })
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
  const overlapping = await client.query<{ id: string }>(
    `select distinct c.id from behavior_risk_cases c
       join behavior_risk_case_members m on m.case_id = c.id
      where c.status = 'pending' and m.user_id = any($1::text[])
      order by c.id`,
    [evaluation.userIds],
  )
  let caseId = overlapping.rows[0]?.id ?? randomUUID()
  for (const duplicate of overlapping.rows.slice(1)) {
    await client.query('delete from behavior_risk_cases where id = $1 and status = \'pending\'', [duplicate.id])
  }
  const existing = overlapping.rows.length > 0
  const parameters = [
    caseId, groupKey, evidenceKey, evaluation.score, JSON.stringify(evaluation.categories), JSON.stringify(evaluation.rules),
    BEHAVIOR_RISK_MODEL_VERSION, evaluation.firstSeenAt, evaluation.lastSeenAt, evaluation.expiresAt, now.toISOString(),
  ]
  if (existing) {
    await client.query(
      `update behavior_risk_cases
          set group_key = $2, evidence_key = $3, score = $4, categories_json = $5::jsonb, rules_json = $6::jsonb,
              model_version = $7, first_seen_at = least(first_seen_at, $8), last_seen_at = $9,
              expires_at = $10, updated_at = $11
        where id = $1 and status = 'pending'`,
      parameters,
    )
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

function summarizeMemberEvidence(events: StoredEventRow[]): Record<string, unknown> {
  const counts = Object.fromEntries([...new Set(events.map((event) => event.event_type))].map((type) => [type, events.filter((event) => event.event_type === type).length]))
  const prefix = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value)))].slice(0, 5).map((value) => value.slice(0, 12))
  const operatorFingerprintHashes = events.map((event) => {
    const value = event.structure_summary?.operator_fingerprint_hash
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value : null
  })
  return {
    account_label: `${events[0]?.user_id?.slice(0, 8) ?? 'unknown'}…`,
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

async function buildAdminCase(caseRow: CaseRow): Promise<Record<string, unknown>> {
  const members = await query<{ user_id: string; evidence_json: Record<string, unknown> }>(
    'select user_id, evidence_json from behavior_risk_case_members where case_id = $1 order by user_id',
    [caseRow.id],
  )
  const userIds = members.rows.map((member) => member.user_id)
  const profiles = userIds.length > 0
    ? await query<{ id: string; user_id: string; kind: string; status: string }>(
      `select id, user_id, coalesce(record_json->>'kind', 'cdk') as kind, status
         from user_game_accounts where user_id = any($1::text[]) order by user_id, created_at`,
      [userIds],
    )
    : { rows: [] as Array<{ id: string; user_id: string; kind: string; status: string }> }
  return {
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
    members: members.rows.map((member) => ({
      user_id: member.user_id,
      ...member.evidence_json,
      profiles: profiles.rows.filter((profile) => profile.user_id === member.user_id).map((profile) => ({
        profile_id: profile.id,
        profile_label: `${profile.id.slice(0, 8)}…`,
        kind: profile.kind,
        status: profile.status,
      })),
    })),
  }
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
