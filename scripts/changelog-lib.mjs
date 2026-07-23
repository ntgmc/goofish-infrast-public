const FIELD_SEPARATOR = '\u001f'
const RECORD_SEPARATOR = '\u001e'
const SHA_PATTERN = /^[0-9a-f]{40}$/i
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const CHANGELOG_RELEASE_SCHEMA_VERSION = 1

const SECTION_ORDER = ['feature', 'fix', 'performance', 'security']
const CONVENTIONAL_TYPES = {
  feat: 'feature',
  fix: 'fix',
  perf: 'performance',
  security: 'security',
}

export function parseGitLog(output) {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.split(FIELD_SEPARATOR)
      return { sha: sha.trim(), subject: subject.trim(), body: body.trim() }
    })
}

export function selectPublicChanges(commits) {
  return commits.flatMap((commit) => {
    const releaseNote = readTrailer(commit.body, 'Release-Note')
    const trailerType = normalizeSectionKind(readTrailer(commit.body, 'Release-Note-Type'))
    const conventional = parseConventionalSubject(commit.subject)

    if (isTrueTrailer(commit.body, 'Skip-Changelog')) return []

    const kind = trailerType ?? conventional?.kind ?? (releaseNote ? 'feature' : null)
    const summary = releaseNote ?? conventional?.summary
    if (!kind || !summary) return []

    return [{ kind, summary, sha: normalizeSha(commit.sha) }]
  })
}

export function createReleaseRecord({ version, targetSha, previousTargetSha = null, releasedAt, commits = [] }) {
  const normalizedVersion = normalizeVersion(version)
  const normalizedTargetSha = normalizeSha(targetSha)
  const normalizedPreviousSha = previousTargetSha ? normalizeSha(previousTargetSha) : null
  const normalizedDate = normalizeReleaseDate(releasedAt)
  if (normalizedPreviousSha === normalizedTargetSha) {
    throw new Error('the previous changelog SHA must differ from the release target SHA')
  }
  const kind = normalizedPreviousSha ? 'release' : 'baseline'

  return {
    id: `v${normalizedVersion}`,
    version: normalizedVersion,
    displayVersion: `v${normalizedVersion}`,
    releasedAt: normalizedDate,
    targetSha: normalizedTargetSha,
    previousTargetSha: normalizedPreviousSha,
    kind,
    sections: normalizedPreviousSha ? groupChanges(selectPublicChanges(commits)) : [],
  }
}

export function createChangelogEnvelope(candidate, release) {
  if (candidate && !release) throw new Error('candidate changelog records require a release payload')
  if (!candidate && release) throw new Error('non-candidate changelog records cannot include a release payload')

  return {
    schema_version: CHANGELOG_RELEASE_SCHEMA_VERSION,
    candidate,
    release: release ?? null,
  }
}

export function validateChangelogEnvelope(value) {
  if (!isRecord(value) || value.schema_version !== CHANGELOG_RELEASE_SCHEMA_VERSION || typeof value.candidate !== 'boolean') {
    throw new Error('invalid changelog release envelope')
  }

  if (!value.candidate) {
    if (value.release !== null) throw new Error('non-candidate changelog release envelopes must not include a release')
    return value
  }

  validateReleaseRecord(value.release)
  return value
}

export function mergeChangelogReleases(history, candidateRelease = null) {
  const byId = new Map()

  for (const release of history) {
    validateReleaseRecord(release)
    byId.set(release.id, release)
  }
  if (candidateRelease) {
    validateReleaseRecord(candidateRelease)
    byId.set(candidateRelease.id, candidateRelease)
  }

  return [...byId.values()].sort(compareChangelogReleaseOrder)
}

function compareChangelogReleaseOrder(left, right) {
  const dateOrder = right.releasedAt.localeCompare(left.releasedAt)
  if (dateOrder !== 0) return dateOrder

  const versionOrder = compareReleaseVersions(left.version, right.version)
  return versionOrder !== 0 ? versionOrder : right.id.localeCompare(left.id)
}

export function renderGeneratedModule(releases) {
  return [
    "import type { ChangelogRelease } from '../changelog-contract'",
    '',
    `export const GENERATED_CHANGELOG_RELEASES = ${JSON.stringify(releases, null, 2)} as const satisfies readonly ChangelogRelease[]`,
    '',
  ].join('\n')
}

export function renderReleaseNotes(envelope) {
  validateChangelogEnvelope(envelope)
  if (!envelope.candidate) return '# Changelog candidate unavailable\n\nThis build is not eligible for production changelog publication.\n'

  const release = envelope.release
  const lines = [
    `# v${release.version}`,
    '',
    `- Commit: \`${release.targetSha}\``,
    `- Built: ${release.releasedAt}`,
  ]

  if (release.kind === 'baseline') {
    lines.push('', '## Baseline', '', 'This release establishes the automatic changelog baseline. Future releases list user-visible changes since this commit.')
    return `${lines.join('\n')}\n`
  }

  if (release.sections.length === 0) {
    lines.push('', '## Maintenance', '', 'No user-facing changes were detected from the included commits.')
    return `${lines.join('\n')}\n`
  }

  for (const section of release.sections) {
    lines.push('', `## ${sectionHeading(section.kind)}`, '')
    for (const item of section.items) lines.push(`- ${item}`)
  }

  return `${lines.join('\n')}\n`
}

export function normalizeVersion(value) {
  const version = String(value ?? '').trim()
  if (!VERSION_PATTERN.test(version)) throw new Error(`invalid release version: ${version || '(empty)'}`)
  return version
}

function compareReleaseVersions(left, right) {
  if (left === right) return 0

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

export function normalizeSha(value) {
  const sha = String(value ?? '').trim().toLowerCase()
  if (!SHA_PATTERN.test(sha)) throw new Error(`invalid full commit SHA: ${sha || '(empty)'}`)
  return sha
}

function parseConventionalSubject(subject) {
  const match = String(subject ?? '').trim().match(/^(feat|fix|perf|security)(?:\([^)]*\))?!?:\s*(.+)$/i)
  if (!match) return null

  return {
    kind: CONVENTIONAL_TYPES[match[1].toLowerCase()],
    summary: match[2].trim(),
  }
}

function readTrailer(body, key) {
  const match = String(body ?? '').match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, 'im'))
  return match?.[1]?.trim() || null
}

function isTrueTrailer(body, key) {
  return /^(true|1|yes)$/i.test(readTrailer(body, key) ?? '')
}

function normalizeSectionKind(value) {
  const kind = String(value ?? '').trim().toLowerCase()
  if (!kind) return null
  if (kind === 'feature' || kind === 'feat') return 'feature'
  if (kind === 'fix') return 'fix'
  if (kind === 'performance' || kind === 'perf') return 'performance'
  if (kind === 'security') return 'security'
  return null
}

function groupChanges(changes) {
  const grouped = new Map(SECTION_ORDER.map((kind) => [kind, []]))
  for (const change of changes) {
    const items = grouped.get(change.kind)
    if (items && !items.includes(change.summary)) items.push(change.summary)
  }

  return SECTION_ORDER.flatMap((kind) => {
    const items = grouped.get(kind)
    return items?.length ? [{ id: kind, kind, items }] : []
  })
}

function validateReleaseRecord(value) {
  if (!isRecord(value)) throw new Error('invalid changelog release record')
  if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('changelog release id is required')
  normalizeVersion(value.version)
  if (typeof value.displayVersion !== 'string' || !value.displayVersion.trim()) throw new Error('changelog release displayVersion is required')
  normalizeReleaseDate(value.releasedAt)
  const targetSha = normalizeSha(value.targetSha)
  const previousTargetSha = value.previousTargetSha !== null && value.previousTargetSha !== undefined
    ? normalizeSha(value.previousTargetSha)
    : null
  if (value.kind !== 'baseline' && value.kind !== 'release') throw new Error('invalid changelog release kind')
  if (value.kind === 'baseline' && previousTargetSha) throw new Error('baseline changelog releases cannot have a previous target SHA')
  if (value.kind === 'release' && !previousTargetSha) throw new Error('release changelog records require a previous target SHA')
  if (previousTargetSha === targetSha) throw new Error('the previous changelog SHA must differ from the release target SHA')
  if (!Array.isArray(value.sections)) throw new Error('changelog release sections must be an array')

  for (const section of value.sections) {
    if (!isRecord(section) || !SECTION_ORDER.includes(section.kind) || !Array.isArray(section.items)) {
      throw new Error('invalid changelog release section')
    }
    if (section.items.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error('invalid changelog release section item')
    }
  }
}

function normalizeReleaseDate(value) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) throw new Error(`invalid release date: ${value || '(empty)'}`)
  return date.toISOString().slice(0, 10)
}

function sectionHeading(kind) {
  return {
    feature: 'Features',
    fix: 'Fixes',
    performance: 'Performance',
    security: 'Security',
  }[kind]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
