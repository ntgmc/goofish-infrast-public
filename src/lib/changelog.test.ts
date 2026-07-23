import { describe, expect, it } from 'vitest'
import { CHANGELOG_RELEASES, sortChangelogReleases } from './changelog'

describe('changelog releases', () => {
  it('keeps release identities unique and ordered from newest to oldest', () => {
    const ids = CHANGELOG_RELEASES.map(({ id }) => id)
    const dates = CHANGELOG_RELEASES.map(({ releasedAt }) => releasedAt)

    expect(new Set(ids).size).toBe(ids.length)
    expect(dates).toEqual([...dates].sort((left, right) => right.localeCompare(left)))
  })

  it('keeps the confirmed manually curated release alongside generated releases', () => {
    const [release] = CHANGELOG_RELEASES

    expect(release).toMatchObject({
      releasedAt: '2026-07-23',
      displayVersion: '前端 v2.0.435 · 后端 v2.0.435',
      kind: 'release',
    })
    expect(release.sections.map(({ id }) => id)).toEqual([
      'optimizer-reliability',
      'account-and-personal-use',
      'workspace-and-admin',
    ])
  })

  it('orders automatic build labels numerically when releases share a date', () => {
    const releases = sortChangelogReleases([
      {
        id: 'v2.0.99',
        version: '2.0.99',
        displayVersion: 'v2.0.99',
        releasedAt: '2026-07-23',
        kind: 'release',
        sections: [],
      },
      {
        id: 'v2.0.100',
        version: '2.0.100',
        displayVersion: 'v2.0.100',
        releasedAt: '2026-07-23',
        kind: 'release',
        sections: [],
      },
    ])

    expect(releases.map(({ version }) => version)).toEqual(['2.0.100', '2.0.99'])
  })
})
