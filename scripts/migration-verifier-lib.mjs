import { createHash } from 'node:crypto'

export const MIGRATION_STORES = Object.freeze({
  cdk_records: Object.freeze({ primaryKey: 'key', jsonColumn: 'record_json' }),
  announcements: Object.freeze({ primaryKey: 'key', jsonColumn: 'data_json' }),
  usage_events: Object.freeze({ primaryKey: 'key', jsonColumn: 'record_json' }),
  admin_users: Object.freeze({ primaryKey: 'username', jsonColumn: 'record_json' }),
})

export function validateMigrationExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('migration export must be a JSON object')
  if (!payload.stores || typeof payload.stores !== 'object' || Array.isArray(payload.stores)) {
    throw new Error('migration export stores must be an object')
  }

  const normalized = {}
  for (const storeName of Object.keys(MIGRATION_STORES)) {
    const entries = payload.stores[storeName] ?? []
    if (!Array.isArray(entries)) throw new Error(`migration export store ${storeName} must be an array`)
    const seen = new Set()
    normalized[storeName] = entries.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${storeName}[${index}] must be an object`)
      if (typeof entry.key !== 'string' || !entry.key.trim()) throw new Error(`${storeName}[${index}].key must be a non-empty string`)
      if (!entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) throw new Error(`${storeName}[${index}].value must be an object`)
      const primaryKey = storeName === 'admin_users'
        ? String(entry.value.username || entry.key.replace(/^users\//, '').replace(/\.json$/, ''))
        : entry.key
      if (!primaryKey) throw new Error(`${storeName}[${index}] resolves to an empty primary key`)
      if (seen.has(primaryKey)) throw new Error(`${storeName} contains duplicate primary key ${primaryKey}`)
      seen.add(primaryKey)
      const value = storeName === 'admin_users' ? { ...entry.value, username: primaryKey } : entry.value
      return { primaryKey, value }
    })
  }
  return normalized
}

export function checksumKeys(keys) {
  return createHash('sha256').update([...keys].sort().join('\n')).digest('hex')
}

export function checksumRows(rows) {
  return createHash('sha256').update(canonicalJson(
    [...rows].sort((left, right) => left.primaryKey.localeCompare(right.primaryKey)),
  )).digest('hex')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
