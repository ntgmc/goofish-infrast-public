import { copy } from '../copy/index'
import { GENERATED_CHANGELOG_RELEASES } from './.generated/changelog'
import type { ChangelogRelease } from './changelog-contract'

export type { ChangelogRelease, ChangelogSection } from './changelog-contract'

const MANUAL_CHANGELOG_RELEASES = [
  {
    id: '2026-07-23-frontend-2.0.435-backend-2.0.435',
    version: null,
    displayVersion: `${copy.public.pages_ChangelogPage_004}2.0.435 · ${copy.public.pages_ChangelogPage_005}2.0.435`,
    releasedAt: '2026-07-23',
    kind: 'release',
    sections: [
      {
        id: 'optimizer-reliability',
        kind: 'custom',
        title: copy.public.pages_ChangelogPage_007,
        items: [
          copy.public.pages_ChangelogPage_008,
          copy.public.pages_ChangelogPage_009,
          copy.public.pages_ChangelogPage_010,
        ],
      },
      {
        id: 'account-and-personal-use',
        kind: 'custom',
        title: copy.public.pages_ChangelogPage_011,
        items: [
          copy.public.pages_ChangelogPage_012,
          copy.public.pages_ChangelogPage_013,
          copy.public.pages_ChangelogPage_014,
        ],
      },
      {
        id: 'workspace-experience',
        kind: 'custom',
        title: copy.public.pages_ChangelogPage_015,
        items: [
          copy.public.pages_ChangelogPage_016,
        ],
      },
    ],
  },
] as const satisfies readonly ChangelogRelease[]

export const CHANGELOG_RELEASES = selectPublicChangelogReleases([
  ...GENERATED_CHANGELOG_RELEASES,
  ...MANUAL_CHANGELOG_RELEASES,
])

export function selectPublicChangelogReleases(releases: readonly ChangelogRelease[]): readonly ChangelogRelease[] {
  return sortChangelogReleases(releases)
}

export function sortChangelogReleases(releases: readonly ChangelogRelease[]): readonly ChangelogRelease[] {
  const byId = new Map<string, ChangelogRelease>()
  const byVersion = new Map<string, ChangelogRelease>()
  for (const release of releases) {
    const sameId = byId.get(release.id)
    if (sameId && !isSameRelease(sameId, release)) {
      throw new Error(`Conflicting changelog release id: ${release.id}`)
    }
    if (!sameId) byId.set(release.id, release)

    if (release.version) {
      const sameVersion = byVersion.get(release.version)
      if (sameVersion && !isSameRelease(sameVersion, release)) {
        throw new Error(`Conflicting changelog release version: ${release.version}`)
      }
      if (!sameVersion) byVersion.set(release.version, release)
    }
  }

  return [...byId.values()].sort(compareChangelogReleaseOrder)
}

function isSameRelease(left: ChangelogRelease, right: ChangelogRelease): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function compareChangelogReleaseOrder(left: ChangelogRelease, right: ChangelogRelease): number {
  const dateOrder = right.releasedAt.localeCompare(left.releasedAt)
  if (dateOrder !== 0) return dateOrder

  const versionOrder = compareReleaseVersions(left.version, right.version)
  return versionOrder !== 0 ? versionOrder : right.id.localeCompare(left.id)
}

function compareReleaseVersions(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1

  const leftParts = left.split(/[+-]/, 1)[0].split('.').map(Number)
  const rightParts = right.split(/[+-]/, 1)[0].split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return rightParts[index] - leftParts[index]
  }

  const leftPrerelease = left.includes('-')
  const rightPrerelease = right.includes('-')
  if (leftPrerelease !== rightPrerelease) return leftPrerelease ? 1 : -1
  return right.localeCompare(left)
}
