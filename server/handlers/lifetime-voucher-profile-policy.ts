import type { UserGameAccountRecord } from '../storage/user-store'

export function isLifetimeVoucherUpgradeableProfile(
  profile: Pick<UserGameAccountRecord, 'kind'>,
): boolean {
  return profile.kind === 'free_preview' || profile.kind === 'metered_personal'
}
