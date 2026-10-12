import type { UserGameAccountRecord } from '../storage/user-store'

export function isLifetimeVoucherUpgradeableProfile(
  profile: Pick<UserGameAccountRecord, 'kind' | 'status' | 'archived_at'>,
): boolean {
  return profile.status === 'active' && !profile.archived_at
    && (profile.kind === 'free_preview' || profile.kind === 'metered_personal')
}
