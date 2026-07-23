import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  createChangelogEnvelope,
  createReleaseRecord,
  mergeChangelogReleases,
  parseGitLog,
  renderGeneratedModule,
  renderReleaseNotes,
  selectPublicChanges,
  validateChangelogEnvelope,
} from './changelog-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generatorPath = join(root, 'scripts/generate-changelog.mjs')
const buildMetaPath = join(root, 'src/lib/.generated/build-meta.ts')
const generatedModulePath = join(root, 'src/lib/.generated/changelog.ts')
const releaseRecordPath = join(root, 'changelog-release.json')
const releaseNotesPath = join(root, 'changelog-release.md')
const previousSha = '0123456789abcdef0123456789abcdef01234567'
const targetSha = 'abcdef0123456789abcdef0123456789abcdef01'

test('groups conventional commits and explicit release note trailers', () => {
  const commits = parseGitLog([
    `${targetSha}\u001ffeat(optimize): schedule office operators automatically\u001f\u001e`,
    `${previousSha}\u001ffix: smooth schedule progress updates\u001fRelease-Note: 平滑排班进度显示\nRelease-Note-Type: performance\u001e`,
    `${previousSha}\u001fchore: refresh fixtures\u001f\u001e`,
    `${previousSha}\u001frefactor: move internal worker check\u001fSkip-Changelog: true\u001e`,
  ].join(''))

  assert.deepEqual(selectPublicChanges(commits), [
    { kind: 'feature', summary: 'schedule office operators automatically', sha: targetSha },
    { kind: 'performance', summary: '平滑排班进度显示', sha: previousSha },
  ])
})

test('creates a baseline before the first published release and orders same-day build labels numerically', () => {
  const baseline = createReleaseRecord({
    version: '2.0.99',
    targetSha: previousSha,
    releasedAt: '2026-07-23T00:00:00.000Z',
  })
  const release = createReleaseRecord({
    version: '2.0.100',
    targetSha,
    previousTargetSha: previousSha,
    releasedAt: '2026-07-23T12:00:00.000Z',
    commits: [{ sha: targetSha, subject: 'fix: improve release pipeline', body: '' }],
  })

  assert.equal(baseline.kind, 'baseline')
  assert.deepEqual(baseline.sections, [])
  assert.equal(release.kind, 'release')
  assert.deepEqual(release.sections, [{ id: 'fix', kind: 'fix', items: ['improve release pipeline'] }])
  assert.deepEqual(mergeChangelogReleases([baseline], release).map((item) => item.version), ['2.0.100', '2.0.99'])
})

test('rejects a release that uses its target SHA as its previous boundary', () => {
  assert.throws(() => createReleaseRecord({
    version: '2.0.100',
    targetSha,
    previousTargetSha: targetSha,
    releasedAt: '2026-07-23T12:00:00.000Z',
  }), /must differ/)
})

test('renders a typed generated module and matching release note envelope', () => {
  const release = createReleaseRecord({
    version: '2.0.436',
    targetSha,
    previousTargetSha: previousSha,
    releasedAt: '2026-07-24T00:00:00.000Z',
    commits: [{ sha: targetSha, subject: 'feat: add changelog automation', body: '' }],
  })
  const envelope = createChangelogEnvelope(true, release)

  assert.equal(validateChangelogEnvelope(envelope), envelope)
  assert.match(renderGeneratedModule([release]), /GENERATED_CHANGELOG_RELEASES/)
  assert.match(renderReleaseNotes(envelope), /# v2\.0\.436/)
  assert.match(renderReleaseNotes(envelope), /Features/)
})

test('generates a production baseline candidate without requiring Git history', async () => {
  const currentSha = runGit(['rev-parse', 'HEAD'])
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'goofish-changelog-'))
  const historyPath = join(temporaryDirectory, 'history.json')
  const snapshots = await Promise.all([
    snapshotFile(buildMetaPath),
    snapshotFile(generatedModulePath),
    snapshotFile(releaseRecordPath),
    snapshotFile(releaseNotesPath),
  ])

  try {
    await mkdir(dirname(buildMetaPath), { recursive: true })
    await writeFile(historyPath, '[]\n', 'utf8')
    await writeFile(buildMetaPath, `export const APP_BUILD_META = ${JSON.stringify({
      frontend_version: '2.0.999',
      backend_version: '2.0.999',
      data_version: 'data.999.fixture',
      generated_at: '2026-07-23T12:00:00.000Z',
      source_summary: 'fixture',
      git_sha: currentSha,
      build_context: 'test',
    }, null, 2)} as const;\n`, 'utf8')

    const result = spawnSync(process.execPath, [generatorPath], {
      cwd: root,
      env: {
        ...process.env,
        GENERATE_CHANGELOG_CANDIDATE: 'true',
        CHANGELOG_HISTORY_FILE: historyPath,
        CHANGELOG_BASE_SHA: '',
      },
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const envelope = JSON.parse(await readFile(releaseRecordPath, 'utf8'))
    assert.equal(envelope.candidate, true)
    assert.equal(envelope.release.id, 'v2.0.999')
    assert.equal(envelope.release.version, '2.0.999')
    assert.equal(envelope.release.displayVersion, 'v2.0.999')
    assert.equal(envelope.release.releasedAt, '2026-07-23')
    assert.equal(envelope.release.targetSha, currentSha)
    assert.equal(envelope.release.previousTargetSha, null)
    assert.equal(envelope.release.kind, 'baseline')
    assert.ok(Array.isArray(envelope.release.sections))
    assert.match(await readFile(releaseNotesPath, 'utf8'), /^# v2\.0\.999/m)
    assert.match(await readFile(releaseNotesPath, 'utf8'), /## Baseline/)
    assert.match(await readFile(generatedModulePath, 'utf8'), /v2\.0\.999/)
  } finally {
    await Promise.all([
      restoreFile(buildMetaPath, snapshots[0]),
      restoreFile(generatedModulePath, snapshots[1]),
      restoreFile(releaseRecordPath, snapshots[2]),
      restoreFile(releaseNotesPath, snapshots[3]),
      rm(temporaryDirectory, { recursive: true, force: true }),
    ])
  }
})

function runGit(argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

async function snapshotFile(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

async function restoreFile(path, content) {
  if (content === null) {
    await rm(path, { force: true })
    return
  }
  await writeFile(path, content, 'utf8')
}
