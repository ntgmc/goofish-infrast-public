import { randomUUID } from 'node:crypto'
import type { FeedbackRequest, AdminFeedback, AdminFeedbackPage } from '../../src/lib/feedback-contracts'
import { buildAdminPagination } from '../handlers/admin-pagination'
import { ensureDatabaseSchema } from './schema'
import { query } from './postgres'

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

export async function listAdminFeedback(page: number, pageSize: number): Promise<AdminFeedbackPage> {
  await ensureDatabaseSchema()
  const count = await query<{ total: string }>('select count(*)::text as total from user_feedback')
  const pagination = buildAdminPagination(page, pageSize, Number(count.rows[0].total))
  const result = await query<AdminFeedback>(
    `select feedback.id, feedback.user_id, account.email, feedback.category, feedback.message,
            feedback.image_data is not null as has_image, feedback.created_at::text as created_at
       from user_feedback feedback join user_accounts account on account.id = feedback.user_id
      order by feedback.created_at desc, feedback.id desc limit $1 offset $2`,
    [pagination.page_size, (pagination.page - 1) * pagination.page_size],
  )
  return { items: result.rows, pagination }
}

export async function getFeedbackImage(id: string): Promise<{ image_type: string; image_data: Buffer } | null> {
  await ensureDatabaseSchema()
  const result = await query<{ image_type: string; image_data: Buffer }>(
    'select image_type, image_data from user_feedback where id = $1 and image_data is not null', [id],
  )
  return result.rows[0] ?? null
}
