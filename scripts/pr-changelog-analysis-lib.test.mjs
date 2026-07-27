import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCommitAnalysisChunks,
  buildChangeExtractionMessages,
  buildReductionFacts,
  comparePublicSourceLocks,
  compactPatch,
  normalizeChangeExtraction,
  normalizeReductionResult,
  parseGitHubRepository,
  parsePublicSourceLock,
  validatePublicComparisonStatus,
} from './pr-changelog-analysis-lib.mjs'

const sha = 'abcdef0123456789abcdef0123456789abcdef01'

test('compacts unchanged diff context while preserving changed lines and hunk headers', () => {
  const compacted = compactPatch([
    '@@ -1,5 +1,5 @@',
    ' unchanged before',
    '-old behavior',
    '+new behavior',
    ' unchanged after',
  ].join('\n'))

  assert.match(compacted, /@@ -1,5 \+1,5 @@/)
  assert.match(compacted, /-old behavior/)
  assert.match(compacted, /\+new behavior/)
  assert.match(compacted, /unchanged context lines omitted/)
  assert.doesNotMatch(compacted, /^ unchanged before$/m)
})

test('includes PR intent only when supplied for a direct single-chunk analysis', () => {
  const chunk = { id: 'U1C1', fileIds: ['F1'], context: '[F1]\npath=src/feature.ts' }
  const messages = buildChangeExtractionMessages({
    pullRequestTitle: 'feat: add workflow',
    pullRequestBody: '实现新的用户流程。',
    manualSummary: '请重点说明用户可以完成新操作。',
    chunk,
  })
  assert.match(messages[1].content, /PR 正文：实现新的用户流程/)
  assert.match(messages[1].content, /维护者说明：请重点说明用户可以完成新操作/)
  const compactMessages = buildChangeExtractionMessages({ pullRequestTitle: 'feat: add workflow', chunk })
  assert.doesNotMatch(compactMessages[1].content, /PR 正文|维护者说明/)
})

test('splits oversized commits without dropping file segments and omits lockfile payloads', () => {
  const largePatch = ['@@ -1 +1 @@', ...Array.from({ length: 900 }, (_, index) => `+changed line ${index}`)].join('\n')
  const lockPatch = `+${'dependency metadata '.repeat(400)}`
  const chunks = buildCommitAnalysisChunks([{
    source: 'private',
    repository: 'owner/private',
    sha,
    subject: 'feat: large change',
    files: [
      { filename: 'src/feature.ts', status: 'modified', additions: 900, deletions: 0, patch: largePatch },
      { filename: 'package-lock.json', status: 'modified', additions: 1, deletions: 0, patch: lockPatch },
    ],
  }], 4000)

  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.context.length <= 4000))
  assert.equal(new Set(chunks.flatMap((chunk) => chunk.fileIds)).size, chunks.flatMap((chunk) => chunk.fileIds).length)
  assert.match(chunks.map((chunk) => chunk.context).join('\n'), /path=src\/feature\.ts/)
  assert.match(chunks.map((chunk) => chunk.context).join('\n'), /generated or lockfile patch omitted/)
  assert.doesNotMatch(chunks.map((chunk) => chunk.context).join('\n'), /dependency metadata dependency metadata/)
  assert.ok(chunks[0].compactedChars < chunks[0].originalChars)
})

test('rejects map results that do not account for every file ID', () => {
  const chunk = {
    id: 'U1C1',
    source: 'private',
    repository: 'owner/private',
    sha,
    fileIds: ['F1', 'F2'],
  }
  const valid = {
    summary: '完成用户功能与测试调整。',
    files: [
      { id: 'F1', change_ids: ['C1'] },
      { id: 'F2', reason: '仅为对应测试更新' },
    ],
    changes: [{ id: 'C1', audience: 'public', kind: 'feature', summary: '新增用户可见功能。' }],
  }

  assert.equal(normalizeChangeExtraction(valid, chunk).changes.length, 1)
  assert.throws(
    () => normalizeChangeExtraction({ ...valid, files: valid.files.slice(0, 1) }, chunk),
    /遗漏文件：F2/,
  )
})

test('requires reduce results to consume every deduplicated source fact exactly once', () => {
  const facts = buildReductionFacts([
    { changes: [{ id: 'U1C1:C1', audience: 'public', kind: 'fix', summary: '修复用户提交失败的问题。' }] },
    { changes: [{ id: 'U2C1:C1', audience: 'internal', kind: 'maintenance', summary: '补充对应自动化测试。' }] },
  ])
  const valid = {
    summary: '修复用户提交问题并补充回归测试。',
    public_sections: [{ kind: 'fix', items: [{ text: '修复用户提交失败的问题。', source_ids: ['S1'] }] }],
    internal_sections: [],
    discarded_sources: [{ id: 'S2', reason: '测试变更已由修复条目涵盖' }],
  }

  assert.equal(normalizeReductionResult(valid, facts).public_sections[0].items.length, 1)
  assert.throws(
    () => normalizeReductionResult({ ...valid, discarded_sources: [] }, facts),
    /遗漏事实：S2/,
  )
})

test('parses public source locks and supported GitHub repository references', () => {
  assert.equal(parseGitHubRepository('https://github.com/owner/public.git'), 'owner/public')
  assert.equal(parseGitHubRepository('git@github.com:owner/public.git'), 'owner/public')
  assert.deepEqual(parsePublicSourceLock({
    schema_version: 1,
    public_repository: 'https://github.com/owner/public.git',
    public_commit: sha.toUpperCase(),
    optimizer_port_version: 2,
  }), {
    repository: 'owner/public',
    commit: sha,
    optimizerPortVersion: 2,
  })
})

test('builds only fast-forward public source ranges from lock updates', () => {
  const base = {
    schema_version: 1,
    public_repository: 'owner/public',
    public_commit: '0123456789abcdef0123456789abcdef01234567',
    optimizer_port_version: 1,
  }
  const head = { ...base, public_commit: sha, optimizer_port_version: 2 }
  assert.deepEqual(comparePublicSourceLocks(base, head), {
    repository: 'owner/public',
    base: base.public_commit,
    head: sha,
    optimizerPortChanged: true,
  })
  assert.equal(validatePublicComparisonStatus('ahead'), true)
  assert.equal(validatePublicComparisonStatus('identical'), false)
  assert.throws(() => validatePublicComparisonStatus('diverged'), /必须快进更新/)
  assert.throws(
    () => comparePublicSourceLocks(base, { ...head, public_repository: 'owner/other' }),
    /不得.*切换公共仓库/,
  )
})
