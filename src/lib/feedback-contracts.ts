import { z } from 'zod'

export const FEEDBACK_CATEGORIES = ['account', 'schedule', 'import', 'payment', 'suggestion', 'other'] as const
export const FEEDBACK_IMAGE_MAX_BYTES = 1024 * 1024
export const FEEDBACK_SOURCE_IMAGE_MAX_BYTES = 20 * 1024 * 1024
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000
export const FEEDBACK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const feedbackRequestSchema = z.strictObject({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX_LENGTH),
  image: z.strictObject({
    type: z.enum(FEEDBACK_IMAGE_TYPES),
    base64: z.string().min(4).max(4 * Math.ceil(FEEDBACK_IMAGE_MAX_BYTES / 3)).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }).optional(),
})

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>
export type FeedbackCategory = FeedbackRequest['category']
export const FEEDBACK_STATUSES = ['open', 'processing', 'waiting_user', 'resolved', 'closed'] as const
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number]
const followUpMessage = z.string().trim().max(FEEDBACK_MESSAGE_MAX_LENGTH)
const mutationFields = {
  feedback_id: z.uuid(),
  expected_revision: z.number().int().nonnegative(),
  request_key: z.uuid(),
}
export const feedbackReplySchema = z.strictObject({ ...mutationFields, message: followUpMessage.min(1) })
export const adminFeedbackUpdateSchema = z.strictObject({
  ...mutationFields,
  status: z.enum(FEEDBACK_STATUSES),
  message: followUpMessage,
  internal_note: followUpMessage,
  assignment: z.enum(['keep', 'mine', 'unassigned']),
  reason: z.string().trim().min(2).max(500),
})
export type FeedbackReply = z.infer<typeof feedbackReplySchema>
export type AdminFeedbackUpdate = z.infer<typeof adminFeedbackUpdateSchema>
export type Feedback = {
  id: string
  category: FeedbackCategory
  message: string
  has_image: boolean
  status: FeedbackStatus
  result: string | null
  revision: number
  created_at: string
  updated_at: string
}
export type AdminFeedback = Feedback & { user_id: string; email: string; assignee: string | null }
export type FeedbackEntry = {
  revision: number
  actor: 'user' | 'admin'
  message: string | null
  previous_status: FeedbackStatus
  status: FeedbackStatus
  created_at: string
  actor_username?: string
  internal_note?: string | null
  previous_assignee?: string | null
  assignee?: string | null
}
export type FeedbackDetail = {
  feedback: Feedback | AdminFeedback
  entries: FeedbackEntry[]
  next_before_revision: number | null
}
export type FeedbackPage = {
  items: Feedback[]
  pagination: { page: number; page_size: number; total: number; total_pages: number }
}
export type AdminFeedbackPage = {
  items: AdminFeedback[]
  pagination: { page: number; page_size: number; total: number; total_pages: number }
}
