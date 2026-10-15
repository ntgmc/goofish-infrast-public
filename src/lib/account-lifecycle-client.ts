import { copy } from '../copy/index'
import { ApiError, getApiErrorCode, getApiRetryAfterSeconds } from './api-client'

export function accountLifecycleErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback
  const code = getApiErrorCode(error)
  if (error.status === 401 || code === 'authentication_required') return copy.features.account_error_authentication
  if (error.status === 409) return copy.features.account_error_conflict
  if (error.status === 429) {
    const retryAfter = getApiRetryAfterSeconds(error)
    return retryAfter
      ? `${copy.features.account_error_rate_limited_before}${retryAfter}${copy.features.account_error_rate_limited_after}`
      : copy.features.account_error_rate_limited
  }
  if (error.status === 503 || code === 'account_data_unavailable') return copy.features.account_error_unavailable
  return error.message || fallback
}

export function formatAccountDeletionDeadline(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'long' }).format(timestamp)
}
