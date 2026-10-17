export const SKLAND_FRESH_MS = 15 * 60_000
export const SKLAND_MAX_AGE_MS = 24 * 60 * 60_000

export type SklandResource = 'game' | 'inventory'
export type SklandResourceState = 'fresh' | 'stale' | 'expired' | 'unavailable'
type SklandResourceStatus = { fetchedAt: string | null; state: SklandResourceState; error: string | null }
export type SklandSnapshot = {
  uid: string
  version: string
  game: SklandResourceStatus
  inventory: SklandResourceStatus & { items: Record<string, number> | null; lmd: number | null; exp: number | null }
  retryAt: string | null
}

export function sklandResourceState(fetchedAt: string | null, now = Date.now()): SklandResourceState {
  if (!fetchedAt || !Number.isFinite(Date.parse(fetchedAt))) return 'unavailable'
  const age = now - Date.parse(fetchedAt)
  return age < SKLAND_FRESH_MS ? 'fresh' : age < SKLAND_MAX_AGE_MS ? 'stale' : 'expired'
}
