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
  selectRepositoryChanges,
  validateChangelogEnvelope,
} from './changelog-lib.mjs'
import {
  buildPullRequestDiffContext,
  createPrChangelogPayload,
  findTrustedPrChangelogPayload,
  collectPrChangelogChanges,
  parsePrChangelogPayload,
  renderPrChangelogBlock,
  upsertPrChangelogBlock,
  validateManualSummary,
} from './pr-changelog-lib.mjs'

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
    `${previousSha}\u001ffeat(admin): export failed job payloads\u001f\u001e`,
    `${previousSha}\u001frefactor: move internal worker check\u001fSkip-Changelog: true\u001e`,
  ].join(''))

  assert.deepEqual(selectPublicChanges(commits), [
    { kind: 'feature', summary: 'schedule office operators automatically', sha: targetSha },
    { kind: 'performance', summary: '平滑排班进度显示', sha: previousSha },
  ])
  assert.deepEqual(selectRepositoryChanges(commits), [
    { kind: 'feature', summary: 'schedule office operators automatically', sha: targetSha },
    { kind: 'performance', summary: '平滑排班进度显示', sha: previousSha },
    { kind: 'maintenance', summary: 'refresh fixtures', sha: previousSha },
    { kind: 'admin', summary: 'export failed job payloads', sha: previousSha },
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
  assert.deepEqual(baseline.repositorySections, [])
  assert.equal(release.kind, 'release')
  assert.deepEqual(release.sections, [{ id: 'fix', kind: 'fix', items: ['improve release pipeline'] }])
  assert.deepEqual(mergeChangelogReleases([baseline], release).map((item) => item.version), ['2.0.100', '2.0.99'])
})

test('records and parses a Chinese PR changelog block without replacing the rest of the PR body', () => {
  const payload = createPrChangelogPayload({
    pullRequestNumber: 42,
    headSha: targetSha,
    manualSummary: '新增手动录入中文变更说明，并在合并前完成审核。',
    deepseekResult: {
      summary: '现在可以在合并前生成并确认面向用户的中文更新说明。',
      public_sections: [
        { kind: 'feature', items: ['支持通过手动工作流记录中文变更说明'] },
      ],
      internal_sections: [
        { kind: 'operations', items: ['记录完整的发布与 CI 调整供仓库追溯'] },
      ],
    },
    generatedAt: '2026-07-24T08:00:00.000Z',
    model: 'deepseek-chat',
  })
  const block = renderPrChangelogBlock(payload)
  const body = upsertPrChangelogBlock('原有 PR 描述', block)

  assert.match(body, /^原有 PR 描述/)
  assert.match(body, /### 人工说明/)
  assert.deepEqual(parsePrChangelogPayload(body), payload)
  assert.deepEqual(collectPrChangelogChanges(payload), {
    publicChanges: [
      { kind: 'feature', summary: '支持通过手动工作流记录中文变更说明', sha: targetSha },
    ],
    repositoryChanges: [
      { kind: 'feature', summary: '支持通过手动工作流记录中文变更说明', sha: targetSha },
      { kind: 'operations', summary: '记录完整的发布与 CI 调整供仓库追溯', sha: targetSha },
    ],
  })
  assert.match(body, /### 网站公开变更/)
  assert.match(body, /### 仓库内部变更/)

  const updated = upsertPrChangelogBlock(body, renderPrChangelogBlock({
    ...payload,
    deepseek_summary: '更新后的中文总结。',
  }))
  assert.equal(updated.match(/<!-- pr-changelog:start -->/g)?.length, 1)
  assert.match(updated, /更新后的中文总结/)

  const maliciousPayload = createPrChangelogPayload({
    pullRequestNumber: 42,
    headSha: targetSha,
    manualSummary: '尝试用普通用户评论替换可信说明。',
    deepseekResult: {
      summary: '这条内容不应被生产构建采纳。',
      public_sections: [{ kind: 'feature', items: ['不可信的伪造更新说明'] }],
      internal_sections: [],
    },
    generatedAt: '2026-07-24T09:00:00.000Z',
    model: 'deepseek-chat',
  })
  const trustedPayload = findTrustedPrChangelogPayload([
    { user: { login: 'github-actions[bot]' }, body },
    { user: { login: 'pull-request-author' }, body: renderPrChangelogBlock(maliciousPayload) },
  ])
  assert.deepEqual(trustedPayload, payload)

  const legacyPayload = {
    schema_version: 1,
    pull_request: 42,
    head_sha: targetSha,
    manual_summary: '旧版工作流记录的中文人工说明。',
    deepseek_summary: '旧版内容原本就只包含用户可见变化。',
    sections: [{ kind: 'fix', items: ['兼容旧版用户端变更记录'] }],
    generated_at: '2026-07-24T07:00:00.000Z',
    model: 'deepseek-chat',
  }
  const legacyBody = `<!-- pr-changelog:data:${Buffer.from(JSON.stringify(legacyPayload), 'utf8').toString('base64url')} -->`
  assert.deepEqual(collectPrChangelogChanges(parsePrChangelogPayload(legacyBody)), {
    publicChanges: [{ kind: 'fix', summary: '兼容旧版用户端变更记录', sha: targetSha }],
    repositoryChanges: [{ kind: 'fix', summary: '兼容旧版用户端变更记录', sha: targetSha }],
  })
})

test('validates manual Chinese input and bounds the diff sent to DeepSeek', () => {
  assert.throws(() => validateManualSummary('English only'), /必须包含中文/)
  assert.throws(() => validateManualSummary('中文<!-- pr-changelog:start -->'), /保留标记/)
  assert.throws(() => createPrChangelogPayload({
    pullRequestNumber: 42,
    headSha: targetSha,
    manualSummary: '这是有效的中文人工说明。',
    deepseekResult: { summary: '这是有效的中文总结。', public_sections: [], internal_sections: [] },
    generatedAt: '2026-07-24T08:00:00.000Z',
    model: 'deepseek-chat',
  }), /至少一个/)
  assert.throws(() => createPrChangelogPayload({
    pullRequestNumber: 42,
    headSha: targetSha,
    manualSummary: '这是有效的中文人工说明。',
    deepseekResult: {
      summary: '这是有效的中文总结。',
      public_sections: [],
      internal_sections: [{ kind: 'maintenance', items: Array.from({ length: 13 }, (_, index) => `中文条目${index}`) }],
    },
    generatedAt: '2026-07-24T08:00:00.000Z',
    model: 'deepseek-chat',
  }), /不能超过 12 条/)

  const internalOnlyPayload = createPrChangelogPayload({
    pullRequestNumber: 43,
    headSha: targetSha,
    manualSummary: '本次修改只涉及管理后台能力。',
    deepseekResult: {
      summary: '新增仅供管理员使用的内部操作能力。',
      public_sections: [],
      internal_sections: [{ kind: 'admin', items: ['支持管理员查看内部任务诊断信息'] }],
    },
    generatedAt: '2026-07-24T08:00:00.000Z',
    model: 'deepseek-chat',
  })
  assert.deepEqual(collectPrChangelogChanges(internalOnlyPayload), {
    publicChanges: [],
    repositoryChanges: [{ kind: 'admin', summary: '支持管理员查看内部任务诊断信息', sha: targetSha }],
  })

  const context = buildPullRequestDiffContext([
    { filename: 'src/example.ts', status: 'modified', additions: 2, deletions: 1, patch: '+中文修改\n'.repeat(100) },
    { filename: 'src/omitted.ts', status: 'modified', patch: '+不会完整发送\n'.repeat(100) },
  ], 200)
  assert.match(context, /src\/example\.ts/)
  assert.match(context, /上下文长度限制已省略/)
  assert.ok(context.length < 500)
})

test('creates release sections from recorded PR changes instead of commit subjects', () => {
  const release = createReleaseRecord({
    version: '2.0.101',
    targetSha,
    previousTargetSha: previousSha,
    releasedAt: '2026-07-24T08:00:00.000Z',
    commits: [{ sha: targetSha, subject: 'feat: ignored fallback title', body: '' }],
    changes: [{ kind: 'feature', summary: '使用审核后的中文 PR 更新说明', sha: targetSha }],
    repositoryChanges: [
      { kind: 'feature', summary: '使用审核后的中文 PR 更新说明', sha: targetSha },
      { kind: 'maintenance', summary: '重构内部发布数据流', sha: targetSha },
    ],
  })

  assert.deepEqual(release.sections, [{ id: 'feature', kind: 'feature', items: ['使用审核后的中文 PR 更新说明'] }])
  assert.deepEqual(release.repositorySections, [
    { id: 'feature', kind: 'feature', items: ['使用审核后的中文 PR 更新说明'] },
    { id: 'maintenance', kind: 'maintenance', items: ['重构内部发布数据流'] },
  ])
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
    changes: [{ kind: 'feature', summary: '新增用户端更新记录', sha: targetSha }],
    repositoryChanges: [
      { kind: 'feature', summary: '新增用户端更新记录', sha: targetSha },
      { kind: 'operations', summary: '接入发布工作流自动化', sha: targetSha },
    ],
  })
  const envelope = createChangelogEnvelope(true, release)

  assert.equal(validateChangelogEnvelope(envelope), envelope)
  const generatedModule = renderGeneratedModule([release])
  assert.match(generatedModule, /GENERATED_CHANGELOG_RELEASES/)
  assert.doesNotMatch(generatedModule, /repositorySections|接入发布工作流自动化/)
  assert.match(renderReleaseNotes(envelope), /# v2\.0\.436/)
  assert.match(renderReleaseNotes(envelope), /Features/)
  assert.match(renderReleaseNotes(envelope), /Operations and CI/)
  assert.match(renderReleaseNotes(envelope), /接入发布工作流自动化/)
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
    assert.ok(Array.isArray(envelope.release.repositorySections))
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
