import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import { isDocumentationOnly } from './build-relevance-lib.mjs'

const SKIP_BUILD = 0
const CONTINUE_BUILD = 1
const CHECK_ONLY = process.argv.includes('--check')

const buildRelevantFiles = new Set([
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.server.json',
  'tsconfig.json',
  'vite.config.ts',
  '.github/workflows/deploy-production.yml',
  '.github/workflows/deploy-dev.yml',
  '.github/workflows/record-pr-changelog.yml',
  'docs/dev-deploy.md',
  'docs/production-deploy.md',
  'docs/worker-deploy.md',
])

const buildRelevantPrefixes = [
  'src/',
  'public/',
  'server/',
  'deploy/nginx/',
  'deploy/systemd/',
  'deploy/wireguard/',
]

const buildRelevantScripts = new Set([
  'scripts/build-server.mjs',
  'scripts/check-api-handlers.mjs',
  'scripts/check-build-relevance.mjs',
  'scripts/check-production-deploy.mjs',
  'scripts/check-worker-link.mjs',
  'scripts/check-depot-profile.mjs',
  'scripts/check-server-routes.mjs',
  'scripts/check-skland-handler.mjs',
  'scripts/check-workspace-history.mjs',
  'scripts/generate-data.mjs',
  'scripts/changelog-lib.mjs',
  'scripts/generate-changelog.mjs',
  'scripts/pr-changelog-lib.mjs',
  'scripts/record-pr-changelog.mjs',
  'scripts/deploy-production-atomic.sh',
  'scripts/deploy-worker-atomic.sh',
  'scripts/deploy-production.sh',
  'scripts/release-artifact.mjs',
  'scripts/import-postgres.mjs',
  'scripts/verify-migrated-data.mjs',
])

const baseRef = process.env.CACHED_COMMIT_REF
const headRef = process.env.COMMIT_REF || process.env.HEAD

if (!baseRef || !headRef) {
  continueBuild('missing CACHED_COMMIT_REF or COMMIT_REF; unknown refs should build')
}

const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', baseRef, headRef, '--'], {
  encoding: 'utf8',
})

if (diff.status !== 0) {
  continueBuild(`could not inspect changed files: ${diff.stderr.trim() || 'git diff failed'}`)
}

const changedFiles = diff.stdout
  .split(/\r?\n/)
  .map((file) => file.trim().replace(/\\/g, '/'))
  .filter(Boolean)

if (changedFiles.length === 0) {
  skipBuild('no changed files since last build')
}

const meaningfulChanges = changedFiles

if (isDocumentationOnly(meaningfulChanges)) {
  skipBuild(`documentation-only changes: ${meaningfulChanges.join(', ')}`, true)
}

const relevant = meaningfulChanges.filter(isBuildRelevant)

if (relevant.length > 0) {
  continueBuild(`build-relevant files changed: ${relevant.join(', ')}`)
}

const fallbackChanges = readFallbackChangedFiles(headRef)
if (fallbackChanges && fallbackChanges.some(isBuildRelevant)) {
  continueBuild(`fallback diff found build-relevant files: ${fallbackChanges.filter(isBuildRelevant).join(', ')}`)
}

skipBuild(`no build-relevant files changed: ${meaningfulChanges.join(', ')}`)

function isBuildRelevant(file) {
  if (buildRelevantFiles.has(file)) return true
  if (buildRelevantScripts.has(file)) return true
  return buildRelevantPrefixes.some((prefix) => file.startsWith(prefix))
}

function readFallbackChangedFiles(headRef) {
  const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${headRef}^`, headRef, '--'], {
    encoding: 'utf8',
  })

  if (diff.status !== 0) return null

  return diff.stdout
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, '/'))
    .filter(Boolean)
}

function skipBuild(reason, documentationOnly = false) {
  console.log(`[check-build-relevance] Skipping build: ${reason}`)
  writeGithubOutput(false, reason, documentationOnly)
  if (CHECK_ONLY) process.exit(0)
  process.exit(SKIP_BUILD)
}

function continueBuild(reason) {
  console.log(`[check-build-relevance] Continuing build: ${reason}`)
  writeGithubOutput(true, reason, false)
  if (CHECK_ONLY) process.exit(0)
  process.exit(CONTINUE_BUILD)
}

function writeGithubOutput(buildRequired, reason, documentationOnly) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  const escapedReason = reason.replace(/\r?\n/g, ' ')
  const lines = [
    `build_required=${buildRequired ? 'true' : 'false'}`,
    `documentation_only=${documentationOnly ? 'true' : 'false'}`,
    `reason=${escapedReason}`,
  ].join('\n') + '\n'
  appendFileSync(outputPath, lines, 'utf8')
}
