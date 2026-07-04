import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { getStore } from '@netlify/blobs'

const outputPath = resolve(process.argv[2] || 'migration-export/netlify-blobs-export.json')

const exportData = {
  exported_at: new Date().toISOString(),
  stores: {
    cdk_records: await exportStorePrefix('maa-cdks', 'cdk/'),
    announcements: await exportKnownKeys('maa-announcements', ['current.json']),
    usage_events: await exportStorePrefix('maa-usage-events', 'events/'),
    admin_users: await exportStorePrefix('maa-admin-users', 'users/'),
  },
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, JSON.stringify(exportData, null, 2), 'utf8')
console.log(`[export-netlify-blobs] wrote ${outputPath}`)
console.log(`[export-netlify-blobs] cdk_records=${exportData.stores.cdk_records.length}`)
console.log(`[export-netlify-blobs] announcements=${exportData.stores.announcements.length}`)
console.log(`[export-netlify-blobs] usage_events=${exportData.stores.usage_events.length}`)
console.log(`[export-netlify-blobs] admin_users=${exportData.stores.admin_users.length}`)

async function exportStorePrefix(storeName, prefix) {
  const store = getStore(storeName)
  const entries = []
  let cursor
  do {
    const result = await store.list({ prefix, cursor })
    const blobs = Array.isArray(result.blobs) ? result.blobs : []
    for (const { key } of blobs) {
      const value = await store.get(key, { type: 'json' })
      if (value !== null) entries.push({ key, value })
    }
    cursor = result.cursor
  } while (cursor)
  return entries
}

async function exportKnownKeys(storeName, keys) {
  const store = getStore(storeName)
  const entries = []
  for (const key of keys) {
    const value = await store.get(key, { type: 'json' })
    if (value !== null) entries.push({ key, value })
  }
  return entries
}
