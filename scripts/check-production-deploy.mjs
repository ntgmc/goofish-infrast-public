import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const workflow = await readFile('.github/workflows/deploy-production.yml', 'utf8')
const devWorkflow = await readFile('.github/workflows/deploy-dev.yml', 'utf8')
const qualityChecksWorkflow = await readFile('.github/workflows/quality-checks.yml', 'utf8')
const securityAnalysisWorkflow = await readFile('.github/workflows/security-analysis.yml', 'utf8')
const deployScript = await readFile('scripts/deploy-production-atomic.sh', 'utf8')
const devDeployScript = await readFile('scripts/deploy-production.sh', 'utf8')
const releaseArtifact = await readFile('scripts/release-artifact.mjs', 'utf8')
const apiNginx = await readFile('deploy/nginx/goofish-api-production.conf', 'utf8')
const blueUpstream = await readFile('deploy/nginx/goofish-upstream-blue.conf', 'utf8')
const greenUpstream = await readFile('deploy/nginx/goofish-upstream-green.conf', 'utf8')
const systemdUnit = await readFile('deploy/systemd/goofish-infrast-v1@.service', 'utf8')
const buildRelevance = await readFile('scripts/check-build-relevance.mjs', 'utf8')
const productionDocs = await readFile('docs/production-deploy.md', 'utf8')

assertWorkflowProvenance()
assertQualityChecksImmutability()
assertSecurityAnalysisGate()
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
  assert.match(workflow, /actions\/download-artifact@/, 'production deploy should download the Quality Checks artifact')
  assert.match(workflow, /ARTIFACT_SHA256=\$\{ARTIFACT_SHA256@Q\}/, 'SSH command should pass the verified artifact checksum')
  assert.match(workflow, /for name in[^\n]*DEPLOY_KNOWN_HOSTS/, 'production deploy should require pinned SSH host keys')
  assert.doesNotMatch(workflow, /ssh-keyscan/, 'production deploy must not trust host keys discovered at runtime')
  assert.doesNotMatch(workflow, /DEPLOY_BRANCH/, 'production workflow must not pass a mutable branch')
  assert.match(devWorkflow, /actions\/download-artifact@/, 'dev deploy should download the Quality Checks artifact')
  assert.match(devWorkflow, /run-id: \$\{\{ steps\.target\.outputs\.run_id \}\}/, 'dev deploy should bind the artifact to a Quality Checks run')
  assert.match(devWorkflow, /github\.event\.workflow_run\.event == 'push'/, 'automatic dev deploy should only accept push runs')
  assert.match(devWorkflow, /event: 'push'/, 'manual dev deploy should only query push runs')
  assert.match(devWorkflow, /run\.event === 'push'/, 'manual dev deploy should verify the selected run event')
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

function assertQualityChecksImmutability() {
  assert.match(qualityChecksWorkflow, /^permissions:\s*\n\s+contents: read$/m, 'Quality Checks should only read repository contents')
  assert.doesNotMatch(qualityChecksWorkflow, /refresh-build-metadata/, 'Quality Checks must not refresh committed build metadata')
  assert.doesNotMatch(qualityChecksWorkflow, /--refresh-metadata/, 'Quality Checks must not generate metadata for a repository commit')
  assert.doesNotMatch(qualityChecksWorkflow, /\bgit push\b/, 'Quality Checks must not advance a checked branch')
  assert.match(qualityChecksWorkflow, /actions\/upload-artifact@/, 'Quality Checks should publish an immutable release artifact')
  assert.match(qualityChecksWorkflow, /release-artifact\.mjs create/, 'Quality Checks should create a release manifest')
}

function assertSecurityAnalysisGate() {
  const qualityConcurrencyGroup = qualityChecksWorkflow.match(/^concurrency:\s*\n\s+group:\s+(.+)$/m)?.[1]
  const securityConcurrencyGroup = securityAnalysisWorkflow.match(/^concurrency:\s*\n\s+group:\s+(.+)$/m)?.[1]

  assert.match(
    qualityChecksWorkflow,
    /uses: \.\/\.github\/workflows\/security-analysis\.yml/,
    'Quality Checks should require the reusable security analysis workflow',
  )
  assert.match(securityAnalysisWorkflow, /^\s+workflow_call:$/m, 'security analysis should support reusable invocation')
  assert.ok(qualityConcurrencyGroup, 'Quality Checks should define a concurrency group')
  assert.ok(securityConcurrencyGroup, 'security analysis should define a concurrency group')
  assert.notEqual(
    securityConcurrencyGroup,
    qualityConcurrencyGroup,
    'reusable security analysis must not deadlock on the parent workflow concurrency group',
  )
  assert.equal(
    securityConcurrencyGroup,
    'security-analysis-${{ github.ref }}',
    'direct and reusable security analysis should share one ref-scoped concurrency group',
  )
  assert.match(
    securityAnalysisWorkflow,
    /semgrep scan --config \.semgrep\.yml --error --metrics=off \./,
    'security analysis should block on findings from repository-pinned rules',
  )
  assert.doesNotMatch(securityAnalysisWorkflow, /codeql-action/, 'private-repository security analysis must not require CodeQL')
}

function assertDeploymentScript() {
  const syntax = spawnSync('bash', ['-n', 'scripts/deploy-production-atomic.sh'], { encoding: 'utf8' })
  if (syntax.error?.code !== 'ENOENT') {
    assert.equal(syntax.status, 0, syntax.stderr || 'production deploy script should pass bash -n')
  }
  const devSyntax = spawnSync('bash', ['-n', 'scripts/deploy-production.sh'], { encoding: 'utf8' })
  if (devSyntax.error?.code !== 'ENOENT') {
    assert.equal(devSyntax.status, 0, devSyntax.stderr || 'dev deploy script should pass bash -n')
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
    /sha256sum "\$ARTIFACT_PATH"/,
    /release-artifact\.mjs verify --sha "\$TARGET_SHA"/,
    /tar -xzf "\$ARTIFACT_PATH"/,
    /release\.json/,
    /check_readiness "\$CANDIDATE_SLOT"/,
    /CANDIDATE_ONLY/,
    /run_systemctl reload nginx/,
    /run_systemctl enable "\$\(service_unit "\$CANDIDATE_SLOT"\)"/,
    /rollback\(\)/,
    /flock -n 9/,
  ]) {
    assert.match(deployScript, contract)
  }
  assert.doesNotMatch(deployScript, /npm run build/, 'production deploy must not build on the server')
  assert.doesNotMatch(deployScript, /git restore/, 'production deploy must not restore generated source files')
  assert.doesNotMatch(deployScript, /src\/lib\/build-meta\.ts/, 'production deploy must not inspect the build metadata re-export')
  assert.match(releaseArtifact, /src\/lib\/\.generated\/build-meta\.ts/, 'release creation should read generated build metadata')
  assert.doesNotMatch(devDeployScript, /npm run build/, 'dev deploy must not build on the server')
  assert.doesNotMatch(devDeployScript, /git restore/, 'dev deploy must not restore generated source files')
  assertOrdered(devDeployScript, [
    'sha256sum "$ARTIFACT_PATH"',
    'release-artifact.mjs verify --sha "$TARGET_SHA"',
    'run_systemctl restart "$SERVICE_NAME"',
  ])

  const mainFlow = deployScript.slice(deployScript.indexOf('RELEASE_DIR="$RELEASES_DIR/$TARGET_SHA"'))
  assertOrdered(mainFlow, [
    'build_release',
    'run_systemctl restart "$(service_unit "$CANDIDATE_SLOT")"',
    'check_readiness "$CANDIDATE_SLOT"',
    'if [[ "$CANDIDATE_ONLY" == "true" ]]',
    'atomic_link "slots/$CANDIDATE_SLOT" "$CURRENT_LINK"',
    'run_systemctl reload nginx',
    'check_public_smoke || fail',
    'run_systemctl enable "$(service_unit "$CANDIDATE_SLOT")"',
    'run_systemctl disable --now "$(service_unit "$OLD_ACTIVE_SLOT")"',
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
  assert.match(systemdUnit, /^User=ntgmc$/m)
  assert.match(systemdUnit, /^Group=ntgmc$/m)
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
