import assert from 'node:assert/strict'
import test from 'node:test'
import { checksumRows, validateMigrationExport } from './migration-verifier-lib.mjs'

test('validates migration export keys and normalizes admin usernames', () => {
  const normalized = validateMigrationExport({
    stores: {
      cdk_records: [{ key: 'cdk/1', value: { status: 'unused' } }],
      announcements: [],
      usage_events: [],
      admin_users: [{ key: 'users/admin.json', value: { password_hash: 'hash' } }],
    },
  })
  assert.equal(normalized.cdk_records[0].primaryKey, 'cdk/1')
  assert.deepEqual(normalized.admin_users[0], {
    primaryKey: 'admin',
    value: { password_hash: 'hash', username: 'admin' },
  })
})

test('rejects duplicate migration primary keys and computes order-independent checksums', () => {
  assert.throws(() => validateMigrationExport({
    stores: {
      cdk_records: [{ key: 'same', value: {} }, { key: 'same', value: {} }],
    },
  }), /duplicate primary key/)
  assert.equal(
    checksumRows([{ primaryKey: 'b', value: { y: 2 } }, { primaryKey: 'a', value: { x: 1 } }]),
    checksumRows([{ primaryKey: 'a', value: { x: 1 } }, { primaryKey: 'b', value: { y: 2 } }]),
  )
})
