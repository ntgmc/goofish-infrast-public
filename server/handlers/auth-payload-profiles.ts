import type { UserGameAccountRecord } from '../storage/user-store'

export function selectAuthPayloadProfiles(
  allRecords: UserGameAccountRecord[],
  activeProfileId?: string | null,
): {
  records: UserGameAccountRecord[]
  activeProfileRecord: UserGameAccountRecord | null
  workspaceProfileIds: string[]
} {
  const records = allRecords.filter((profile) => profile.kind !== 'metered_commercial')
  const defaultActiveProfile = records.find((profile) => profile.kind !== 'depot_value') ?? records[0] ?? null
  const requestedActiveProfile = activeProfileId
    ? allRecords.find((profile) => profile.id === activeProfileId) ?? null
    : null
  const activeProfileRecord = requestedActiveProfile ?? defaultActiveProfile
  const workspaceProfileIds = activeProfileRecord?.kind === 'metered_commercial'
    ? [...records.map((profile) => profile.id), activeProfileRecord.id]
    : records.map((profile) => profile.id)
  return { records, activeProfileRecord, workspaceProfileIds }
}
