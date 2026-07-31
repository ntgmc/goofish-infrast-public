import { describe, expect, it } from 'vitest'
import type { UserGameAccountRecord } from '../storage/user-store'
import { selectAuthPayloadProfiles } from './auth-payload-profiles'

describe('auth payload profile selection', () => {
  const personal = profile('personal', 'metered_personal')
  const commercialA = profile('commercial-a', 'metered_commercial')
  const commercialB = profile('commercial-b', 'metered_commercial')
  const records = [personal, commercialA, commercialB]

  it('keeps commercial profiles out of the standard profile collection', () => {
    const selected = selectAuthPayloadProfiles(records)

    expect(selected.records.map((item) => item.id)).toEqual(['personal'])
    expect(selected.activeProfileRecord?.id).toBe('personal')
    expect(selected.workspaceProfileIds).toEqual(['personal'])
  })

  it('loads only the explicitly selected commercial profile as the active profile', () => {
    const selected = selectAuthPayloadProfiles(records, 'commercial-b')

    expect(selected.records.map((item) => item.id)).toEqual(['personal'])
    expect(selected.activeProfileRecord?.id).toBe('commercial-b')
    expect(selected.workspaceProfileIds).toEqual(['personal', 'commercial-b'])
    expect(selected.workspaceProfileIds).not.toContain('commercial-a')
  })

  it('falls back to the default profile when the requested id is not owned', () => {
    const selected = selectAuthPayloadProfiles(records, 'missing')

    expect(selected.activeProfileRecord?.id).toBe('personal')
    expect(selected.workspaceProfileIds).toEqual(['personal'])
  })
})

function profile(id: string, kind: UserGameAccountRecord['kind']): UserGameAccountRecord {
  return { id, kind } as UserGameAccountRecord
}
