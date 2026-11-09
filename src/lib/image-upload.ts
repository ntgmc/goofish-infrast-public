import { z } from 'zod'

export const IMAGE_UPLOAD_MAX_BYTES = 1024 * 1024
export const IMAGE_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const imageUploadSchema = z.strictObject({
  type: z.enum(IMAGE_UPLOAD_TYPES),
  base64: z.string().min(4).max(4 * Math.ceil(IMAGE_UPLOAD_MAX_BYTES / 3)).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
})
export type ImageUpload = z.infer<typeof imageUploadSchema>
