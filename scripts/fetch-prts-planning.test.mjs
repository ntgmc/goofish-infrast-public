import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fetchPrtsPlanning } from './fetch-prts-planning.mjs'
import { planningFixture } from './prts-planning-fixture.mjs'
import { withSnapshotLock, writeSnapshot } from './prts-planning-lib.mjs'

const page = (rows, hasNext = false) => ({ status_code: 200, data: { data: rows, has_next: hasNext, total: 3 } })
const summary = (id, metadata = {}) => ({ id, available: true, status: 'PUBLIC', type: 'PRTS', content: JSON.stringify(planningFixture().homeworks[0].content), upload_time: '2026-10-08T12:00:00', like: 90, dislike: 10, views: 10000, hot_score: 2.5, ...metadata })

async function sandbox(operation) {
  const directory = await mkdtemp(join(tmpdir(), 'prts-full-fetch-'))
  try {
    const base = join(directory, 'base.json'), output = join(directory, 'snapshot.json')
    await writeSnapshot(base, planningFixture())
    await writeSnapshot(output, planningFixture())
    await operation({ base, output })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('fetches all public planning content and metadata, tolerates page overlap, and replaces obsolete homeworks', async () => sandbox(async (options) => {
  const original = await readFile(options.base, 'utf8')
  const calls = []
  const request = async (url) => {
    calls.push(url)
    return new URL(url).searchParams.get('page') === '1'
      ? page([summary(25), summary(24)], true)
      : page([summary(24), summary(19), summary(18, { status: 'PRIVATE' }), summary(17, { content: '{"type":"SSS"}' })])
  }
  const result = await fetchPrtsPlanning(options, request, async () => {})
  const saved = JSON.parse(await readFile(options.output, 'utf8'))
  assert.equal(result.pages, 2)
  assert.equal(result.count, 3)
  assert.equal(result.cursor, 25)
  assert.deepEqual(saved.homeworks.map((row) => row.id), [25, 24, 19])
  assert.equal(saved.reconcilePage, 1)
  assert.deepEqual(saved.homeworks[0].content, planningFixture().homeworks[0].content)
  assert.deepEqual(Object.fromEntries(['uploadedAt', 'likes', 'dislikes', 'views', 'hotScore'].map((key) => [key, saved.homeworks[0][key]])), { uploadedAt: '2026-10-08T04:00:00.000Z', likes: 90, dislikes: 10, views: 10000, hotScore: 2.5 })
  for (const key of ['costs', 'operators', 'recipes', 'farms', 'itemNames', 'potionValues']) assert.deepEqual(saved[key], JSON.parse(original)[key])
  assert.equal(await readFile(options.base, 'utf8'), original)
  assert.equal(calls.length, 2)
  assert.ok(calls.every((url) => url.includes('/copilot/query?')))
}))

test('incomplete or invalid full fetches preserve both files and release the lock', async () => sandbox(async (options) => {
  const original = await readFile(options.output, 'utf8')
  const base = await readFile(options.base, 'utf8')
  for (const [payloads, expected] of [
    [[page([])], /No usable/],
    [[page([summary(25, { upload_time: '' })])], /publication time/],
    [[page([summary(25, { content: '{invalid' })])], /JSON/],
    [[page([summary(24), summary(25)])], /descending ID/],
    [[page([summary(25)], true), page([summary(25)], true)], /did not advance/],
    [[page([summary(25)], true), { status_code: 500 }], /Invalid PRTS page/],
    [[page([summary(25)], true), page([summary(26)])], /descending ID/],
    [[{ status_code: 200, data: { data: [summary(25)] } }], /Invalid PRTS page/],
  ]) {
    let index = 0
    await assert.rejects(fetchPrtsPlanning(options, async () => payloads[index++], async () => {}), expected)
    assert.equal(await readFile(options.output, 'utf8'), original)
    assert.equal(await readFile(options.base, 'utf8'), base)
    await withSnapshotLock(options.output, async () => {})
  }
  await assert.rejects(fetchPrtsPlanning(options, async () => { throw Object.assign(new Error('HTTP 403'), { status: 403 }) }, async () => {}), /HTTP 403/)
  await assert.rejects(fetchPrtsPlanning({ base: options.base, output: options.base }), /must differ/)
  await withSnapshotLock(options.output, () => assert.rejects(fetchPrtsPlanning(options), /already locked/))
  assert.equal(await readFile(options.output, 'utf8'), original)
}))

test('retries a transient upstream error on the same page before publishing', async () => sandbox(async (options) => {
  let attempts = 0
  const urls = []
  const request = async (url) => {
    urls.push(url)
    if (attempts++ === 0) throw Object.assign(new Error('HTTP 503'), { status: 503 })
    return page([summary(25)])
  }
  const result = await fetchPrtsPlanning(options, request, async () => {})
  assert.equal(result.count, 1)
  assert.equal(attempts, 2)
  assert.equal(urls[0], urls[1])
}))
