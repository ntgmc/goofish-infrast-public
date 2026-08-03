import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import databaseSchemaContract from '../server/database-schema-contract.json' with { type: 'json' }
import { atomicWriteFile } from './atomic-write.mjs'

const [command, ...rawArguments] = process.argv.slice(2)
const argumentsMap = parseArguments(rawArguments)

if (command === 'create') {
  const manifest = {
    schema_version: 1,
    backup_id: requireBackupId(argumentsMap['backup-id']),
    created_at: backupIdToIso(argumentsMap['backup-id']),
    environment: requireEnvironment(argumentsMap.environment),
    git_sha: requireGitSha(argumentsMap['git-sha']),
    database: {
      fingerprint: requireSha256(argumentsMap['database-fingerprint'], 'database fingerprint'),
      schema_version: databaseSchemaContract.version,
    },
    objects: {
      database: readObject('database'),
      config: readObject('config'),
    },
  }
  validateManifest(manifest)
  const output = resolve(requireValue(argumentsMap.output, 'output'))
  await atomicWriteFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  validateManifest(JSON.parse(await readFile(output, 'utf8')))
} else if (command === 'verify') {
  const manifest = await readManifest()
  const expectedEnvironment = argumentsMap.environment
  if (expectedEnvironment && manifest.environment !== requireEnvironment(expectedEnvironment)) {
    throw new Error(`backup environment mismatch: expected ${expectedEnvironment}, received ${manifest.environment}`)
  }
  process.stdout.write(`${manifest.backup_id}\n`)
} else if (command === 'get') {
  const manifest = await readManifest()
  const fields = {
    backup_id: manifest.backup_id,
    environment: manifest.environment,
    git_sha: manifest.git_sha,
    database_fingerprint: manifest.database.fingerprint,
    database_schema_version: manifest.database.schema_version,
    database_object: manifest.objects.database.path,
    database_sha256: manifest.objects.database.sha256,
    database_size: String(manifest.objects.database.size),
    config_object: manifest.objects.config.path,
    config_sha256: manifest.objects.config.sha256,
    config_size: String(manifest.objects.config.size),
  }
  const field = requireValue(argumentsMap.field, 'field')
  if (!Object.hasOwn(fields, field)) throw new Error(`unsupported backup manifest field: ${field}`)
  process.stdout.write(`${fields[field]}\n`)
} else if (command === 'contract') {
  const fields = {
    database_schema_version: databaseSchemaContract.version,
    minimum_app_version: databaseSchemaContract.minimum_app_version,
  }
  const field = requireValue(argumentsMap.field, 'field')
  if (!Object.hasOwn(fields, field)) throw new Error(`unsupported backup contract field: ${field}`)
  process.stdout.write(`${fields[field]}\n`)
} else {
  throw new Error('Usage: backup-manifest.mjs <create|verify|get|contract> [arguments]')
}

function readObject(prefix) {
  return {
    path: requireObjectPath(argumentsMap[`${prefix}-object`], argumentsMap['backup-id']),
    sha256: requireSha256(argumentsMap[`${prefix}-sha256`], `${prefix} SHA-256`),
    size: requirePositiveInteger(argumentsMap[`${prefix}-size`], `${prefix} size`),
  }
}

async function readManifest() {
  const path = resolve(requireValue(argumentsMap.path, 'path'))
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  validateManifest(manifest)
  return manifest
}

function validateManifest(value) {
  if (value?.schema_version !== 1) throw new Error('unsupported backup manifest schema')
  requireBackupId(value.backup_id)
  if (value.created_at !== backupIdToIso(value.backup_id)) throw new Error('backup manifest timestamp does not match backup id')
  requireEnvironment(value.environment)
  requireGitSha(value.git_sha)
  requireSha256(value.database?.fingerprint, 'database fingerprint')
  if (value.database?.schema_version !== databaseSchemaContract.version) throw new Error('backup database schema version does not match this release')
  for (const [name, object] of Object.entries(value.objects ?? {})) {
    if (!['database', 'config'].includes(name)) throw new Error(`unexpected backup object: ${name}`)
    requireObjectPath(object?.path, value.backup_id)
    requireSha256(object?.sha256, `${name} SHA-256`)
    requirePositiveInteger(object?.size, `${name} size`)
  }
  if (!value.objects?.database || !value.objects?.config) throw new Error('backup manifest must pair database and config objects')
}

function requireObjectPath(value, backupId) {
  const path = requireValue(value, 'object path')
  if (!/^(daily|monthly)\/[A-Za-z0-9._-]+$/.test(path) || path.includes('..')) throw new Error(`unsafe backup object path: ${path}`)
  if (!path.includes(backupId)) throw new Error(`backup object path is not paired with backup id ${backupId}`)
  return path
}

function requireBackupId(value) {
  const backupId = requireValue(value, 'backup id')
  if (!/^\d{4}-\d{2}-\d{2}T\d{6}Z$/.test(backupId)) throw new Error('backup id must be a UTC timestamp')
  return backupId
}

function backupIdToIso(value) {
  const backupId = requireBackupId(value)
  return `${backupId.slice(0, 10)}T${backupId.slice(11, 13)}:${backupId.slice(13, 15)}:${backupId.slice(15, 17)}.000Z`
}

function requireEnvironment(value) {
  const environment = requireValue(value, 'environment')
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(environment)) throw new Error('backup environment is invalid')
  return environment
}

function requireGitSha(value) {
  const gitSha = requireValue(value, 'git SHA')
  if (gitSha !== 'unknown' && !/^[0-9a-f]{40}$/.test(gitSha)) throw new Error('backup Git SHA must be full length or unknown')
  return gitSha
}

function requireSha256(value, label) {
  const sha = requireValue(value, label).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`${label} must be a SHA-256 digest`)
  return sha
}

function requirePositiveInteger(value, label) {
  const normalized = String(value ?? '')
  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) throw new Error(`${label} must be a positive integer`)
  return Number(normalized)
}

function requireValue(value, label) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
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
