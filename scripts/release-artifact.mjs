import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateChangelogEnvelope } from './changelog-lib.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(process.env.RELEASE_ROOT || repositoryRoot)
const [command, ...rawArguments] = process.argv.slice(2)
const argumentsMap = parseArguments(rawArguments)
const REQUIRED_ARTIFACT_PATHS = [
  'dist/index.html',
  'server/dist/all.js',
  'server/dist/index.js',
  'server/dist/migrate.js',
  'server/dist/worker.js',
  'server/dist/optimize-worker.js',
]

if (command === 'create') {
  await createReleaseManifest()
} else if (command === 'decision') {
  await writeDecision(false)
} else if (command === 'verify') {
  await verifyReleaseManifest()
} else {
  throw new Error('Usage: release-artifact.mjs <create|decision|verify> --sha <40-character-sha>')
}

async function createReleaseManifest() {
  const targetSha = requireSha(argumentsMap.sha || process.env.VERSION_SOURCE_SHA || process.env.GITHUB_SHA)
  const buildMeta = readObjectLiteral(await readFile(join(root, 'src/lib/.generated/build-meta.ts'), 'utf8'), 'APP_BUILD_META')
  if (buildMeta.git_sha !== targetSha) throw new Error(`build metadata SHA mismatch: ${buildMeta.git_sha || 'missing'}`)
  const changelog = await readChangelogEnvelope(root, targetSha, buildMeta)

  const files = await collectArtifactHashes(root)
  assertRequiredArtifactEntries(files)
  const manifest = {
    schema_version: 1,
    target_sha: targetSha,
    built_at: buildMeta.generated_at,
    build_context: buildMeta.build_context,
    build_meta: buildMeta,
    github_run_id: argumentsMap['run-id'] || process.env.GITHUB_RUN_ID || 'unknown',
    github_run_url: argumentsMap['run-url'] || process.env.GITHUB_RUN_URL || 'unknown',
    node_version: process.version,
    npm_version: resolveNpmVersion(),
    changelog,
    files,
  }
  await writeJson(join(root, 'build-manifest.json'), manifest)
  await writeDecision(true, targetSha)
}

async function writeDecision(deployable, explicitSha) {
  const targetSha = requireSha(explicitSha || argumentsMap.sha || process.env.GITHUB_SHA)
  await writeJson(join(root, 'deployment-decision.json'), {
    schema_version: 1,
    target_sha: targetSha,
    deployable,
    reason: deployable ? 'build-relevant release artifact' : (argumentsMap.reason || 'no build-relevant changes'),
  })
}

async function verifyReleaseManifest() {
  const targetSha = requireSha(argumentsMap.sha || process.env.TARGET_SHA)
  const manifest = JSON.parse(await readFile(join(root, 'build-manifest.json'), 'utf8'))
  if (manifest.schema_version !== 1) throw new Error('unsupported build manifest schema')
  if (manifest.target_sha !== targetSha) throw new Error(`artifact target SHA mismatch: ${manifest.target_sha || 'missing'}`)
  if (manifest.build_meta?.git_sha !== targetSha) throw new Error('artifact build metadata SHA mismatch')
  const changelog = await readChangelogEnvelope(root, targetSha, manifest.build_meta)
  if (JSON.stringify(manifest.changelog) !== JSON.stringify(changelog)) throw new Error('artifact changelog metadata mismatch')

  const expectedFiles = manifest.files
  if (!expectedFiles || typeof expectedFiles !== 'object') throw new Error('artifact file hashes are missing')
  assertRequiredArtifactEntries(expectedFiles)

  const actualFiles = await collectArtifactHashes(root)
  const expectedPaths = Object.keys(expectedFiles).sort()
  const actualPaths = Object.keys(actualFiles).sort()
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) throw new Error('artifact file list does not match manifest')
  for (const path of expectedPaths) {
    if (actualFiles[path] !== expectedFiles[path]) throw new Error(`artifact hash mismatch: ${path}`)
  }
  process.stdout.write(`Verified release artifact for ${targetSha}\n`)
}

function assertRequiredArtifactEntries(files) {
  for (const required of REQUIRED_ARTIFACT_PATHS) {
    if (!files[required]) throw new Error(`required artifact entry is missing from manifest: ${required}`)
  }
}

async function readChangelogEnvelope(releaseRoot, targetSha, buildMeta) {
  let envelope
  let notes
  try {
    [envelope, notes] = await Promise.all([
      readFile(join(releaseRoot, 'changelog-release.json'), 'utf8').then((source) => JSON.parse(source)),
      readFile(join(releaseRoot, 'changelog-release.md'), 'utf8'),
    ])
  } catch (error) {
    throw new Error(`release changelog metadata is missing or invalid: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!notes.trim().startsWith('#')) throw new Error('release changelog notes must start with a Markdown heading')
  validateChangelogEnvelope(envelope)
  if (!envelope.candidate) return envelope

  const release = envelope.release
  if (release.targetSha !== targetSha) throw new Error('release changelog target SHA mismatch')
  if (release.version !== buildMeta.frontend_version || release.version !== buildMeta.backend_version) {
    throw new Error('release changelog version does not match build metadata')
  }
  return envelope
}

async function collectArtifactHashes(base) {
  const output = {}
  for (const directory of ['dist', 'server/dist']) {
    for (const file of await walk(join(base, directory))) {
      const key = relative(base, file).replace(/\\/g, '/')
      output[key] = createHash('sha256').update(await readFile(file)).digest('hex')
    }
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`artifact contains unsupported filesystem entry: ${path}`)
  }
  return files
}

function readObjectLiteral(content, exportName) {
  const pattern = new RegExp(`export const ${exportName} = (\\{[\\s\\S]*?\\}) as const;`)
  const match = content.match(pattern)
  if (!match) throw new Error(`could not read ${exportName}`)
  return JSON.parse(match[1])
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    if (!key?.startsWith('--') || values[index + 1] === undefined) throw new Error(`invalid argument: ${key || ''}`)
    parsed[key.slice(2)] = values[index + 1]
  }
  return parsed
}

function requireSha(value) {
  const sha = String(value || '').trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('a full 40-character target SHA is required')
  return sha
}

function resolveNpmVersion() {
  const userAgentVersion = process.env.npm_config_user_agent?.match(/^npm\/([^ ]+)/)?.[1]
  if (userAgentVersion) return userAgentVersion
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return execFileSync(command, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim()
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
