import * as esbuild from 'esbuild'
import { Pool } from 'pg'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const apply = process.argv.includes('--apply')
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const bundleDir = resolve('.cache/rekey-skland-credentials')
await mkdir(bundleDir, { recursive: true })
const bundlePath = resolve(bundleDir, 'skland-client.mjs')
await esbuild.build({
  entryPoints: ['server/handlers/skland-client.ts'],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['qrcode'],
  logLevel: 'silent',
})

const cryptoModule = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)
const pool = new Pool({ connectionString: databaseUrl, application_name: 'goofish-skland-rekey' })
let scanned = 0
let migrated = 0
let invalid = 0

try {
  const result = await pool.query('select id, record_json from user_game_accounts')
  for (const row of result.rows) {
    scanned += 1
    const profile = row.record_json
    let changed = false
    for (const field of ['skland_binding', 'skland_pending_binding']) {
      const binding = profile?.[field]
      if (!binding?.encrypted_cred || cryptoModule.isSklandCredentialCurrent(binding.encrypted_cred)) continue
      try {
        binding.encrypted_cred = cryptoModule.encryptSklandCredential(cryptoModule.decryptSklandCredential(binding.encrypted_cred))
        changed = true
      } catch {
        invalid += 1
      }
    }
    if (!changed) continue
    migrated += 1
    if (apply) {
      await pool.query(
        'update user_game_accounts set record_json = $1::jsonb, updated_at = $2 where id = $3',
        [JSON.stringify(profile), new Date().toISOString(), row.id],
      )
    }
  }
} finally {
  await pool.end()
}

console.log(`Skland credential rekey ${apply ? 'applied' : 'dry run'}: scanned=${scanned} migrated=${migrated} invalid=${invalid}`)
if (invalid > 0) process.exitCode = 1
