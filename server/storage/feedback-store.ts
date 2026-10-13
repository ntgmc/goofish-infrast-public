import { createHash, randomUUID } from 'node:crypto'
import type { FeedbackRequest, Feedback, FeedbackPage, AdminFeedback, AdminFeedbackPage, FeedbackDetail, FeedbackEntry, FeedbackReply, AdminFeedbackUpdate, FeedbackStatus } from '../../src/lib/feedback-contracts'
import { feedbackCopy as text } from '../../src/copy/zh-CN/feedback'
import { buildAdminPagination } from '../handlers/admin-pagination'
import { recordAdminOperationAuditInTransaction, type AdminOperationAuditInput } from './admin-operation-audit-store'
import { upsertFeedbackNotificationInTransaction } from './notification-store'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'

export class FeedbackError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409) {
    super(message)
    this.name = 'FeedbackError'
  }
}

const publicColumns = `feedback.id, feedback.category, feedback.message,
  feedback.image_data is not null as has_image, feedback.status, feedback.result, feedback.revision,
  feedback.created_at::text as created_at, feedback.public_updated_at::text as updated_at`
const adminColumns = `feedback.user_id, account.email, feedback.assignee`

export async function createFeedback(userId: string, input: FeedbackRequest, image: Buffer | null): Promise<string> {
  await ensureDatabaseSchema()
  const id = randomUUID()
  await query(
    `insert into user_feedback (id, user_id, category, message, image_type, image_data)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, userId, input.category, input.message, input.image?.type ?? null, image],
  )
  return id
}

export async function listAdminFeedback(page: number, pageSize: number, status?: FeedbackStatus): Promise<AdminFeedbackPage> {
  return listFeedback(page, pageSize, null, status) as Promise<AdminFeedbackPage>
}
export async function listUserFeedback(userId: string, page: number, pageSize: number): Promise<FeedbackPage> {
  return listFeedback(page, pageSize, userId)
}
async function listFeedback(page: number, pageSize: number, userId: string | null, status?: FeedbackStatus): Promise<FeedbackPage> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await client.query('set transaction isolation level repeatable read read only')
    const where = 'where ($1::text is null or feedback.user_id = $1) and ($2::text is null or feedback.status = $2)'
    const params = [userId, status ?? null]
    const count = await client.query<{ total: string }>(`select count(*)::text as total from user_feedback feedback ${where}`, params)
    const pagination = buildAdminPagination(page, pageSize, Number(count.rows[0]!.total))
    const result = await client.query<Feedback>(
      `select ${publicColumns}${userId ? '' : `, ${adminColumns}, feedback.updated_at::text as updated_at`}
       from user_feedback feedback join user_accounts account on account.id = feedback.user_id ${where}
       order by ${userId ? 'feedback.public_updated_at' : 'feedback.updated_at'} desc, feedback.id desc limit $3 offset $4`,
      [...params, pagination.page_size, (pagination.page - 1) * pagination.page_size],
    )
    return { items: result.rows, pagination }
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
        ${userId ? '' : ', actor_id as actor_username, internal_note, previous_assignee, assignee'}
       from user_feedback_entries where feedback_id = $1 and ($2::integer is null or revision < $2)
        ${userId ? 'and (message is not null or status <> previous_status)' : ''}
       order by revision desc limit 26`, [id, beforeRevision ?? null],
    )
    const recent = entries.rows.slice(0, 25)
    return { feedback, entries: recent.reverse(), next_before_revision: entries.rows.length > 25 ? recent[0]!.revision : null }
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
    if (status !== current.status && ['waiting_user', 'resolved', 'closed'].includes(status) && !message) {
      throw new FeedbackError('public_reply_required', text.publicReplyRequired, 400)
    }
    if (!message && !internalNote && status === current.status && assignee === current.assignee) {
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
       (feedback_id, revision, actor, actor_id, message, internal_note, previous_status, status, previous_assignee, assignee, request_key, request_hash, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [input.feedback_id, revision, actorKind, actorId, message, internalNote, current.status, status, current.assignee, assignee, input.request_key, requestHash, now],
    )
    if (!isUser) {
      await recordAdminOperationAuditInTransaction(client, {
        ...actor.audit,
        before: { status: current.status, assignee: current.assignee, revision: current.revision },
        after: { status, assignee, revision, public_reply: Boolean(message), internal_note: Boolean(internalNote) },
      })
      if (publicChange) await upsertFeedbackNotificationInTransaction(client, { userId: current.user_id, feedbackId: current.id, now })
    }
  })
}
