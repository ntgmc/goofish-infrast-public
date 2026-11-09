import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const source = new URL('./sync-operator-avatars.mjs', import.meta.url)
const catalogUrl = (ref) => `https://api.github.com/repos/ZOOT-Plus/zoot-plus-frontend/contents/public/assets/operator-avatars/webp96?ref=${encodeURIComponent(ref)}`
const downloadUrl = (ref) => `https://raw.githubusercontent.com/ZOOT-Plus/zoot-plus-frontend/${ref}/public/assets/operator-avatars/webp96/avatar.webp`
const original = 'original avatar'
const updated = 'updated avatar'
const missingBranch = (ref) => ({ message: `No commit found for the ref ${ref}` })
const listing = (ref) => ({
  url: catalogUrl(ref),
  body: [{ type: 'file', name: 'avatar.webp', size: updated.length, sha: 'a'.repeat(40), download_url: downloadUrl(ref) }],
})
const download = (ref) => ({ url: downloadUrl(ref), bytes: [...Buffer.from(updated)] })

test('syncs from scripts/update while that branch exists', async (t) => {
  const { result, avatar } = await runSync(t, [listing('scripts/update'), download('scripts/update')])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Source: ZOOT-Plus\/zoot-plus-frontend@scripts\/update\//)
  assert.equal(avatar, updated)
})

test('falls back to dev after scripts/update is merged and deleted', async (t) => {
  const { result, avatar } = await runSync(t, [
    { url: catalogUrl('scripts/update'), status: 404, body: missingBranch('scripts/update') },
    listing('dev'), download('dev'),
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Source: ZOOT-Plus\/zoot-plus-frontend@dev\//)
  assert.equal(avatar, updated)
})

for (const [status, body] of [
  [401, { message: 'Bad credentials' }],
  [403, { message: 'API rate limit exceeded' }],
  [404, { message: 'Not Found' }],
]) {
  test(`preserves local avatars and reports HTTP ${status} without falling back`, async (t) => {
    const { result, avatar } = await runSync(t, [{ url: catalogUrl('scripts/update'), status, body }])
    assert.equal(result.status, 1)
    assert.match(result.stderr, new RegExp(`Failed to list.*${status}`))
    assert.equal(avatar, original)
  })
}

test('reports a missing dev branch and preserves local avatars', async (t) => {
  const { result, avatar } = await runSync(t, [
    { url: catalogUrl('scripts/update'), status: 404, body: missingBranch('scripts/update') },
    { url: catalogUrl('dev'), status: 404, body: missingBranch('dev') },
  ])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /No commit found for the ref dev/)
  assert.equal(avatar, original)
})

test('retries a temporary error on scripts/update without switching branches', async (t) => {
  const { result, avatar } = await runSync(t, [
    { url: catalogUrl('scripts/update'), status: 503, body: { message: 'Service Unavailable' } },
    listing('scripts/update'), download('scripts/update'),
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Source: ZOOT-Plus\/zoot-plus-frontend@scripts\/update\//)
  assert.equal(avatar, updated)
})

test('preserves local avatars when the fallback download is incomplete', async (t) => {
  const { result, avatar } = await runSync(t, [
    { url: catalogUrl('scripts/update'), status: 404, body: missingBranch('scripts/update') },
    listing('dev'), { ...download('dev'), bytes: [1] },
  ])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Downloaded avatar.webp with 1 bytes, expected/)
  assert.equal(avatar, original)
})

async function runSync(t, responses) {
  const directory = await mkdtemp(join(tmpdir(), 'avatar-sync-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'scripts'))
  await mkdir(join(directory, 'public/webp96'), { recursive: true })
  await cp(source, join(directory, 'scripts/sync-operator-avatars.mjs'))
  await writeFile(join(directory, 'public/webp96/avatar.webp'), original)
  await writeFile(join(directory, 'responses.json'), JSON.stringify(responses))
  await writeFile(join(directory, 'mock-fetch.mjs'), `
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const responses = JSON.parse(readFileSync(new URL('./responses.json', import.meta.url), 'utf8'))
globalThis.fetch = async (url) => {
  const expected = responses[0]
  assert(expected, 'Unexpected fetch: ' + url)
  assert.equal(String(url), expected.url)
  responses.shift()
  return new Response(expected.bytes ? Uint8Array.from(expected.bytes) : JSON.stringify(expected.body), { status: expected.status || 200 })
}
process.on('exit', () => assert.equal(responses.length, 0, 'Missing expected fetches'))
`)
  const result = spawnSync(process.execPath, ['--import', join(directory, 'mock-fetch.mjs'), join(directory, 'scripts/sync-operator-avatars.mjs')], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.ifError(result.error)
  return { result, avatar: await readFile(join(directory, 'public/webp96/avatar.webp'), 'utf8') }
}
