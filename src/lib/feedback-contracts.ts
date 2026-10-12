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
export type AdminFeedback = {
  id: string
  user_id: string
  email: string
  category: FeedbackCategory
  message: string
  has_image: boolean
  created_at: string
}
export type AdminFeedbackPage = {
  items: AdminFeedback[]
  pagination: { page: number; page_size: number; total: number; total_pages: number }
}
