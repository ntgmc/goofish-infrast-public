import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { ARTIFACT_KINDS } from './release-artifact-config.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const script = join(repositoryRoot, 'scripts/stage-release-artifact.mjs')

test('publishes staging atomically and preserves the previous tree after a copy failure', async () => {
  const fixture = await createFixture()
  try {
    runStage(fixture)
    const stagedIndex = join(fixture.output, 'dist/index.html')
    assert.equal(await readFile(stagedIndex, 'utf8'), 'version-one')

    await writeFile(join(fixture.source, 'dist/index.html'), 'version-two', 'utf8')
    await rm(join(fixture.source, 'server/dist/routes.js'))
    assert.throws(() => runStage(fixture), /routes\.js/)
    assert.equal(await readFile(stagedIndex, 'utf8'), 'version-one')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('rejects symbolic links in the source tree and destination ancestry', async () => {
  const fixture = await createFixture()
  try {
    const smokePath = join(fixture.source, 'scripts/check-release-runtime.mjs')
    await rm(smokePath)
    await symlink(join(fixture.source, 'package.json'), smokePath)
    assert.throws(() => runStage(fixture), /symbolic link|regular file/)

    const outside = await mkdtemp(join(tmpdir(), 'goofish-stage-outside-'))
    await symlink(outside, join(fixture.source, 'linked-output'))
    assert.throws(() => runStage({ ...fixture, output: join(fixture.source, 'linked-output/public') }), /symbolic link/)
    await rm(outside, { recursive: true, force: true })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'goofish-stage-'))
  const source = join(root, 'source')
  const output = join(source, '.release-staging/public')
  await mkdir(source, { recursive: true })
  for (const path of ARTIFACT_KINDS.public.required) {
    const target = join(source, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, path === 'dist/index.html' ? 'version-one' : path, 'utf8')
  }
  return { root, source, output }
}

function runStage(fixture) {
  const result = spawnSync(process.execPath, [script, '--kind', 'public', '--output', fixture.output], {
    cwd: repositoryRoot,
    env: { ...process.env, RELEASE_SOURCE_ROOT: fixture.source },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
}
