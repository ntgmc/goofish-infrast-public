import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createChangelogEnvelope,
  createReleaseRecord,
  mergeChangelogReleases,
  normalizeSha,
  normalizeVersion,
  parseGitLog,
  renderGeneratedModule,
  renderReleaseNotes,
  selectPublicChanges,
  selectRepositoryChanges,
  validateChangelogEnvelope,
} from './changelog-lib.mjs'
import { collectPrChangelogChanges, findTrustedPrChangelogPayload } from './pr-changelog-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildMetaPath = resolve(root, 'src/lib/.generated/build-meta.ts')
const generatedModulePath = resolve(root, 'src/lib/.generated/changelog.ts')
const releaseRecordPath = resolve(root, 'changelog-release.json')
const releaseNotesPath = resolve(root, 'changelog-release.md')
const candidate = isEnabled(process.env.GENERATE_CHANGELOG_CANDIDATE)

const buildMeta = readObjectLiteral(await readFile(buildMetaPath, 'utf8'), 'APP_BUILD_META')
const releaseVersion = candidate ? resolveReleaseVersion(buildMeta) : null
const targetSha = candidate ? normalizeSha(buildMeta.git_sha) : null
const history = await loadReleaseHistory()
const previousRelease = candidate ? findPreviousRelease(history, targetSha, releaseVersion) : null
const previousTargetSha = candidate ? resolvePreviousTargetSha(previousRelease) : null
const commits = candidate && previousTargetSha ? readCommits(previousTargetSha, targetSha) : []
const changeSets = candidate && previousTargetSha
  ? await resolveChangelogChanges(commits)
  : { publicChanges: [], repositoryChanges: [] }
const release = candidate
  ? createReleaseRecord({
    version: releaseVersion,
    targetSha,
    previousTargetSha,
    releasedAt: buildMeta.generated_at,
    changes: changeSets.publicChanges,
    repositoryChanges: changeSets.repositoryChanges,
  })
  : null
const envelope = createChangelogEnvelope(candidate, release)
const releases = mergeChangelogReleases(history, release)

await writeFileIfChanged(generatedModulePath, renderGeneratedModule(releases))
await writeFileIfChanged(releaseRecordPath, `${JSON.stringify(envelope, null, 2)}\n`)
await writeFileIfChanged(releaseNotesPath, renderReleaseNotes(envelope))

console.log(candidate
  ? `[generate-changelog] prepared ${release.id} from ${previousTargetSha ?? 'bootstrap'} to ${targetSha}`
  : '[generate-changelog] wrote local non-candidate changelog metadata')

async function loadReleaseHistory() {
  const historyFile = process.env.CHANGELOG_HISTORY_FILE
  if (historyFile) return readHistoryFile(resolve(root, historyFile))
  if (!candidate) return []

  const repository = String(process.env.GITHUB_REPOSITORY ?? '').trim()
  const token = String(process.env.GITHUB_TOKEN ?? '').trim()
  if (!repository || !token) throw new Error('production changelog generation requires GITHUB_REPOSITORY and GITHUB_TOKEN')

  const apiUrl = String(process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '')
  const releases = []
  for (let page = 1; page <= 100; page += 1) {
    const batch = await requestJson(`${apiUrl}/repos/${repository}/releases?per_page=100&page=${page}`, token)
    if (!Array.isArray(batch)) throw new Error('GitHub releases API returned an unexpected payload')
    releases.push(...batch)
    if (batch.length < 100) break
  }

  const history = []
  for (const release of releases) {
    if (release.draft || release.prerelease || !release.published_at) continue

    const asset = Array.isArray(release.assets) ? release.assets.find((item) => item?.name === 'changelog-release.json') : null
    if (!asset?.url) continue
    const envelope = validateChangelogEnvelope(await requestJson(asset.url, token, 'application/octet-stream'))
    if (envelope.candidate) history.push(envelope.release)
  }
  return mergeChangelogReleases(history)
}

async function readHistoryFile(filePath) {
  const raw = JSON.parse(await readFile(filePath, 'utf8'))
  const releases = Array.isArray(raw) ? raw : raw.releases
  if (!Array.isArray(releases)) throw new Error('CHANGELOG_HISTORY_FILE must contain an array or a releases array')
  return mergeChangelogReleases(releases)
}

function findPreviousRelease(history, currentTargetSha, currentVersion) {
  return history.find((release) => release.targetSha !== currentTargetSha && release.version !== currentVersion) ?? null
}

function resolvePreviousTargetSha(previousRelease) {
  if (previousRelease) return previousRelease.targetSha

  const configuredBase = String(process.env.CHANGELOG_BASE_SHA ?? '').trim()
  if (configuredBase) return normalizeSha(configuredBase)
  return null
}

function readCommits(fromSha, toSha) {
  if (fromSha === toSha) throw new Error('the changelog range must use distinct previous and target SHAs')
  try {
    runGit(['merge-base', '--is-ancestor', fromSha, toSha])
  } catch {
    throw new Error(`the previous changelog SHA ${fromSha} is not an ancestor of ${toSha}`)
  }

  const output = runGit(['log', `${fromSha}..${toSha}`, '--format=%H%x1f%s%x1f%b%x1e'])
  return parseGitLog(output)
}

async function resolveChangelogChanges(commits) {
  const repository = String(process.env.GITHUB_REPOSITORY ?? '').trim()
  const token = String(process.env.GITHUB_TOKEN ?? '').trim()
  if (!repository || !token) throw new Error('production PR changelog generation requires GITHUB_REPOSITORY and GITHUB_TOKEN')

  const apiUrl = String(process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '')
  const changelogBotLogin = String(process.env.CHANGELOG_BOT_LOGIN ?? 'github-actions[bot]').trim()
  if (!changelogBotLogin) throw new Error('CHANGELOG_BOT_LOGIN must not be empty')
  const pullRequestsByNumber = new Map()

  for (const commit of commits) {
    const pullRequests = await requestJson(
      `${apiUrl}/repos/${repository}/commits/${encodeURIComponent(commit.sha)}/pulls?per_page=100`,
      token,
    )
    if (!Array.isArray(pullRequests)) throw new Error('GitHub associated pull requests API returned an unexpected payload')

    for (const pullRequest of pullRequests) {
      if (!pullRequest?.number || !pullRequest.merged_at || pullRequest.base?.ref !== 'main') continue
      const entry = pullRequestsByNumber.get(pullRequest.number) ?? { commitShas: new Set() }
      entry.commitShas.add(commit.sha)
      pullRequestsByNumber.set(pullRequest.number, entry)
    }
  }

  const recordedPublicChanges = []
  const recordedRepositoryChanges = []
  const handledCommitShas = new Set()
  for (const [pullRequestNumber, entry] of pullRequestsByNumber) {
    const pullRequest = await requestJson(`${apiUrl}/repos/${repository}/pulls/${pullRequestNumber}`, token)
    const comments = await readIssueComments(apiUrl, repository, pullRequestNumber, token)
    const payload = findTrustedPrChangelogPayload(comments, changelogBotLogin)
    if (!payload) continue
    if (payload.pull_request !== pullRequestNumber) {
      throw new Error(`PR #${pullRequestNumber} changelog payload references PR #${payload.pull_request}`)
    }
    if (payload.head_sha !== String(pullRequest.head?.sha ?? '').toLowerCase()) {
      throw new Error(`PR #${pullRequestNumber} changelog payload is stale for the merged head SHA`)
    }

    const payloadChanges = collectPrChangelogChanges(payload)
    recordedPublicChanges.push(...payloadChanges.publicChanges)
    recordedRepositoryChanges.push(...payloadChanges.repositoryChanges)
    for (const sha of entry.commitShas) handledCommitShas.add(sha)
    console.log(`[generate-changelog] using recorded Chinese PR summary for #${pullRequestNumber}`)
  }

  const fallbackCommits = commits.filter((commit) => !handledCommitShas.has(commit.sha))
  return {
    publicChanges: [...recordedPublicChanges, ...selectPublicChanges(fallbackCommits)],
    repositoryChanges: [...recordedRepositoryChanges, ...selectRepositoryChanges(fallbackCommits)],
  }
}

async function readIssueComments(apiUrl, repository, pullRequestNumber, token) {
  const comments = []
  for (let page = 1; page <= 100; page += 1) {
    const batch = await requestJson(
      `${apiUrl}/repos/${repository}/issues/${pullRequestNumber}/comments?per_page=100&page=${page}`,
      token,
    )
    if (!Array.isArray(batch)) throw new Error('GitHub issue comments API returned an unexpected payload')
    comments.push(...batch)
    if (batch.length < 100) break
  }
  return comments
}

function resolveReleaseVersion(meta) {
  const frontendVersion = normalizeVersion(meta.frontend_version)
  const backendVersion = normalizeVersion(meta.backend_version)
  if (frontendVersion !== backendVersion) {
    throw new Error(`automatic changelog releases require matching frontend/backend versions; received ${frontendVersion} and ${backendVersion}`)
  }
  return frontendVersion
}

function runGit(argumentsList) {
  return execFileSync('git', argumentsList, { cwd: root, encoding: 'utf8' })
}

async function requestJson(url, token, accept = 'application/vnd.github+json') {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`GitHub changelog history request failed: ${response.status} ${response.statusText}`)
  return response.json()
}

async function writeFileIfChanged(filePath, content) {
  try {
    if (await readFile(filePath, 'utf8') === content) return
  } catch {
    // Generate the first local artifact when no file exists yet.
  }

  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}`
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

function readObjectLiteral(source, name) {
  const expression = new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\}) as const;`).exec(source)?.[1]
  if (!expression) throw new Error(`could not read ${name} from generated build metadata`)
  return JSON.parse(expression)
}

function isEnabled(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase())
}
