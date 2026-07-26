import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { ARTIFACT_KINDS } from './release-artifact-config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/release-artifact.mjs')
const sha = '0123456789abcdef0123456789abcdef01234567'

for (const kind of Object.keys(ARTIFACT_KINDS)) {
  test(`creates and verifies an immutable ${kind} artifact`, async () => {
    const fixture = await createFixture(kind)
    try {
      run(fixture, ['create', '--kind', kind, '--sha', sha, '--run-id', '42', '--run-url', 'https://example.invalid/runs/42'])
      run(fixture, ['verify', '--kind', kind, '--sha', sha])
      const manifest = JSON.parse(await readFile(join(fixture.artifact, 'build-manifest.json'), 'utf8'))
      assert.equal(manifest.schema_version, 2)
      assert.equal(manifest.artifact_kind, kind)
      assert.equal(manifest.target_sha, sha)
      assert.equal(manifest.changelog.release.version, '2.0.1')
      for (const required of ARTIFACT_KINDS[kind].required) assert.ok(manifest.files[required])
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
}

test('rejects missing, extra, wrong-kind, and tampered artifact files', async () => {
  const fixture = await createFixture('public')
  try {
    await rm(join(fixture.artifact, 'server/dist/routes.js'))
    assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', sha]), /required public artifact entry.*routes\.js/)
    await writeRequiredFiles(fixture.artifact, 'public')
    await writeFile(join(fixture.artifact, 'server/dist/worker.js'), 'export {}', 'utf8')
    assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', sha]), /unexpected public artifact entry.*worker\.js/)
    await rm(join(fixture.artifact, 'server/dist/worker.js'))
    run(fixture, ['create', '--kind', 'public', '--sha', sha])
    assert.throws(() => run(fixture, ['verify', '--kind', 'worker', '--sha', sha]), /artifact kind must be public/)
    await writeFile(join(fixture.artifact, 'dist/index.html'), 'tampered', 'utf8')
    assert.throws(() => run(fixture, ['verify', '--kind', 'public', '--sha', sha]), /hash mismatch/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('rejects private optimizer sources embedded in a public sourcemap', async () => {
  const fixture = await createFixture('public')
  try {
    await writeFile(join(fixture.artifact, 'server/dist/index.js.map'), JSON.stringify({
      version: 3,
      sources: ['../../server/optimization/engine/optimizer-engine.ts'],
      sourcesContent: ['export class OptimizerEngine {}'],
      mappings: '',
    }), 'utf8')
    assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', sha]), /references private optimizer source/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('rejects changelog and build metadata that do not describe the target', async () => {
  const fixture = await createFixture('public')
  try {
    const recordPath = join(fixture.artifact, 'changelog-release.json')
    const envelope = JSON.parse(await readFile(recordPath, 'utf8'))
    envelope.release.targetSha = 'abcdef0123456789abcdef0123456789abcdef01'
    await writeFile(recordPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
    assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', sha]), /changelog target SHA mismatch/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('allows an immutable deployment worktree only when explicitly requested', async () => {
  const fixture = await createFixture('public')
  try {
    run(fixture, ['create', '--kind', 'public', '--sha', sha])
    await writeFile(join(fixture.artifact, 'package.json'), '{}\n', 'utf8')
    assert.throws(() => run(fixture, ['verify', '--kind', 'public', '--sha', sha]), /unexpected public artifact entry.*package\.json/)
    run(fixture, ['verify', '--kind', 'public', '--sha', sha], { RELEASE_ALLOW_SOURCE_TREE: 'true' })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('writes a separate deployable decision for build-relevant releases', async () => {
  const fixture = await createFixture('public')
  try {
    run(fixture, ['decision', '--sha', sha, '--deployable', 'true'])
    const decision = JSON.parse(await readFile(join(fixture.artifact, 'deployment-decision.json'), 'utf8'))
    assert.deepEqual(decision, {
      schema_version: 1,
      target_sha: sha,
      deployable: true,
      reason: 'build-relevant release artifacts',
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function createFixture(kind) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'goofish-release-'))
  const source = join(fixtureRoot, 'source')
  const artifact = join(fixtureRoot, 'artifact')
  await mkdir(join(source, 'src/lib/.generated'), { recursive: true })
  await mkdir(artifact, { recursive: true })
  await writeFile(join(source, 'src/lib/.generated/build-meta.ts'), `export const APP_BUILD_META = ${JSON.stringify({
    frontend_version: '2.0.1', backend_version: '2.0.1', data_version: 'data.1.0123456',
    generated_at: '2026-07-18T00:00:00.000Z', source_summary: 'fixture', git_sha: sha, build_context: 'test',
  }, null, 2)} as const;\n`, 'utf8')
  await writeRequiredFiles(artifact, kind)
  return { root: fixtureRoot, source, artifact }
}

async function writeRequiredFiles(artifact, kind) {
  for (const path of ARTIFACT_KINDS[kind].required) {
    const target = join(artifact, path)
    await mkdir(dirname(target), { recursive: true })
    if (path === 'changelog-release.json') {
      await writeFile(target, `${JSON.stringify({
        schema_version: 1,
        candidate: true,
        release: {
          id: 'v2.0.1', version: '2.0.1', displayVersion: 'v2.0.1', releasedAt: '2026-07-18',
          targetSha: sha, previousTargetSha: null, kind: 'baseline', sections: [],
        },
      }, null, 2)}\n`, 'utf8')
    } else if (path === 'changelog-release.md') {
      await writeFile(target, '# v2.0.1\n\nBaseline\n', 'utf8')
    } else if (path.endsWith('.map')) {
      await writeFile(target, JSON.stringify({ version: 3, sources: ['../index.ts'], sourcesContent: ['export {}'], mappings: '' }), 'utf8')
    } else {
      await writeFile(target, path.endsWith('.html') ? '<!doctype html>' : 'export {}', 'utf8')
    }
  }
}

function run(fixture, argumentsList, environment = {}) {
  const result = spawnSync(process.execPath, [script, ...argumentsList], {
    cwd: root,
    env: {
      ...process.env,
      RELEASE_ROOT: fixture.artifact,
      RELEASE_SOURCE_ROOT: fixture.source,
      npm_config_user_agent: '',
      ...environment,
    },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
}
