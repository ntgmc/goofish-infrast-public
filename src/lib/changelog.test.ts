import { describe, expect, it } from 'vitest'
import { CHANGELOG_RELEASES, selectPublicChangelogReleases, sortChangelogReleases } from './changelog'

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
      'workspace-experience',
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

  it('keeps baseline and no-public-change releases so their empty states remain reachable', () => {
    const releases = selectPublicChangelogReleases([
      {
        id: 'v2.0.101',
        version: '2.0.101',
        displayVersion: 'v2.0.101',
        releasedAt: '2026-07-24',
        kind: 'release',
        sections: [],
      },
      {
        id: 'v2.0.102',
        version: '2.0.102',
        displayVersion: 'v2.0.102',
        releasedAt: '2026-07-24',
        kind: 'release',
        sections: [{ id: 'fix', kind: 'fix', items: ['修复用户端排班显示问题'] }],
      },
    ])

    expect(releases.map(({ id }) => id)).toEqual(['v2.0.102', 'v2.0.101'])
  })

  it('rejects conflicting duplicate ids or versions instead of silently shadowing them', () => {
    const original = {
      id: 'v2.0.103',
      version: '2.0.103',
      displayVersion: 'v2.0.103',
      releasedAt: '2026-07-25',
      kind: 'release' as const,
      sections: [],
    }
    expect(() => sortChangelogReleases([
      original,
      { ...original, displayVersion: 'modified' },
    ])).toThrow(/Conflicting changelog release id/)
    expect(() => sortChangelogReleases([
      original,
      { ...original, id: 'release-103-copy' },
    ])).toThrow(/Conflicting changelog release version/)
  })
})
