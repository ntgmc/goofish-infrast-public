import { createHash } from 'node:crypto'
import type { ImageUpload } from '../../src/lib/image-upload'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'

export async function savePublicContentImage(type: ImageUpload['type'], bytes: Buffer): Promise<string> {
  await ensureDatabaseSchema()
  const id = createHash('sha256').update(bytes).digest('hex')
  await query('insert into public_content_images (id, image_type, image_data) values ($1, $2, $3) on conflict (id) do nothing', [id, type, bytes])
  return id
}

export async function getPublicContentImage(id: string): Promise<{ image_type: ImageUpload['type']; image_data: Buffer } | null> {
  await ensureDatabaseSchema()
  const result = await query<{ image_type: ImageUpload['type']; image_data: Buffer }>('select image_type, image_data from public_content_images where id = $1', [id])
  return result.rows[0] ?? null
}
