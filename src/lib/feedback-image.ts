import { copy } from '../copy'
import {
  FEEDBACK_IMAGE_MAX_BYTES,
  FEEDBACK_IMAGE_TYPES,
  FEEDBACK_SOURCE_IMAGE_MAX_BYTES,
  type FeedbackRequest,
} from './feedback-contracts'

export async function prepareFeedbackImage(file: File): Promise<{ image: NonNullable<FeedbackRequest['image']>; bytes: number; compressed: boolean }> {
  const text = copy.feedback
  if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type) || file.size === 0) throw new Error(text.invalidImage)
  if (file.size > FEEDBACK_SOURCE_IMAGE_MAX_BYTES) throw new Error(text.sourceTooLarge)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) }
  catch { throw new Error(text.invalidImage) }
  let blob: Blob = file
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error(text.imageDimensionsTooLarge)
    if (file.size > FEEDBACK_IMAGE_MAX_BYTES) {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) throw new Error(text.imageProcessingFailed)
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
      for (let attempt = 0; attempt < 6; attempt++) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale * 0.75 ** attempt))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale * 0.75 ** attempt))
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          (encoded) => encoded ? resolve(encoded) : reject(new Error(text.imageProcessingFailed)), 'image/jpeg', 0.85,
        ))
        if (blob.size <= FEEDBACK_IMAGE_MAX_BYTES) break
      }
    }
  } finally { bitmap.close() }
  if (blob.size > FEEDBACK_IMAGE_MAX_BYTES) throw new Error(text.imageTooLarge)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(text.imageProcessingFailed))
    reader.onerror = () => reject(new Error(text.imageProcessingFailed))
    reader.readAsDataURL(blob)
  })
  return {
    image: { type: blob.type as NonNullable<FeedbackRequest['image']>['type'], base64: dataUrl.slice(dataUrl.indexOf(',') + 1) },
    bytes: blob.size,
    compressed: blob !== file,
  }
}
