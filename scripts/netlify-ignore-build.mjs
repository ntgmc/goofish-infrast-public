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
  'tsconfig.json',
  'vite.config.ts',
])

const deployRelevantPrefixes = [
  'src/',
  'public/',
  'netlify/',
]

const deployRelevantScripts = new Set([
  'scripts/generate-data.mjs',
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
