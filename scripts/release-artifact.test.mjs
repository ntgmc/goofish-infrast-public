import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/release-artifact.mjs')
const sha = '0123456789abcdef0123456789abcdef01234567'

test('creates and verifies an immutable release artifact', async () => {
  const fixture = await createFixture()
  try {
    run(fixture, ['create', '--sha', sha, '--run-id', '42', '--run-url', 'https://example.invalid/runs/42'], { npm_config_user_agent: '' })
    run(fixture, ['verify', '--sha', sha])
    const manifest = JSON.parse(await readFile(join(fixture, 'build-manifest.json'), 'utf8'))
    assert.equal(manifest.target_sha, sha)
    assert.ok(manifest.files['dist/index.html'])
    assert.ok(manifest.files['server/dist/index.js'])
    assert.ok(manifest.files['server/dist/worker.js'])
    assert.ok(manifest.files['server/dist/optimize-worker.js'])
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects a mismatched SHA and tampered artifact', async () => {
  const fixture = await createFixture()
  try {
    run(fixture, ['create', '--sha', sha])
    assert.throws(() => run(fixture, ['verify', '--sha', 'abcdef0123456789abcdef0123456789abcdef01']), /SHA mismatch/)
    await writeFile(join(fixture, 'dist/index.html'), 'tampered', 'utf8')
    assert.throws(() => run(fixture, ['verify', '--sha', sha]), /hash mismatch/)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

async function createFixture() {
  const fixture = await mkdtemp(join(tmpdir(), 'goofish-release-'))
  await mkdir(join(fixture, 'dist'), { recursive: true })
  await mkdir(join(fixture, 'server/dist'), { recursive: true })
  await mkdir(join(fixture, 'src/lib/.generated'), { recursive: true })
  await writeFile(join(fixture, 'dist/index.html'), '<!doctype html>', 'utf8')
  await writeFile(join(fixture, 'server/dist/index.js'), 'export {}', 'utf8')
  await writeFile(join(fixture, 'server/dist/worker.js'), 'export {}', 'utf8')
  await writeFile(join(fixture, 'server/dist/optimize-worker.js'), 'export {}', 'utf8')
  await writeFile(join(fixture, 'src/lib/.generated/build-meta.ts'), `export const APP_BUILD_META = ${JSON.stringify({
    frontend_version: '2.0.1', backend_version: '2.0.1', data_version: 'data.1.0123456',
    generated_at: '2026-07-18T00:00:00.000Z', source_summary: 'fixture', git_sha: sha, build_context: 'test',
  }, null, 2)} as const;\n`, 'utf8')
  return fixture
}

function run(fixture, argumentsList, environment = {}) {
  const result = spawnSync(process.execPath, [script, ...argumentsList], {
    cwd: root,
    env: { ...process.env, RELEASE_ROOT: fixture, ...environment },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
}
