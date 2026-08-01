import { ensureSklandCredentialSecret } from './handlers/skland-client'

const MIN_UID_HASH_SECRET_LENGTH = 32

export class SklandConfigurationError extends Error {
  readonly code = 'skland_service_not_configured'

  constructor() {
    super('森空岛服务配置无效，请联系管理员。')
    this.name = 'SklandConfigurationError'
  }
}

export function ensureSklandServiceConfiguration(): void {
  try {
    ensureSklandCredentialSecret()
    getFreePreviewUidHashSecret()
  } catch (error) {
    if (error instanceof SklandConfigurationError) throw error
    throw new SklandConfigurationError()
  }
}

export function getFreePreviewUidHashSecret(): string {
  const secret = process.env.FREE_PREVIEW_UID_HASH_SECRET?.trim()
  if (!secret || secret.length < MIN_UID_HASH_SECRET_LENGTH) {
    throw new SklandConfigurationError()
  }
  return secret
}
