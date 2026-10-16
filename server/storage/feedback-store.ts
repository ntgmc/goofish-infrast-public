import { createHash, randomUUID } from 'node:crypto'
import type { FeedbackRequest, Feedback, FeedbackPage, AdminFeedback, AdminFeedbackPage, FeedbackDetail, FeedbackEntry, FeedbackReply, AdminFeedbackUpdate, FeedbackStatus, AdminFeedbackFilters, FeedbackOperation } from '../../src/lib/feedback-contracts'
import { feedbackCopy as text } from '../../src/copy/zh-CN/feedback'
import { buildAdminPagination } from '../handlers/admin-pagination'
import { recordAdminOperationAuditInTransaction, type AdminOperationAuditInput } from './admin-operation-audit-store'
import { upsertFeedbackNotificationInTransaction } from './notification-store'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'
import { FEEDBACK_TODO_SQL, FEEDBACK_WAITING_SINCE_SQL } from './feedback-todo-sql'

export class FeedbackError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409) {
    super(message)
    this.name = 'FeedbackError'
  }
}

const publicColumns = `feedback.id, feedback.category, feedback.message, feedback.context_json as context,
  feedback.image_data is not null as has_image, feedback.status, feedback.result, feedback.revision,
  feedback.created_at::text as created_at, feedback.public_updated_at::text as updated_at`
const adminColumns = `feedback.user_id, account.email, feedback.assignee, (${FEEDBACK_WAITING_SINCE_SQL})::text as waiting_since`

const operationColumns = 'id, action, reason, created_at::text as created_at'
const userOperationsSql = `select 'admin' as source, ${operationColumns} from admin_operation_audit
  where ((target_type = 'user' and target_id = $1) or (target_type = 'profile' and target_id in (select id from user_game_accounts where user_id = $1)))
    and action not like '%.view' and action not like '%.export'
  union all select 'inventory' as source, ${operationColumns} from inventory_admin_audit
  where target_type = 'user' and target_id = $1`

export async function createFeedback(userId: string, input: FeedbackRequest, image: Buffer | null): Promise<string> {
  await ensureDatabaseSchema()
  const id = randomUUID()
  await withTransaction(async (client) => {
    const context = { ...input.context }
    if (context.profile_id && !(await client.query('select id from user_game_accounts where id = $1 and user_id = $2 for share', [context.profile_id, userId])).rowCount) {
      throw new FeedbackError('feedback_context_invalid', text.contextInvalid, 400)
    }
    if (context.result_id) {
      const result = await client.query<{ profile_id: string }>(`select result.profile_id from optimization_result_history result
        join user_game_accounts profile on profile.id = result.profile_id where result.id = $1 and profile.user_id = $2
        and ($3::text is null or profile.id = $3) limit 2`, [context.result_id, userId, context.profile_id ?? null])
      if (result.rows.length !== 1) throw new FeedbackError('feedback_context_invalid', text.contextInvalid, 400)
      context.profile_id = result.rows[0]!.profile_id
    }
    if (context.job_id) {
      const job = await client.query<{ profile_id: string }>(`select profile.id as profile_id from optimize_jobs job join user_game_accounts profile
        on profile.id = coalesce(job.profile_id, case when job.owner_key like 'profile:%' then substring(job.owner_key from 9) end)
        where job.id = $1 and profile.user_id = $2 and ($3::text is null or profile.id = $3)`, [context.job_id, userId, context.profile_id ?? null])
      if (!job.rows[0]) throw new FeedbackError('feedback_context_invalid', text.contextInvalid, 400)
      context.profile_id = job.rows[0].profile_id
    }
    await client.query(
      `insert into user_feedback (id, user_id, category, message, image_type, image_data, context_json)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [id, userId, input.category, input.message, input.image?.type ?? null, image, JSON.stringify(context)],
    )
  })
  return id
}

export async function listAdminFeedback(page: number, pageSize: number, status?: FeedbackStatus, todo?: AdminFeedbackFilters['todo'], filters: AdminFeedbackFilters = {}, username = ''): Promise<AdminFeedbackPage> {
  return listFeedback(page, pageSize, null, { ...filters, status, todo }, username) as Promise<AdminFeedbackPage>
}
export async function listUserFeedback(userId: string, page: number, pageSize: number): Promise<FeedbackPage> {
  return listFeedback(page, pageSize, userId)
}
async function listFeedback(page: number, pageSize: number, userId: string | null, filters: AdminFeedbackFilters = {}, username = ''): Promise<FeedbackPage> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await client.query('set transaction isolation level repeatable read read only')
    const { status, todo } = filters
    const where = `where ($1::text is null or feedback.user_id = $1) and ($2::text is null or feedback.status = $2)
      and ($3::text is null or feedback.category = $3) and ($4::text is null or strpos(lower(account.email), lower($4)) > 0)
      and ($5::integer is null or (${FEEDBACK_WAITING_SINCE_SQL}) <= now() - make_interval(hours => $5))
      ${todo === 'mine' ? "and feedback.assignee = $6 and feedback.status in ('open', 'processing')" : todo ? `and (${FEEDBACK_TODO_SQL[todo]})` : ''}`
    const params = [userId ?? filters.user_id ?? null, status ?? null, filters.category ?? null, filters.email || null, filters.min_wait_hours ?? null, ...(todo === 'mine' ? [username] : [])]
    const from = 'from user_feedback feedback join user_accounts account on account.id = feedback.user_id'
    const count = await client.query<{ total: string }>(`select count(*)::text as total ${from} ${where}`, params)
    const pagination = buildAdminPagination(page, pageSize, Number(count.rows[0]!.total))
    const result = await client.query<Feedback>(
      `select ${publicColumns}${userId ? '' : `, ${adminColumns}, feedback.updated_at::text as updated_at`}
       ${from} ${where}
       order by ${userId ? 'feedback.public_updated_at desc' : `(${FEEDBACK_WAITING_SINCE_SQL}) asc nulls last, feedback.updated_at desc`}, feedback.id desc limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pagination.page_size, (pagination.page - 1) * pagination.page_size],
    )
    if (userId) return { items: result.rows, pagination }
    const metrics = await client.query<NonNullable<AdminFeedbackPage['metrics']>>(`select
      avg(extract(epoch from (first_reply.at - feedback.created_at)))::float8 as first_response_seconds,
      max(extract(epoch from (now() - (${FEEDBACK_WAITING_SINCE_SQL}))))::float8 as longest_wait_seconds,
      count(*) filter (where exists (select 1 from user_feedback_entries entry where entry.feedback_id = feedback.id
        and entry.previous_status in ('resolved', 'closed') and entry.status in ('open', 'processing')))::integer as reopened_count
      from user_feedback feedback left join lateral (select min(created_at) as at from user_feedback_entries
        where feedback_id = feedback.id and actor = 'admin' and message is not null) first_reply on true`)
    return { items: result.rows, pagination, metrics: metrics.rows[0] } as AdminFeedbackPage
  })
}

export async function getFeedbackDetail(id: string, userId: string | null, beforeRevision?: number): Promise<FeedbackDetail> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await client.query('set transaction isolation level repeatable read read only')
    const result = await client.query<Feedback>(
      `select ${publicColumns}${userId ? '' : `, ${adminColumns}, feedback.updated_at::text as updated_at`}
       from user_feedback feedback join user_accounts account on account.id = feedback.user_id
       where feedback.id = $1 and ($2::text is null or feedback.user_id = $2)`, [id, userId],
    )
    const feedback = result.rows[0]
    if (!feedback) throw new FeedbackError('feedback_not_found', text.notFound, 404)
    const entries = await client.query<FeedbackEntry>(
      `select revision, actor, message, previous_status, status, created_at::text as created_at
        ${userId ? '' : ', actor_id as actor_username, internal_note, previous_assignee, assignee, related_operation'}
       from user_feedback_entries where feedback_id = $1 and ($2::integer is null or revision < $2)
        ${userId ? 'and (message is not null or status <> previous_status)' : ''}
       order by revision desc limit 26`, [id, beforeRevision ?? null],
    )
    const recent = entries.rows.slice(0, 25)
    const operations = userId ? undefined : await client.query<FeedbackOperation>(`select * from (${userOperationsSql}) operations order by created_at::timestamptz desc, id desc limit 50`, [(feedback as AdminFeedback).user_id])
    return { feedback, entries: recent.reverse(), next_before_revision: entries.rows.length > 25 ? recent[0]!.revision : null,
      ...(operations ? { recent_operations: operations.rows } : {}) }
  })
}

export async function getFeedbackImage(id: string, userId: string | null = null): Promise<{ image_type: string; image_data: Buffer } | null> {
  await ensureDatabaseSchema()
  const result = await query<{ image_type: string; image_data: Buffer }>(
    `select image_type, image_data from user_feedback
     where id = $1 and ($2::text is null or user_id = $2) and image_data is not null`, [id, userId],
  )
  return result.rows[0] ?? null
}

type StoredFeedback = Pick<AdminFeedback, 'id' | 'user_id' | 'status' | 'revision' | 'assignee' | 'result'>
export async function updateFeedback(
  input: FeedbackReply | AdminFeedbackUpdate,
  actor: { userId: string } | { username: string; audit: AdminOperationAuditInput },
): Promise<void> {
  await ensureDatabaseSchema()
  const isUser = 'userId' in actor
  const actorId = isUser ? actor.userId : actor.username
  const actorKind = isUser ? 'user' : 'admin'
  // Refreshing the version must not turn an uncertain retry into a second follow-up.
  const { expected_revision: _expectedRevision, ...intent } = input
  const requestHash = createHash('sha256').update(JSON.stringify(intent)).digest('hex')
  await withTransaction(async (client) => {
    const locked = await client.query<StoredFeedback>(
      'select id, user_id, status, revision, assignee, result from user_feedback where id = $1 and ($2::text is null or user_id = $2) for update',
      [input.feedback_id, isUser ? actor.userId : null],
    )
    const current = locked.rows[0]
    if (!current) throw new FeedbackError('feedback_not_found', text.notFound, 404)
    const replay = await client.query<{ request_hash: string }>(
      'select request_hash from user_feedback_entries where feedback_id = $1 and actor = $2 and actor_id = $3 and request_key = $4',
      [input.feedback_id, actorKind, actorId, input.request_key],
    )
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== requestHash) throw new FeedbackError('feedback_conflict', text.conflict, 409)
      return
    }
    if (current.revision !== input.expected_revision) throw new FeedbackError('feedback_conflict', text.conflict, 409)
    const admin = !isUser ? input as AdminFeedbackUpdate : null
    const status: FeedbackStatus = admin?.status ?? (current.status === 'open' ? 'open' : 'processing')
    const assignee = admin?.assignment === 'mine' ? actorId : admin?.assignment === 'unassigned' ? null : current.assignee
    const message = input.message.trim() || null
    const internalNote = admin?.internal_note.trim() || null
    let operation: FeedbackOperation | null = null
    if (admin?.related_operation) {
      const result = await client.query<FeedbackOperation>(`select * from (${userOperationsSql}) operations where source = $2 and id = $3`, [current.user_id, admin.related_operation.source, admin.related_operation.id])
      operation = result.rows[0] ?? null
      if (!operation) throw new FeedbackError('feedback_operation_invalid', text.operationInvalid, 400)
    }
    if (status !== current.status && ['waiting_user', 'resolved', 'closed'].includes(status) && !message) {
      throw new FeedbackError('public_reply_required', text.publicReplyRequired, 400)
    }
    if (!message && !internalNote && !operation && status === current.status && assignee === current.assignee) {
      throw new FeedbackError('feedback_no_change', text.noChange, 400)
    }
    const publicChange = message !== null || status !== current.status
    const revision = current.revision + 1
    const result = ['resolved', 'closed'].includes(status) ? message ?? current.result : null
    const updated = await client.query<{ updated_at: string }>(
      `update user_feedback set status = $2, assignee = $3, revision = $4, result = $5,
       updated_at = greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', updated_at) + interval '1 millisecond'),
       public_updated_at = case when $6 then greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', public_updated_at) + interval '1 millisecond') else public_updated_at end
       where id = $1 returning updated_at::text as updated_at`,
      [input.feedback_id, status, assignee, revision, result, publicChange],
    )
    const now = updated.rows[0]!.updated_at
    await client.query(
      `insert into user_feedback_entries
       (feedback_id, revision, actor, actor_id, message, internal_note, previous_status, status, previous_assignee, assignee, request_key, request_hash, created_at, related_operation)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
      [input.feedback_id, revision, actorKind, actorId, message, internalNote, current.status, status, current.assignee, assignee, input.request_key, requestHash, now, operation ? JSON.stringify(operation) : null],
    )
    if (!isUser) {
      await recordAdminOperationAuditInTransaction(client, {
        ...actor.audit,
        before: { status: current.status, assignee: current.assignee, revision: current.revision },
        after: { status, assignee, revision, public_reply: Boolean(message), internal_note: Boolean(internalNote), related_operation: admin?.related_operation ?? null },
      })
      if (publicChange) await upsertFeedbackNotificationInTransaction(client, { userId: current.user_id, feedbackId: current.id, now })
    }
  })
}
