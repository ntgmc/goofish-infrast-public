import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { requireArtifactKind } from './release-artifact-config.mjs'

const argumentsMap = parseArguments(process.argv.slice(2))
const expectedSha = requireSha(argumentsMap.sha)

for (const kind of ['public', 'worker', 'combined']) {
  requireArtifactKind(kind)
  const root = resolve(argumentsMap[kind] || '')
  if (!argumentsMap[kind]) throw new Error(`--${kind} is required`)
  const manifest = JSON.parse(await readFile(join(root, 'build-manifest.json'), 'utf8'))
  if (manifest.schema_version !== 2) throw new Error(`${kind} manifest has an unsupported schema`)
  if (manifest.artifact_kind !== kind) throw new Error(`${kind} manifest kind mismatch`)
  if (manifest.target_sha !== expectedSha || manifest.build_meta?.git_sha !== expectedSha) {
    throw new Error(`${kind} manifest target SHA mismatch`)
  }
}

process.stdout.write(`Verified public, worker, and combined manifests for ${expectedSha}\n`)

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
