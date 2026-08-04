import { z } from 'zod'
import type { AppBuildMeta } from './types'

const boundedString = (maximum: number) => z.string().min(1).max(maximum)

export const appBuildMetaSchema: z.ZodType<AppBuildMeta> = z.strictObject({
  frontend_version: boundedString(128),
  backend_version: boundedString(128),
  expected_backend_version: boundedString(128).optional(),
  data_version: boundedString(128),
  source_mode: z.enum(['public_fallback', 'full']).optional(),
  source_schema_version: z.number().int().nonnegative().optional(),
  data_content_sha256: boundedString(128).optional(),
  data_source_updated_at: boundedString(128).optional(),
  build_generated_at: boundedString(128).optional(),
  generated_at: boundedString(128),
  source_summary: z.string().max(2_000),
  git_sha: z.string().max(128).nullable().optional(),
  build_context: z.string().max(256).optional(),
})
