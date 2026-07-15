import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const workflow = await readFile('.github/workflows/deploy-production.yml', 'utf8')
const deployScript = await readFile('scripts/deploy-production-atomic.sh', 'utf8')
const apiNginx = await readFile('deploy/nginx/goofish-api-production.conf', 'utf8')
const blueUpstream = await readFile('deploy/nginx/goofish-upstream-blue.conf', 'utf8')
const greenUpstream = await readFile('deploy/nginx/goofish-upstream-green.conf', 'utf8')
const systemdUnit = await readFile('deploy/systemd/goofish-infrast-v1@.service', 'utf8')
const buildRelevance = await readFile('scripts/check-build-relevance.mjs', 'utf8')
const productionDocs = await readFile('docs/production-deploy.md', 'utf8')

assertWorkflowProvenance()
assertDeploymentScript()
assertNginxBlueGreenConfig()
assertSystemdTemplate()
assertDeploymentDocumentation()

console.log('Production deployment contract checks passed.')

function assertWorkflowProvenance() {
  assert.match(workflow, /commit_sha:/, 'manual production deploy should accept an immutable SHA')
  assert.doesNotMatch(workflow, /^\s+branch:/m, 'manual production deploy must not accept a branch')
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/, 'automatic deploy should use workflow_run.head_sha')
  assert.match(workflow, /workflow_id: 'quality-checks\.yml'/, 'manual deploy should query Quality Checks')
  assert.match(workflow, /run\.head_branch === 'main'/, 'manual deploy should require a main Quality Checks run')
  assert.match(workflow, /run\.conclusion === 'success'/, 'manual deploy should require successful Quality Checks')
  assert.match(workflow, /git merge-base --is-ancestor "\$TARGET_SHA" origin\/main/, 'workflow should verify main ancestry')
  assert.match(workflow, /TARGET_SHA=\$\{TARGET_SHA@Q\}/, 'SSH command should pass a shell-quoted target SHA')
  assert.doesNotMatch(workflow, /DEPLOY_BRANCH/, 'production workflow must not pass a mutable branch')
  for (const deploymentPath of [
    "'.github/workflows/deploy-production.yml'",
    "'docs/production-deploy.md'",
    "'deploy/nginx/'",
    "'deploy/systemd/'",
    "'scripts/check-production-deploy.mjs'",
    "'scripts/deploy-production-atomic.sh'",
  ]) {
    assert.ok(buildRelevance.includes(deploymentPath), `build relevance should include ${deploymentPath}`)
  }
}

function assertDeploymentScript() {
  const syntax = spawnSync('bash', ['-n', 'scripts/deploy-production-atomic.sh'], { encoding: 'utf8' })
  if (syntax.error?.code !== 'ENOENT') {
    assert.equal(syntax.status, 0, syntax.stderr || 'production deploy script should pass bash -n')
  }

  const invalidSha = spawnSync('bash', ['scripts/deploy-production-atomic.sh'], {
    encoding: 'utf8',
    env: { ...process.env, TARGET_SHA: 'main', PUBLIC_BASE_URL: 'https://example.invalid' },
  })
  if (invalidSha.error?.code !== 'ENOENT') {
    assert.notEqual(invalidSha.status, 0, 'mutable refs must be rejected')
    assert.match(`${invalidSha.stdout}\n${invalidSha.stderr}`, /full 40-character commit SHA/)
  }

  for (const contract of [
    /git -C "\$REPO_DIR" cat-file -e "\$\{TARGET_SHA\}\^\{commit\}"/,
    /git -C "\$REPO_DIR" merge-base --is-ancestor "\$TARGET_SHA"/,
    /worktree add --detach "\$BUILD_DIR" "\$TARGET_SHA"/,
    /REFRESH_BUILD_METADATA=true/,
    /VERSION_SOURCE_SHA="\$TARGET_SHA"/,
    /release\.json/,
    /check_readiness "\$CANDIDATE_SLOT"/,
    /CANDIDATE_ONLY/,
    /run_systemctl reload nginx/,
    /rollback\(\)/,
    /flock -n 9/,
  ]) {
    assert.match(deployScript, contract)
  }

  const mainFlow = deployScript.slice(deployScript.indexOf('RELEASE_DIR="$RELEASES_DIR/$TARGET_SHA"'))
  assertOrdered(mainFlow, [
    'build_release',
    'run_systemctl restart "$(service_unit "$CANDIDATE_SLOT")"',
    'check_readiness "$CANDIDATE_SLOT"',
    'if [[ "$CANDIDATE_ONLY" == "true" ]]',
    'atomic_link "slots/$CANDIDATE_SLOT" "$CURRENT_LINK"',
    'run_systemctl reload nginx',
    'check_public_smoke || fail',
    'run_systemctl stop "$(service_unit "$OLD_ACTIVE_SLOT")"',
  ])

  const rollbackBody = extractFunction(deployScript, 'rollback')
  assert.match(rollbackBody, /restore_link "\$OLD_CURRENT_TARGET" "\$CURRENT_LINK"/)
  assert.match(rollbackBody, /restore_link "\$OLD_UPSTREAM_TARGET" "\$ACTIVE_UPSTREAM_LINK"/)
  assertOrdered(rollbackBody, ['run_systemctl reload nginx', 'check_readiness "$OLD_ACTIVE_SLOT"', 'check_public_smoke'])
}

function assertNginxBlueGreenConfig() {
  const namedUpstreams = apiNginx.match(/proxy_pass http:\/\/goofish_backend;/g) ?? []
  assert.equal(namedUpstreams.length, 4, 'all production API locations should use the named upstream')
  assert.doesNotMatch(apiNginx, /127\.0\.0\.1:3000/)
  assert.match(blueUpstream, /upstream goofish_backend/)
  assert.match(blueUpstream, /127\.0\.0\.1:3000/)
  assert.match(greenUpstream, /upstream goofish_backend/)
  assert.match(greenUpstream, /127\.0\.0\.1:3002/)
}

function assertSystemdTemplate() {
  assert.match(systemdUnit, /WorkingDirectory=\/opt\/goofish-infrast-v1\/slots\/%i/)
  assert.match(systemdUnit, /EnvironmentFile=\/etc\/goofish-infrast-v1\/%i\.env/)
  assert.match(systemdUnit, /Environment=HOST=127\.0\.0\.1/)
  assert.match(systemdUnit, /KillSignal=SIGTERM/)
  assert.match(systemdUnit, /TimeoutStopSec=75s/)
}

function assertDeploymentDocumentation() {
  for (const expected of [
    '/opt/goofish-infrast-v1/releases/',
    '/opt/goofish-infrast-v1/current/dist',
    'current -> repository',
    'commit_sha',
    'release.json',
    'goofish-infrast-v1@blue.service',
    'goofish-infrast-v1@green.service',
    'nginx -t',
    '回滚',
  ]) {
    assert.ok(productionDocs.includes(expected), `production documentation should include ${expected}`)
  }
}

function assertOrdered(source, fragments) {
  let cursor = -1
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1)
    assert.ok(next > cursor, `expected deployment step after previous step: ${fragment}`)
    cursor = next
  }
}

function extractFunction(source, name) {
  const start = source.indexOf(`${name}() {`)
  assert.ok(start >= 0, `missing function ${name}`)
  const end = source.indexOf('\n}\n', start)
  assert.ok(end > start, `could not find end of function ${name}`)
  return source.slice(start, end + 2)
}
