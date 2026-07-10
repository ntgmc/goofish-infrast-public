import { ApiError, apiJson, apiVoid, type ApiRequestInit } from './api-client'

export const ADMIN_SESSION_EXPIRED_EVENT = 'goofish:admin-session-expired'

export async function adminApiJson<T>(url: string, init: ApiRequestInit = {}): Promise<T> {
  try {
    return await apiJson<T>(url, init)
  } catch (error) {
    notifyIfSessionExpired(error)
    throw error
  }
}

export async function adminApiVoid(url: string, init: ApiRequestInit = {}): Promise<void> {
  try {
    await apiVoid(url, init)
  } catch (error) {
    notifyIfSessionExpired(error)
    throw error
  }
}

export function clearLegacyAdminCredentials(): void {
  try {
    window.sessionStorage.removeItem(['maa', 'admin', 'credentials'].join('-'))
  } catch {
    // Storage may be unavailable; no credentials are written by the current client.
  }
}

function notifyIfSessionExpired(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT))
  }
}
