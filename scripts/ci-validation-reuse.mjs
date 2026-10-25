import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const VALIDATION_JOBS = Object.freeze({
  public: 'Public Build, Tests, and Boundaries',
  postgres: 'PostgreSQL Integration',
  security: 'Static Security Analysis / Semgrep SAST',
})

export function validationKeys(root = '.', env = process.env) {
  const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' })
  if (tree.status !== 0) throw new Error('Cannot resolve the checked-out validation tree')
  return Object.fromEntries(Object.keys(VALIDATION_JOBS).map((kind) => [kind,
    createHash('sha256').update(JSON.stringify({
      schema: 1,
      repository: env.GITHUB_REPOSITORY || '',
      runner_os: env.RUNNER_OS || '',
      runner_arch: env.RUNNER_ARCH || '',
      image_os: env.ImageOS || '',
      image_version: env.ImageVersion || '',
      kind,
      tree: tree.stdout.trim(),
    })).digest('hex'),
  ]))
}

export async function findReusableValidation(kind, key, { api, repository, runId }) {
  const name = `ci-validation-${kind}-${key}`
  const { artifacts } = await api(`/repos/${repository}/actions/artifacts?name=${name}&per_page=100`)
  // shortcut: inspect five recent records; expand if frequent reruns cause avoidable misses.
  for (const artifact of artifacts.slice(0, 5)) {
    if (artifact.name !== name || artifact.expired !== false || !artifact.workflow_run?.id) continue
    if (String(artifact.workflow_run.id) === String(runId)) continue
    const run = await api(`/repos/${repository}/actions/runs/${artifact.workflow_run.id}`)
    if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) continue
    if (run.path !== '.github/workflows/quality-checks.yml' || run.status !== 'completed' || run.conclusion !== 'success') continue
    if (run.event !== 'pull_request' && !(['push', 'workflow_dispatch'].includes(run.event) && run.head_branch === 'main')) continue
    if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) continue
    const { jobs } = await api(`/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)
    const job = jobs.find((candidate) => candidate.name === VALIDATION_JOBS[kind] && candidate.conclusion === 'success')
    if (!job || job.status !== 'completed') continue
    const created = Date.parse(artifact.created_at)
    if (!(created >= Date.parse(job.started_at) && created <= Date.parse(job.completed_at))) continue
    return run.html_url
  }
  return null
}

export function githubApi(env = process.env) {
  const responses = new Map()
  return (path) => {
    if (!responses.has(path)) {
      responses.set(path, (async () => {
        const response = await fetch(`${env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${env.GITHUB_TOKEN}`,
            'x-github-api-version': '2022-11-28',
          },
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw new Error(`GitHub validation lookup returned HTTP ${response.status}`)
        return response.json()
      })())
    }
    return responses.get(path)
  }
}

export async function resolveValidationReuse({ env = process.env, root = '.', api = githubApi(env) } = {}) {
  const keys = validationKeys(root, env)
  const sources = {}
  await Promise.all(Object.keys(keys).map(async (kind) => {
    sources[kind] = null
    if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') return
    try {
      sources[kind] = await findReusableValidation(kind, keys[kind], {
        api, repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID,
      })
    } catch (error) {
      console.log(`Validation reuse unavailable for ${kind}; running checks. ${error.message}`)
    }
  }))
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, Object.entries(keys).map(([kind, key]) =>
      `${kind}_key=${key}\nreuse_${kind}=${Boolean(sources[kind])}\n`,
    ).join(''))
  }
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, '\n| Validation | Result |\n| --- | --- |\n' +
      Object.entries(sources).map(([kind, url]) => `| ${kind} | ${url ? `[Reuse successful checks](${url})` : 'Run checks'} |\n`).join(''))
  }
  return { keys, sources }
}

export async function recordValidation(kind, expectedKey, { env = process.env, root = '.' } = {}) {
  if (!Object.hasOwn(VALIDATION_JOBS, kind)) throw new Error('Unknown validation kind')
  const keys = validationKeys(root, env)
  if (keys[kind] !== expectedKey) throw new Error('Validation inputs changed after the reuse decision')
  if (!env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required for validation records')
  const directory = join(env.RUNNER_TEMP, 'ci-validation')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${kind}.json`), JSON.stringify({
    kind, key: expectedKey, run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT,
  }) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'resolve') await resolveValidationReuse()
  else if (process.argv[2] === 'record') await recordValidation(process.argv[3], process.argv[4])
  else throw new Error('Usage: ci-validation-reuse.mjs resolve | record <kind> <key>')
}
