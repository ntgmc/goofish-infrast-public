import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
      assert.equal(manifest.schema_version, 3)
      assert.equal(manifest.artifact_kind, kind)
      assert.equal(manifest.target_sha, sha)
      assert.equal(manifest.deployable, true)
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

test('requires the public HTTPS smoke runner in release artifacts', async () => {
  const fixture = await createFixture('public')
  try {
    await rm(join(fixture.artifact, 'scripts/check-public-http-smoke.mjs'))
    assert.throws(
      () => run(fixture, ['create', '--kind', 'public', '--sha', sha]),
      /required public artifact entry.*check-public-http-smoke\.mjs/,
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('requires the production release confirmation runner in release artifacts', async () => {
  const fixture = await createFixture('public')
  try {
    await rm(join(fixture.artifact, 'scripts/confirm-production-release.mjs'))
    assert.throws(
      () => run(fixture, ['create', '--kind', 'public', '--sha', sha]),
      /required public artifact entry.*confirm-production-release\.mjs/,
    )
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

test('binds real Web and server builds to their compiled metadata across partial rebuilds', async () => {
  const fixture = await createFixture('public')
  const compile = (command, args) => {
    const result = spawnSync(command, args, { cwd: fixture.source, encoding: 'utf8', env: process.env })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
  const web = async () => {
    compile(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'])
    await rm(join(fixture.artifact, 'dist'), { recursive: true, force: true })
    await cp(join(fixture.source, 'dist'), join(fixture.artifact, 'dist'), { recursive: true })
  }
  const server = async () => {
    compile(process.execPath, ['scripts/build-server.mjs', '--scope', 'public'])
    await rm(join(fixture.artifact, 'server/dist'), { recursive: true, force: true })
    await cp(join(fixture.source, 'server/dist'), join(fixture.artifact, 'server/dist'), { recursive: true })
  }
  try {
    await symlink(join(root, 'node_modules'), join(fixture.source, 'node_modules'), 'dir')
    await mkdir(join(fixture.source, 'scripts'), { recursive: true })
    await cp(join(root, 'vite.config.ts'), join(fixture.source, 'vite.config.ts'))
    await cp(join(root, 'scripts/build-server.mjs'), join(fixture.source, 'scripts/build-server.mjs'))
    await writeFile(join(fixture.source, 'index.html'), '<!doctype html><script type="module" src="/src/main.ts"></script>')
    await writeFile(join(fixture.source, 'src/main.ts'), "import { APP_BUILD_META } from './lib/.generated/build-meta'; console.log(APP_BUILD_META)")
    for (const entry of ['server/index.ts', 'server/routes.ts', 'server/migrate.ts', 'server/cultivation/cultivation-worker.ts', 'scripts/import-prts-planning.mjs', 'scripts/sync-prts-planning.mjs']) {
      const target = join(fixture.source, entry)
      await mkdir(dirname(target), { recursive: true })
      const metadataImport = entry.includes('/cultivation/') ? '../../src/lib/.generated/build-meta.ts' : '../src/lib/.generated/build-meta.ts'
      await writeFile(target, `import { APP_BUILD_META } from '${metadataImport}'; console.log(APP_BUILD_META)`)
    }
    await web(); await server()
    run(fixture, ['create', '--kind', 'public', '--sha', sha])
    run(fixture, ['verify', '--kind', 'public', '--sha', sha])
    for (const [index, first] of [[2, web], [3, server]]) {
      const target = String(index).repeat(40)
      const version = `2.0.${index}`
      const metadata = { ...buildMeta(), git_sha: target, frontend_version: version, backend_version: version, expected_backend_version: version, build_context: 'test */ escaped' }
      await writeFile(join(fixture.source, 'src/lib/.generated/build-meta.ts'), `export const APP_BUILD_META = ${JSON.stringify(metadata)} as const;\n`)
      const changelogPath = join(fixture.artifact, 'changelog-release.json')
      const changelog = JSON.parse(await readFile(changelogPath, 'utf8'))
      Object.assign(changelog.release, { targetSha: target, id: `v${version}`, version, displayVersion: `v${version}` })
      await writeFile(changelogPath, JSON.stringify(changelog))
      assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', target]), /compiled build metadata SHA mismatch/)
      await first()
      assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', target]), /compiled build metadata mismatch/)
      await (first === web ? server : web)()
      run(fixture, ['create', '--kind', 'public', '--sha', target])
      run(fixture, ['verify', '--kind', 'public', '--sha', target])
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('rejects stale or unstamped compiled entries and forged manifest metadata', async () => {
  const fixture = await createFixture('public')
  try {
    for (const path of ['dist/assets/main.js', 'server/dist/routes.js', 'server/dist/cultivation-worker.js']) {
      const original = await readFile(join(fixture.artifact, path), 'utf8')
      await writeFile(join(fixture.artifact, path), original.replace('"git_sha":"' + sha, '"git_sha":"' + 'b'.repeat(40)))
      assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', sha]), /compiled build metadata mismatch/)
      await writeFile(join(fixture.artifact, path), 'export {}')
      assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', sha]), /compiled build metadata is missing/)
      await writeFile(join(fixture.artifact, path), original)
    }
    run(fixture, ['create', '--kind', 'public', '--sha', sha])
    const path = join(fixture.artifact, 'build-manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.build_context = manifest.build_meta.build_context = 'forged'
    await writeFile(path, JSON.stringify(manifest))
    assert.throws(() => run(fixture, ['verify', '--kind', 'public', '--sha', sha]), /compiled build metadata does not match manifest/)
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

test('rejects non-candidate changelog metadata for release artifacts', async () => {
  const fixture = await createFixture('public')
  try {
    await writeFile(join(fixture.artifact, 'changelog-release.json'), `${JSON.stringify({
      schema_version: 1,
      candidate: false,
      release: null,
    }, null, 2)}\n`, 'utf8')
    assert.throws(() => run(fixture, ['create', '--kind', 'public', '--sha', sha]), /require a candidate changelog/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('marks public fallback artifacts as non-deployable', async () => {
  const fixture = await createFixture('public', 'public_fallback')
  try {
    run(fixture, ['create', '--kind', 'public', '--sha', sha])
    const manifest = JSON.parse(await readFile(join(fixture.artifact, 'build-manifest.json'), 'utf8'))
    assert.equal(manifest.deployable, false)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('allows an immutable deployment worktree only when explicitly requested', async () => {
  const fixture = await createFixture('public')
  try {
    run(fixture, ['create', '--kind', 'public', '--sha', sha])
    await writeFile(join(fixture.artifact, 'README.md'), 'source tree only\n', 'utf8')
    assert.throws(() => run(fixture, ['verify', '--kind', 'public', '--sha', sha]), /unexpected public artifact entry.*README\.md/)
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

async function createFixture(kind, sourceMode = 'full') {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'goofish-release-'))
  const source = join(fixtureRoot, 'source')
  const artifact = join(fixtureRoot, 'artifact')
  await mkdir(join(source, 'src/lib/.generated'), { recursive: true })
  await mkdir(artifact, { recursive: true })
  await writeFile(join(source, 'src/lib/.generated/build-meta.ts'), `export const APP_BUILD_META = ${JSON.stringify(buildMeta(sourceMode), null, 2)} as const;\n`, 'utf8')
  await writeRequiredFiles(artifact, kind, sourceMode)
  return { root: fixtureRoot, source, artifact }
}

function buildMeta(sourceMode = 'full') {
  return {
    frontend_version: '2.0.1', backend_version: '2.0.1', data_version: 'data.1.0123456',
    expected_backend_version: '2.0.1', source_mode: sourceMode, source_schema_version: 1,
    data_content_sha256: 'a'.repeat(64), data_source_updated_at: '2026-07-18T00:00:00.000Z',
    build_generated_at: '2026-07-18T00:00:00.000Z', generated_at: '2026-07-18T00:00:00.000Z',
    source_summary: 'fixture', git_sha: sha, build_context: 'test',
  }
}

async function writeRequiredFiles(artifact, kind, sourceMode = 'full') {
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
    } else if (path === 'package.json') {
      await writeFile(target, `${JSON.stringify({
        name: 'fixture', version: '2.0.0', type: 'module', engines: { node: '>=24 <25' },
        dependencies: { '@aws-sdk/client-sesv2': '1.0.0', '@node-rs/argon2': '1.0.0', pg: '1.0.0', qrcode: '1.0.0' },
      })}\n`, 'utf8')
    } else if (path === 'package-lock.json') {
      await writeFile(target, `${JSON.stringify({
        name: 'fixture', lockfileVersion: 3,
        packages: {
          '': { name: 'fixture', version: '2.0.0' },
          'node_modules/@aws-sdk/client-sesv2': { version: '1.0.0' },
          'node_modules/@node-rs/argon2': { version: '1.0.0' },
          'node_modules/pg': { version: '1.0.0' },
          'node_modules/qrcode': { version: '1.0.0' },
        },
      })}\n`, 'utf8')
    } else if (path === 'release-sbom.cdx.json') {
      await writeFile(target, `${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', components: [{ name: 'pg', version: '1.0.0' }] })}\n`, 'utf8')
    } else {
      await writeFile(target, path.endsWith('.html') ? '<!doctype html>' : path.endsWith('.js') ? `/*! APP_BUILD_META ${JSON.stringify(buildMeta(sourceMode))} */\nexport {}` : 'export {}', 'utf8')
    }
  }
  await mkdir(join(artifact, 'dist/assets'), { recursive: true })
  await writeFile(join(artifact, 'dist/assets/main.js'), `/*! APP_BUILD_META ${JSON.stringify(buildMeta(sourceMode))} */\nexport {}`)
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
