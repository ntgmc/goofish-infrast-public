import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const SKIP_DEPLOY = 0
const CONTINUE_DEPLOY = 1
const CHECK_ONLY = process.argv.includes('--check')

const deployRelevantFiles = new Set([
  'index.html',
  'netlify.toml',
  'package.json',
  'package-lock.json',
  'tsconfig.server.json',
  'tsconfig.json',
  'vite.config.ts',
])

const deployRelevantPrefixes = [
  'src/',
  'public/',
  'netlify/',
  'server/',
]

const deployRelevantScripts = new Set([
  'scripts/build-server.mjs',
  'scripts/check-server-routes.mjs',
  'scripts/export-netlify-blobs.mjs',
  'scripts/generate-data.mjs',
  'scripts/import-postgres.mjs',
  'scripts/verify-migrated-data.mjs',
])

const generatedMetadataFiles = new Set([
  'src/lib/build-meta.ts',
  'netlify/functions/data.ts',
])

const baseRef = process.env.CACHED_COMMIT_REF
const headRef = process.env.COMMIT_REF || process.env.HEAD

if (!baseRef || !headRef) {
  continueDeploy('missing CACHED_COMMIT_REF or COMMIT_REF; first deploys and unknown refs should build')
}

const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', baseRef, headRef, '--'], {
  encoding: 'utf8',
})

if (diff.status !== 0) {
  continueDeploy(`could not inspect changed files: ${diff.stderr.trim() || 'git diff failed'}`)
}

const changedFiles = diff.stdout
  .split(/\r?\n/)
  .map((file) => file.trim().replace(/\\/g, '/'))
  .filter(Boolean)

if (changedFiles.length === 0) {
  skipDeploy('no changed files since last deploy')
}

if (!CHECK_ONLY && process.env.CONTEXT === 'deploy-preview') {
  continueDeploy(`deploy preview builds are always enabled: ${changedFiles.join(', ')}`)
}

if (!CHECK_ONLY) {
  const currentCommitFiles = readCurrentCommitFiles(headRef)

  if (currentCommitFiles && isGeneratedMetadataCommit(currentCommitFiles)) {
    continueDeploy(`generated build metadata changed: ${currentCommitFiles.join(', ')}`)
  }

  skipDeploy(`waiting for CI generated metadata commit: ${(currentCommitFiles || changedFiles).join(', ')}`)
}

const deployRelevant = changedFiles.filter(isDeployRelevant)

if (deployRelevant.length === 0) {
  skipDeploy(`only documentation or repository metadata changed: ${changedFiles.join(', ')}`)
}

continueDeploy(`deploy-relevant changes detected: ${deployRelevant.join(', ')}`)

function isDeployRelevant(file) {
  if (deployRelevantFiles.has(file)) return true
  if (deployRelevantScripts.has(file)) return true
  return deployRelevantPrefixes.some((prefix) => file.startsWith(prefix))
}

function isGeneratedMetadataCommit(files) {
  return files.length > 0 && files.every((file) => generatedMetadataFiles.has(file))
}

function readCurrentCommitFiles(headRef) {
  const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${headRef}^`, headRef, '--'], {
    encoding: 'utf8',
  })

  if (diff.status !== 0) return null

  return diff.stdout
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, '/'))
    .filter(Boolean)
}

function skipDeploy(reason) {
  console.log(`[netlify-ignore-build] Skipping deploy: ${reason}`)
  writeGithubOutput(false, reason)
  if (CHECK_ONLY) process.exit(0)
  process.exit(SKIP_DEPLOY)
}

function continueDeploy(reason) {
  console.log(`[netlify-ignore-build] Continuing deploy: ${reason}`)
  writeGithubOutput(true, reason)
  if (CHECK_ONLY) process.exit(0)
  process.exit(CONTINUE_DEPLOY)
}

function writeGithubOutput(deployRequired, reason) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  const escapedReason = reason.replace(/\r?\n/g, ' ')
  const lines = [
    `deploy_required=${deployRequired ? 'true' : 'false'}`,
    `reason=${escapedReason}`,
  ].join('\n') + '\n'
  appendFileSync(outputPath, lines, 'utf8')
}
