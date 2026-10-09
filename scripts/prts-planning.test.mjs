import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { importPrtsPlanning } from './import-prts-planning.mjs'
import { syncPrtsPlanning } from './sync-prts-planning.mjs'
import { planningFixture } from './prts-planning-fixture.mjs'
import { homeworkRow, writeSnapshot } from './prts-planning-lib.mjs'

async function sandbox(operation) {
  const directory = await mkdtemp(join(tmpdir(), 'prts-planning-'))
  try { await operation(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('imports a completed qqbot snapshot read-only and rejects incomplete imports atomically', async () => sandbox(async (directory) => {
  const fixture = planningFixture()
  const databasePath = join(directory, 'bot.sqlite3'), costs = join(directory, 'costs.json'), assets = join(directory, 'assets.json'), output = join(directory, 'snapshot.json')
  const database = new DatabaseSync(databasePath)
  database.exec('CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE homeworks (snapshot_id INTEGER, homework_id INTEGER, payload_json TEXT); CREATE TABLE detail_cache (homework_id INTEGER, summary_hash TEXT, content_json TEXT)')
  database.prepare('INSERT INTO meta VALUES (?, ?)').run('active_snapshot_id', '1')
  database.prepare('INSERT INTO homeworks VALUES (1, 20, ?)').run(JSON.stringify({ summary_hash: 'hash', upload_time: fixture.homeworks[0].uploadedAt, likes: 90, dislikes: 10, views: 10000 }))
  database.prepare('INSERT INTO detail_cache VALUES (20, ?, ?)').run('hash', JSON.stringify(fixture.homeworks[0].content))
  await writeFile(costs, JSON.stringify(fixture.costs))
  const { operators, recipes, farms, itemNames, potionValues } = fixture
  await writeFile(assets, JSON.stringify({ operators, recipes, farms, itemNames, potionValues }))
  const result = await importPrtsPlanning({ database: databasePath, costs, assets, output })
  assert.equal(result.count, 1)
  assert.equal(result.cursor, 20)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM homeworks').get().count, 1)
  const original = await readFile(output, 'utf8')
  assert.deepEqual(Object.fromEntries(['uploadedAt', 'likes', 'dislikes', 'views'].map((key) => [key, JSON.parse(original).homeworks[0][key]])), { uploadedAt: fixture.homeworks[0].uploadedAt, likes: 90, dislikes: 10, views: 10000 })
  database.exec('DELETE FROM detail_cache')
  await assert.rejects(importPrtsPlanning({ database: databasePath, costs, assets, output }), /missing or outdated/)
  assert.equal(await readFile(output, 'utf8'), original)
  database.close()
}))

test('continues from the imported cursor and reconciles edited and private jobs without a full crawl', async () => sandbox(async (directory) => {
  const output = join(directory, 'snapshot.json')
  const fixture = planningFixture()
  await writeSnapshot(output, fixture)
  const calls = []
  const request = async (url) => {
    calls.push(url)
    if (url.includes('/query')) return { status_code: 200, data: { has_next: true, data: [
      { id: 21, content: '{}', available: true, type: 'PRTS', status: 'PUBLIC', upload_time: '2026-10-07T12:00:00', like: 8, dislike: 2, views: 100, hot_score: 5 },
      { id: 20, content: '{}', available: true, type: 'PRTS', status: 'PUBLIC' },
    ] } }
    if (url.endsWith('/21')) return { status_code: 200, data: { content: JSON.stringify({ ...fixture.homeworks[0].content, stage_name: 'main_02' }), available: true, status: 'PUBLIC' } }
    return { status_code: 200, data: { available: false, status: 'PRIVATE' } }
  }
  const result = await syncPrtsPlanning({ output, reconcile: '1' }, request, async () => {})
  const saved = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(result.cursor, 21)
  assert.deepEqual(saved.homeworks.map((row) => row.id), [21])
  assert.deepEqual(Object.fromEntries(['uploadedAt', 'likes', 'dislikes', 'views', 'hotScore'].map((key) => [key, saved.homeworks[0][key]])), { uploadedAt: '2026-10-07T04:00:00.000Z', likes: 8, dislikes: 2, views: 100, hotScore: 5 })
  assert.equal(calls.filter((url) => url.includes('/query')).length, 1)
  assert.equal(calls.length, 3)
}))

test('normalizes API and imported statistics without inventing missing dates or accepting invalid counts', () => {
  const content = planningFixture().homeworks[0].content
  const row = homeworkRow(1, content, 'hash', { upload_time: '2026-10-07T12:00:00', like: 0, dislike: 2, views: 100, hot_score: 1.5 })
  assert.equal(row.uploadedAt, '2026-10-07T04:00:00.000Z')
  assert.equal(row.likes, 0)
  assert.equal(row.dislikes, 2)
  assert.equal(row.hotScore, 1.5)
  assert.equal(homeworkRow(1, content, 'hash', { upload_time: '2026-10-07T12:00:00Z' }).uploadedAt, '2026-10-07T12:00:00.000Z')
  assert.equal(homeworkRow(1, content, 'hash', { first_upload_time: '2026-01-01 12:00:00', upload_time: '2026-10-07T12:00:00Z' }).uploadedAt, '2026-01-01T04:00:00.000Z')
  assert.equal(homeworkRow(1, { ...content, first_upload_time: '2026-01-01 12:00:00' }, 'hash', { upload_time: '2026-10-07T12:00:00Z' }).uploadedAt, '2026-01-01T04:00:00.000Z')
  assert.equal(homeworkRow(1, content, 'hash', { type: 'VIDEO' }), null)
  assert.equal(homeworkRow(1, content, 'hash', { status: 'PRIVATE' }), null)
  const invalid = homeworkRow(1, content, 'hash', { upload_time: 'invalid', likes: -1, dislikes: 1.5, views: Infinity, hotScore: '5' })
  assert.equal(invalid.uploadedAt, undefined)
  assert.equal(invalid.likes, undefined)
  assert.equal(invalid.dislikes, undefined)
  assert.equal(invalid.views, undefined)
  assert.equal(invalid.hotScore, undefined)
})

test('reconciles changing ratings with unchanged content and preserves metadata omitted by later responses', async () => sandbox(async (directory) => {
  const output = join(directory, 'snapshot.json')
  const fixture = planningFixture()
  await writeSnapshot(output, fixture)
  let metadata = { like: 120, dislike: 12, views: 12000, hot_score: 30 }
  const request = async (url) => {
    if (url.includes('/query')) return { status_code: 200, data: { has_next: false, data: [{ id: 20 }] } }
    return { status_code: 200, data: { content: JSON.stringify(fixture.homeworks[0].content), available: true, status: 'PUBLIC', ...metadata } }
  }
  const result = await syncPrtsPlanning({ output, reconcile: '1' }, request, async () => {})
  const saved = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(result.changed, 1)
  assert.equal(saved.homeworks[0].likes, 120)
  assert.equal(saved.homeworks[0].dislikes, 12)
  assert.equal(saved.homeworks[0].views, 12000)
  assert.equal(saved.homeworks[0].hotScore, 30)
  assert.equal(saved.homeworks[0].uploadedAt, fixture.homeworks[0].uploadedAt)
  metadata = {}
  await syncPrtsPlanning({ output, reconcile: '1' }, request, async () => {})
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).homeworks, saved.homeworks)
  metadata = { upload_time: '2099-01-01T00:00:00Z' }
  await syncPrtsPlanning({ output, reconcile: '1' }, request, async () => {})
  assert.equal(JSON.parse(await readFile(output, 'utf8')).homeworks[0].uploadedAt, fixture.homeworks[0].uploadedAt)
}))

test('failed sync preserves the entire old snapshot and releases the lock for retry', async () => sandbox(async (directory) => {
  const output = join(directory, 'snapshot.json')
  await writeSnapshot(output, planningFixture())
  const original = await readFile(output, 'utf8')
  const request = async (url) => {
    if (url.includes('/query')) return { status_code: 200, data: { has_next: true, data: [{ id: 21, content: '{}', available: true, type: 'PRTS', status: 'PUBLIC' }, { id: 20 }] } }
    throw new Error('network failed')
  }
  await assert.rejects(syncPrtsPlanning({ output }, request, async () => {}), /network failed/)
  assert.equal(await readFile(output, 'utf8'), original)
  await assert.rejects(syncPrtsPlanning({ output }, request, async () => {}), /network failed/)
}))

test('a duplicate writer cannot replace a snapshot while import/sync holds its lock', async () => sandbox(async (directory) => {
  const output = join(directory, 'snapshot.json')
  await writeSnapshot(output, planningFixture())
  await writeFile(`${output}.lock`, '123')
  await assert.rejects(syncPrtsPlanning({ output }), /already locked/)
  assert.equal(JSON.parse(await readFile(output, 'utf8')).cursor, 20)
}))
