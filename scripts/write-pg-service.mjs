import { createHash } from 'node:crypto'
import { chmod, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { atomicWriteFile } from './atomic-write.mjs'

const argumentsMap = parseArguments(process.argv.slice(2))
const environmentName = requireArgument('url-env')
const outputPath = resolve(requireArgument('output'))
const metadataPath = argumentsMap.metadata ? resolve(argumentsMap.metadata) : null
const serviceName = String(argumentsMap.service || 'goofish').trim()
if (!/^[A-Za-z0-9_-]{1,64}$/.test(serviceName)) throw new Error('PostgreSQL service name is invalid')
const rawUrl = String(process.env[environmentName] ?? '').trim()
if (!rawUrl) throw new Error(`${environmentName} is required`)

const url = new URL(rawUrl)
if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${environmentName} must use postgresql://`)
const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
const user = decodeURIComponent(url.username)
const password = decodeURIComponent(url.password)
const host = url.hostname
const port = url.port || '5432'
for (const [label, value] of Object.entries({ database, user, host, port })) {
  if (!value || /[\r\n\0]/.test(value)) throw new Error(`PostgreSQL URL ${label} is invalid`)
}

const supportedOptions = new Set([
  'application_name', 'channel_binding', 'connect_timeout', 'gssencmode', 'options',
  'sslcert', 'sslkey', 'sslmode', 'sslrootcert', 'target_session_attrs',
])
const serviceOptions = []
for (const [name, value] of url.searchParams) {
  if (!supportedOptions.has(name)) throw new Error(`unsupported PostgreSQL URL option: ${name}`)
  serviceOptions.push([name, value])
}

const serviceFile = [
  `[${serviceName}]`,
  `host=${quoteServiceValue(host)}`,
  `port=${quoteServiceValue(port)}`,
  `dbname=${quoteServiceValue(database)}`,
  `user=${quoteServiceValue(user)}`,
  ...(password ? [`password=${quoteServiceValue(password)}`] : []),
  ...serviceOptions.map(([name, value]) => `${name}=${quoteServiceValue(value)}`),
  '',
].join('\n')
await atomicWriteFile(outputPath, serviceFile, { mode: 0o600 })
await chmod(outputPath, 0o600)

const fingerprint = createHash('sha256')
  .update(JSON.stringify({ host: host.toLowerCase(), port, database, user }))
  .digest('hex')
if (metadataPath) {
  await atomicWriteFile(metadataPath, `${JSON.stringify({
    schema_version: 1,
    host,
    port,
    database,
    user,
    fingerprint,
  }, null, 2)}\n`, { mode: 0o600 })
  JSON.parse(await readFile(metadataPath, 'utf8'))
}
process.stdout.write(`${fingerprint}\n`)

function quoteServiceValue(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('PostgreSQL service values must not contain control characters')
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

function requireArgument(name) {
  const value = String(argumentsMap[name] ?? '').trim()
  if (!value) throw new Error(`--${name} is required`)
  return value
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
