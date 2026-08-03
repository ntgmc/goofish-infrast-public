import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('writes PostgreSQL credentials only to a mode-0600 service file', async () => {
  await mkdir(resolve(root, '.cache'), { recursive: true })
  const directory = await mkdtemp(resolve(root, '.cache/goofish-pg-service-'))
  try {
    const output = join(directory, 'pg_service.conf')
    const result = spawnSync(process.execPath, [
      'scripts/write-pg-service.mjs', '--url-env', 'FIXTURE_DATABASE_URL',
      '--output', output, '--service', 'fixture',
    ], {
      cwd: root,
      env: { ...process.env, FIXTURE_DATABASE_URL: 'postgresql://user:fixture-secret@db.example.test/database?sslmode=require' },
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /fixture-secret/)
    assert.match(await readFile(output, 'utf8'), /password='fixture-secret'/)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.match(result.stdout.trim(), /^[0-9a-f]{64}$/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
