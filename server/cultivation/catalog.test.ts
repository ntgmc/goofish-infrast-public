import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { prtsSnapshotPath, prtsSnapshotSchema, readPrtsCatalog, readPrtsHomeworks } from './catalog'

let directory: string, path: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'prts-stream-'))
  path = join(directory, 'snapshot.json')
  vi.stubEnv('MAA_PRTS_PLANNING_PATH', path)
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }) })

describe('incremental cultivation snapshot loading', () => {
  it.each([false, true])('reads metadata and individual validated jobs with homeworks first=%s', async (first) => {
    const snapshot = planningFixture()
    snapshot.homeworks = Array.from({ length: 100 }, (_, index) => ({ ...snapshot.homeworks[0], id: index + 1,
      content: { ...snapshot.homeworks[0].content, doc: { details: '中文😀\\\"\n[]{}'.repeat(1000) }, nested: [true, false, null, -1.5e3, ['边界']] } }))
    const { homeworks, ...catalog } = snapshot
    await writeFile(path, JSON.stringify(first ? { homeworks, ...catalog } : { ...catalog, homeworks }, null, first ? 2 : undefined))
    expect(prtsSnapshotPath()).toBe(path)
    expect(readPrtsCatalog()).toEqual(prtsSnapshotSchema.parse({ ...snapshot, homeworks: [] }))
    expect([...readPrtsHomeworks()]).toEqual(prtsSnapshotSchema.parse(snapshot).homeworks)
  })

  it('preserves multibyte characters and escapes split exactly at an input block boundary', async () => {
    const snapshot = planningFixture(), prefix = '{"homeworks":[{"id":20,"hash":"h","stageId":"s","mode":1,"content":{"details":"'
    const padding = 'x'.repeat(65536 - Buffer.byteLength(prefix) - 1)
    const body = `${padding}😀\\\"\nsecond`
    const { homeworks: _homeworks, ...catalog } = snapshot
    await writeFile(path, `${prefix}${JSON.stringify(body).slice(1)}}}],${JSON.stringify(catalog).slice(1)}`)
    expect([...readPrtsHomeworks()][0].content.details).toBe(body)
  })

  it('allows empty collections and explicitly selected source paths without retaining previous contents', async () => {
    const other = join(directory, 'other.json')
    await writeFile(other, JSON.stringify({ ...planningFixture(), cursor: 21, homeworks: [] }))
    expect(readPrtsCatalog(other).cursor).toBe(21)
    expect([...readPrtsHomeworks(other)]).toEqual([])
    await writeFile(other, JSON.stringify(planningFixture()))
    expect(readPrtsCatalog(other).cursor).toBe(20)
    expect([...readPrtsHomeworks(other)]).toHaveLength(1)
    expect(() => readPrtsCatalog()).toThrow(/ENOENT/)
  })

  it('rejects invalid job data when reached without loading the remaining jobs first', async () => {
    const snapshot = planningFixture()
    const valid = Array.from({ length: 256 }, (_, index) => ({ ...snapshot.homeworks[0], id: 20 + index }))
    await writeFile(path, JSON.stringify({ ...snapshot, homeworks: [...valid, { ...snapshot.homeworks[0], id: -1 }] }))
    const rows = readPrtsHomeworks()
    expect(rows.next().value).toEqual(prtsSnapshotSchema.parse(snapshot).homeworks[0])
    for (let index = 1; index < valid.length; index++) expect(rows.next().done).toBe(false)
    expect(() => rows.next()).toThrow()
    await writeFile(path, JSON.stringify(snapshot))
    expect([...readPrtsHomeworks()]).toHaveLength(1)
  })

  it.each([
    '{', '[]', '{"homeworks":{}}', '{"homeworks":[{"id":1}', '{"homeworks":[{},]}',
    '{"homeworks":[],}', '{"homeworks":[],"homeworks":[]}', '{"homeworks":[]} trailing',
    '{"homeworks":[{"content":"unterminated}', '{"unknown":0}', '{"homeworks":[{"content":"\\q"}]}',
  ])('rejects malformed snapshots: %s', async (content) => {
    await writeFile(path, content)
    expect(() => [...readPrtsHomeworks()]).toThrow()
  })

  it('validates catalog fields even though the job collection is read separately', async () => {
    await writeFile(path, JSON.stringify({ ...planningFixture(), cursor: -1 }))
    expect(() => readPrtsCatalog()).toThrow()
  })
})
