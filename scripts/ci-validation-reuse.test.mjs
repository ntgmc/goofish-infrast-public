import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { VALIDATION_JOBS, findReusableValidation, githubApi, recordValidation, resolveValidationReuse, validationKeys } from './ci-validation-reuse.mjs'

const repository = 'owner/public'
const key = 'a'.repeat(64)
const env = { GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: '200', GITHUB_EVENT_NAME: 'push', RUNNER_OS: 'Linux' }

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ci-validation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  git(root, 'init', '--quiet')
  await writeFile(join(root, 'source.ts'), 'public source')
  commit(root)
  return root
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function commit(root) {
  git(root, 'add', '--all')
  git(root, '-c', 'user.name=CI Test', '-c', 'user.email=ci@example.test', 'commit', '--quiet', '--allow-empty', '-m', 'fixture')
}

function proof(kind = 'public') {
  return {
    artifact: {
      name: `ci-validation-${kind}-${key}`, expired: false,
      workflow_run: { id: 100 }, created_at: '2026-10-23T10:00:10Z',
    },
    run: {
      id: 100, repository: { full_name: repository }, head_repository: { full_name: repository },
      path: '.github/workflows/quality-checks.yml', event: 'pull_request', head_branch: 'dev',
      status: 'completed', conclusion: 'success', run_attempt: 2,
      html_url: 'https://github.com/owner/public/actions/runs/100',
    },
    job: {
      name: VALIDATION_JOBS[kind], status: 'completed', conclusion: 'success',
      started_at: '2026-10-23T10:00:00Z', completed_at: '2026-10-23T10:00:20Z',
    },
  }
}

function apiFor({ artifact, run, job }, calls = []) {
  return async (path) => {
    calls.push(path)
    if (path.includes('/artifacts?')) return { artifacts: [artifact] }
    if (path.endsWith('/runs/100')) return run
    if (path.endsWith('/attempts/2/jobs?per_page=100')) return { jobs: [job] }
    assert.fail(`Unexpected API request: ${path}`)
  }
}

function lookup(data, calls, kind = 'public') {
  return findReusableValidation(kind, key, { api: apiFor(data, calls), repository, runId: env.GITHUB_RUN_ID })
}

test('reuses identical trees even when merge commit SHAs differ', async (t) => {
  const root = await fixture(t)
  const before = validationKeys(root, env)
  const sha = git(root, 'rev-parse', 'HEAD')
  git(root, '-c', 'user.name=CI Test', '-c', 'user.email=ci@example.test', 'commit', '--quiet', '--allow-empty', '-m', 'merge')
  assert.notEqual(git(root, 'rev-parse', 'HEAD'), sha)
  assert.deepEqual(validationKeys(root, env), before)
  assert.equal(new Set(Object.values(before)).size, Object.keys(VALIDATION_JOBS).length)
})

test('any committed input change invalidates every validation kind', async (t) => {
  const root = await fixture(t)
  const before = validationKeys(root, env)
  await writeFile(join(root, 'source.ts'), 'changed public source')
  commit(root)
  const after = validationKeys(root, env)
  for (const kind of Object.keys(before)) assert.notEqual(after[kind], before[kind])
})

for (const input of ['GITHUB_REPOSITORY', 'RUNNER_OS', 'RUNNER_ARCH', 'ImageOS']) {
  test(`${input} changes invalidate every validation key`, async (t) => {
    const root = await fixture(t)
    const before = validationKeys(root, env)
    const after = validationKeys(root, { ...env, [input]: 'different' })
    for (const kind of Object.keys(before)) assert.notEqual(after[kind], before[kind])
  })
}

for (const kind of Object.keys(VALIDATION_JOBS)) {
  test(`requires a successful ${kind} job from the latest workflow attempt`, async () => {
    const data = proof(kind)
    const calls = []
    assert.equal(await lookup(data, calls, kind), data.run.html_url)
    assert.ok(calls.some((path) => path.includes('/attempts/2/jobs?')))
  })
}

const rejectedProofs = {
  'expired record': (data) => { data.artifact.expired = true },
  'wrong fingerprint': (data) => { data.artifact.name += '-wrong' },
  'current workflow run': (data) => { data.artifact.workflow_run.id = 200 },
  'missing source run': (data) => { delete data.artifact.workflow_run },
  'fork PR': (data) => { data.run.head_repository.full_name = 'fork/public' },
  'different repository': (data) => { data.run.repository.full_name = 'owner/other' },
  'unrelated workflow': (data) => { data.run.path = '.github/workflows/other.yml' },
  'failed workflow': (data) => { data.run.conclusion = 'failure' },
  'running workflow': (data) => { data.run.status = 'in_progress' },
  'unsupported event': (data) => { data.run.event = 'pull_request_target' },
  'untrusted push branch': (data) => { data.run.event = 'push'; data.run.head_branch = 'feature' },
  'missing workflow attempt': (data) => { delete data.run.run_attempt },
  'skipped job': (data) => { data.job.conclusion = 'skipped' },
  'failed job': (data) => { data.job.conclusion = 'failure' },
  'running job': (data) => { data.job.status = 'in_progress' },
  'wrong job': (data) => { data.job.name = 'PostgreSQL Integration' },
  'record from previous attempt': (data) => { data.artifact.created_at = '2026-10-23T09:00:00Z' },
  'record outside job lifetime': (data) => { data.artifact.created_at = '2026-10-23T11:00:00Z' },
  'missing record timestamp': (data) => { delete data.artifact.created_at },
}
for (const [name, change] of Object.entries(rejectedProofs)) {
  test(`does not reuse ${name}`, async () => {
    const data = proof()
    change(data)
    assert.equal(await lookup(data), null)
  })
}

for (const event of ['push', 'workflow_dispatch']) {
  test(`accepts successful ${event} evidence from main`, async () => {
    const data = proof()
    data.run.event = event
    data.run.head_branch = 'main'
    assert.equal(await lookup(data), data.run.html_url)
  })
}

test('writes successful reuse decisions and links their original run', async (t) => {
  const root = await fixture(t)
  const keys = validationKeys(root, env)
  const output = join(root, 'outputs')
  const summary = join(root, 'summary')
  const data = proof()
  const result = await resolveValidationReuse({
    root, env: { ...env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
    api: async (path) => {
      if (path.includes('/artifacts?')) {
        const name = new URL(`https://api.github.com${path}`).searchParams.get('name')
        return { artifacts: [{ ...data.artifact, name }] }
      }
      if (path.endsWith('/runs/100')) return data.run
      return { jobs: Object.values(VALIDATION_JOBS).map((name) => ({ ...data.job, name })) }
    },
  })
  assert.ok(Object.values(result.sources).every((url) => url === data.run.html_url))
  const text = await readFile(output, 'utf8')
  for (const [kind, value] of Object.entries(keys)) {
    assert.ok(text.includes(`${kind}_key=${value}\nreuse_${kind}=true\n`))
  }
  assert.ok((await readFile(summary, 'utf8')).includes(data.run.html_url))
})

test('missing validation records run the checks', async () => {
  assert.equal(await findReusableValidation('public', key, {
    api: async () => ({ artifacts: [] }), repository, runId: env.GITHUB_RUN_ID,
  }), null)
})

test('shares concurrent GitHub requests and supplies authentication and a timeout', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++
    assert.equal(url, 'https://api.github.com/example')
    assert.equal(options.headers.authorization, 'Bearer test-token')
    assert.ok(options.signal instanceof AbortSignal)
    return { ok: true, json: async () => ({ jobs: [] }) }
  })
  const api = githubApi({ GITHUB_TOKEN: 'test-token' })
  const results = await Promise.all([api('/example'), api('/example')])
  assert.deepEqual(results, [{ jobs: [] }, { jobs: [] }])
  assert.equal(calls, 1)
})

test('GitHub HTTP errors do not become validation evidence', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }))
  await assert.rejects(githubApi({ GITHUB_TOKEN: 'test-token' })('/example'), /HTTP 403/)
})

test('API errors fall back to running all checks and write explicit false outputs', async (t) => {
  const root = await fixture(t)
  const output = join(root, 'outputs')
  const result = await resolveValidationReuse({
    root, env: { ...env, GITHUB_OUTPUT: output },
    api: async () => { throw new Error('HTTP 503') },
  })
  assert.ok(Object.values(result.sources).every((source) => source === null))
  const text = await readFile(output, 'utf8')
  for (const kind of Object.keys(result.keys)) assert.ok(text.includes(`reuse_${kind}=false\n`))
})

test('manual runs always validate without an API lookup', async (t) => {
  const root = await fixture(t)
  const result = await resolveValidationReuse({
    root, env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' },
    api: async () => assert.fail('Unexpected API lookup'),
  })
  assert.ok(Object.values(result.sources).every((source) => source === null))
})

test('records validation across hosted runner image revisions', async (t) => {
  const root = await fixture(t)
  const decisionEnv = { ...env, RUNNER_ARCH: 'X64', ImageOS: 'ubuntu24', ImageVersion: '20261025.353.1' }
  const { keys } = await resolveValidationReuse({
    root, env: decisionEnv, api: async () => ({ artifacts: [] }),
  })
  const recordEnv = { ...decisionEnv, ImageVersion: '20261012.334.1', RUNNER_TEMP: root }
  assert.deepEqual(validationKeys(root, recordEnv), keys)
  for (const kind of Object.keys(VALIDATION_JOBS)) {
    await recordValidation(kind, keys[kind], { root, env: recordEnv })
    const record = JSON.parse(await readFile(join(root, `ci-validation/${kind}.json`), 'utf8'))
    assert.equal(record.kind, kind)
    assert.equal(record.key, keys[kind])
  }
})

test('records only matching validation inputs', async (t) => {
  const root = await fixture(t)
  const keys = validationKeys(root, env)
  await recordValidation('public', keys.public, { root, env: { ...env, RUNNER_TEMP: root } })
  const record = JSON.parse(await readFile(join(root, 'ci-validation/public.json'), 'utf8'))
  assert.equal(record.key, keys.public)
  await assert.rejects(recordValidation('public', 'wrong', { root, env: { ...env, RUNNER_TEMP: root } }), /inputs changed/)
  await assert.rejects(recordValidation('unknown', key, { root, env }), /Unknown validation/)
  await assert.rejects(recordValidation('public', keys.public, { root, env }), /RUNNER_TEMP/)
  await writeFile(join(root, 'source.ts'), 'new input')
  commit(root)
  await assert.rejects(recordValidation('public', keys.public, { root, env }), /inputs changed/)
})
