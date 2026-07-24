import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const workflow = normalizeLineEndings(await readFile('.github/workflows/deploy-production.yml', 'utf8'))
const devWorkflow = await readFile('.github/workflows/deploy-dev.yml', 'utf8')
const qualityChecksWorkflow = normalizeLineEndings(await readFile('.github/workflows/quality-checks.yml', 'utf8'))
const securityAnalysisWorkflow = await readFile('.github/workflows/security-analysis.yml', 'utf8')
const prChangelogWorkflow = normalizeLineEndings(await readFile('.github/workflows/record-pr-changelog.yml', 'utf8'))
const prChangelogScript = normalizeLineEndings(await readFile('scripts/record-pr-changelog.mjs', 'utf8'))
const deployScript = await readFile('scripts/deploy-production-atomic.sh', 'utf8')
const workerDeployScript = await readFile('scripts/deploy-worker-atomic.sh', 'utf8')
const devDeployScript = await readFile('scripts/deploy-production.sh', 'utf8')
const releaseArtifact = await readFile('scripts/release-artifact.mjs', 'utf8')
const apiNginx = await readFile('deploy/nginx/goofish-api-production.conf', 'utf8')
const canonicalRedirectNginx = await readFile('deploy/nginx/goofish-canonical-redirect.conf', 'utf8')
const blueUpstream = await readFile('deploy/nginx/goofish-upstream-blue.conf', 'utf8')
const greenUpstream = await readFile('deploy/nginx/goofish-upstream-green.conf', 'utf8')
const systemdUnit = await readFile('deploy/systemd/goofish-infrast-v1@.service', 'utf8')
const migrationSystemdUnit = await readFile('deploy/systemd/goofish-database-migrate.service', 'utf8')
const devSystemdUnit = await readFile('deploy/systemd/goofish-infrast-v1-dev.service', 'utf8')
const workerSystemdUnit = await readFile('deploy/systemd/goofish-optimize-worker@.service', 'utf8')
const buildRelevance = await readFile('scripts/check-build-relevance.mjs', 'utf8')
const productionDocs = await readFile('docs/production-deploy.md', 'utf8')
const workerDocs = await readFile('docs/worker-deploy.md', 'utf8')
const developmentDocs = await readFile('docs/dev-deploy.md', 'utf8')

assertWorkflowProvenance()
assertQualityChecksImmutability()
assertSecurityAnalysisGate()
assertPrChangelogWorkflow()
assertDeploymentScript()
assertWorkerDeploymentScript()
assertNginxBlueGreenConfig()
assertSystemdTemplate()
assertDeploymentDocumentation()

console.log('Production deployment contract checks passed.')

function assertWorkflowProvenance() {
  assert.match(workflow, /commit_sha:/, 'manual production deploy should accept an immutable SHA')
  assert.match(workflow, /^permissions:\s*\n\s+actions: read\n\s+contents: write$/m, 'production deploy should be allowed to publish a confirmed release')
  assert.doesNotMatch(workflow, /^\s+branch:/m, 'manual production deploy must not accept a branch')
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/, 'automatic deploy should use workflow_run.head_sha')
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/, 'automatic production deploy should only accept push runs')
  assert.match(workflow, /workflow_id: 'quality-checks\.yml'/, 'manual deploy should query Quality Checks')
  assert.match(workflow, /run\.head_branch === 'main'/, 'manual deploy should require a main Quality Checks run')
  assert.match(workflow, /run\.conclusion === 'success'/, 'manual deploy should require successful Quality Checks')
  assert.match(workflow, /git merge-base --is-ancestor "\$TARGET_SHA" origin\/main/, 'workflow should verify main ancestry')
  assert.match(workflow, /TARGET_SHA=\$\{TARGET_SHA@Q\}/, 'SSH command should pass a shell-quoted target SHA')
  assert.match(workflow, /actions\/download-artifact@/, 'production deploy should download the Quality Checks artifact')
  assert.match(workflow, /ARTIFACT_SHA256=\$\{ARTIFACT_SHA256@Q\}/, 'SSH command should pass the verified artifact checksum')
  assert.match(workflow, /ref: \$\{\{ steps\.target\.outputs\.sha \}\}/, 'production deploy should checkout the immutable target SHA')
  assert.match(workflow, /scripts\/deploy-production-atomic\.sh "\$DEPLOY_USER@\$DEPLOY_HOST:\$remote_deploy_script"/, 'workflow should upload the target deployment script')
  assert.match(workflow, /scripts\/deploy-worker-atomic\.sh "\$WORKER_DEPLOY_USER@\$WORKER_DEPLOY_HOST:\$remote_deploy_script"/, 'workflow should upload the target worker deployment script')
  assert.match(workflow, /MIGRATION_ONLY=true/, 'production workflow should run the controlled migration mode')
  assert.match(workflow, /MIGRATION_SERVICE_NAME=\$\{DEPLOY_MIGRATION_SERVICE_NAME@Q\}/, 'migration mode should use the configured oneshot service')
  assert.match(workflow, /bash \$\{REMOTE_DEPLOY_SCRIPT@Q\}/, 'SSH command should run the uploaded deployment script')
  assert.match(workflow, /rm -f -- \$\{REMOTE_DEPLOY_SCRIPT@Q\} \$\{REMOTE_ARTIFACT@Q\}/, 'SSH command should clean up temporary deployment inputs')
  assert.match(workflow, /changelog-release\.json/, 'production deploy should extract generated changelog metadata from the verified artifact')
  assert.match(workflow, /github\.rest\.git\.createTag/, 'production deploy should create an annotated immutable release tag after success')
  assert.match(workflow, /github\.rest\.repos\.createRelease/, 'production deploy should publish a GitHub Release after success')
  assert.match(workflow, /github\.rest\.repos\.uploadReleaseAsset/, 'production deploy should persist the changelog record as a release asset')
  assert.doesNotMatch(workflow, /DEPLOY_SCRIPT:/, 'production deploy must not depend on a stale server-side script')
  assert.match(workflow, /for name in[^\n]*DEPLOY_KNOWN_HOSTS/, 'production deploy should require pinned SSH host keys')
  assert.doesNotMatch(workflow, /ssh-keyscan/, 'production deploy must not trust host keys discovered at runtime')
  assert.match(workflow, /WORKER_DEPLOY_KNOWN_HOSTS/, 'production deploy should require pinned worker host keys')
  assertOrdered(workflow, ['Apply controlled database migration first', 'Deploy verified worker release first', 'Deploy verified API release second', 'Publish successful changelog release'])
  assert.doesNotMatch(workflow, /DEPLOY_BRANCH/, 'production workflow must not pass a mutable branch')
  assert.match(devWorkflow, /actions\/download-artifact@/, 'dev deploy should download the Quality Checks artifact')
  assert.match(devWorkflow, /run-id: \$\{\{ steps\.target\.outputs\.run_id \}\}/, 'dev deploy should bind the artifact to a Quality Checks run')
  assert.match(devWorkflow, /github\.event\.workflow_run\.event == 'push'/, 'automatic dev deploy should only accept push runs')
  assert.match(devWorkflow, /event: 'push'/, 'manual dev deploy should only query push runs')
  assert.match(devWorkflow, /run\.event === 'push'/, 'manual dev deploy should verify the selected run event')
  assert.match(devWorkflow, /ref: \$\{\{ steps\.target\.outputs\.sha \}\}/, 'dev deploy should checkout the immutable target SHA')
  assert.match(devWorkflow, /scripts\/deploy-production\.sh "\$DEPLOY_USER@\$DEPLOY_HOST:\$remote_deploy_script"/, 'dev deploy should upload the target deployment script')
  assert.doesNotMatch(devWorkflow, /MIGRATION_SERVICE_NAME/, 'dev deploy should not require a separately privileged migration service')
  assert.match(devWorkflow, /REQUIRE_MIGRATION_PRESTART=true/, 'dev deploy should require the installed pre-start migration hook')
  assert.match(devWorkflow, /bash \$\{REMOTE_DEPLOY_SCRIPT@Q\}/, 'dev deploy should run the uploaded deployment script')
  assert.match(devWorkflow, /rm -f -- \$\{REMOTE_DEPLOY_SCRIPT@Q\} \$\{REMOTE_ARTIFACT@Q\}/, 'dev deploy should clean up temporary deployment inputs')
  assert.doesNotMatch(devWorkflow, /DEPLOY_SCRIPT:/, 'dev deploy must not depend on a stale server-side script')
  for (const deploymentPath of [
    "'.github/workflows/deploy-production.yml'",
    "'docs/production-deploy.md'",
    "'deploy/nginx/'",
    "'deploy/systemd/'",
    "'scripts/check-production-deploy.mjs'",
    "'scripts/changelog-lib.mjs'",
    "'scripts/generate-changelog.mjs'",
    "'scripts/pr-changelog-lib.mjs'",
    "'scripts/deploy-production-atomic.sh'",
    "'scripts/deploy-worker-atomic.sh'",
  ]) {
    assert.ok(buildRelevance.includes(deploymentPath), `build relevance should include ${deploymentPath}`)
  }
}

function assertPrChangelogWorkflow() {
  assert.match(prChangelogWorkflow, /^\s+workflow_dispatch:$/m, 'PR changelog recording must be manually dispatched')
  assert.match(prChangelogWorkflow, /pull_request_number:/, 'PR changelog recording should require a PR number')
  assert.match(
    prChangelogWorkflow,
    /chinese_change_summary:\s*\n\s+description:.*\n\s+required: false/,
    'PR changelog recording should keep the Chinese manual summary optional',
  )
  assert.match(prChangelogWorkflow, /^\s+issues: write$/m, 'PR changelog recording should write a bot-owned canonical comment')
  assert.match(prChangelogWorkflow, /^\s+pull-requests: write$/m, 'PR changelog recording should write the selected PR comment')
  assert.match(prChangelogWorkflow, /^\s+statuses: write$/m, 'PR changelog recording should publish a merge-gating status')
  assert.match(prChangelogWorkflow, /github\.ref == 'refs\/heads\/main'/, 'trusted changelog workflow code must run from main')
  assert.match(prChangelogWorkflow, /secrets\.DEEPSEEK_API_KEY/, 'PR changelog recording should use the DeepSeek API secret')
  assert.match(prChangelogWorkflow, /vars\.DEEPSEEK_MODEL \|\| 'deepseek-v4-pro'/, 'PR changelog recording should default to DeepSeek V4 Pro')
  assert.match(prChangelogWorkflow, /node scripts\/record-pr-changelog\.mjs/, 'PR changelog workflow should run the reviewed recording script')
  assert.match(prChangelogScript, /return parsed/, 'PR changelog recording should pass the raw DeepSeek payload to the canonical validator')
  assert.match(prChangelogScript, /process\.env\.DEEPSEEK_MODEL \?\? 'deepseek-v4-pro'/, 'PR changelog script should share the workflow DeepSeek model default')
  assert.doesNotMatch(prChangelogScript, /return normalizeDeepSeekResult\(parsed\)/, 'PR changelog recording must not normalize the DeepSeek payload twice')
  assert.match(prChangelogScript, /GitHub API 请求失败：\$\{method\} \$\{path\}/, 'GitHub API failures should identify the rejected request')
  assert.match(prChangelogScript, /'message', 'documentation_url', 'status'/, 'GitHub API failures should include safe response details')
}

function assertQualityChecksImmutability() {
  assert.match(
    qualityChecksWorkflow,
    /^permissions:\s*\n\s+contents: read\n\s+issues: read\n\s+pull-requests: read$/m,
    'Quality Checks should only read repository contents and merged PR changelog comments',
  )
  assert.doesNotMatch(qualityChecksWorkflow, /refresh-build-metadata/, 'Quality Checks must not refresh committed build metadata')
  assert.doesNotMatch(qualityChecksWorkflow, /--refresh-metadata/, 'Quality Checks must not generate metadata for a repository commit')
  assert.doesNotMatch(qualityChecksWorkflow, /\bgit push\b/, 'Quality Checks must not advance a checked branch')
  assert.match(qualityChecksWorkflow, /actions\/upload-artifact@/, 'Quality Checks should publish an immutable release artifact')
  assert.match(qualityChecksWorkflow, /release-artifact\.mjs create/, 'Quality Checks should create a release manifest')
  assert.match(qualityChecksWorkflow, /GENERATE_CHANGELOG_CANDIDATE/, 'Quality Checks should generate changelog candidates only for production-bound builds')
  assert.match(qualityChecksWorkflow, /CHANGELOG_BASE_SHA: \$\{\{ vars\.CHANGELOG_BASE_SHA \}\}/, 'Quality Checks should pass an explicitly configured changelog baseline to the candidate generator')
  assert.match(qualityChecksWorkflow, /changelog-release\.json/, 'Quality Checks should package generated changelog metadata with the immutable artifact')
  assert.match(qualityChecksWorkflow, /if: github\.event_name != 'pull_request'/, 'pull request checks should not publish deployment artifacts')
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
    /MIGRATION_ONLY/,
    /CANDIDATE_ONLY and MIGRATION_ONLY cannot both be true/,
    /run_systemctl start "\$MIGRATION_SERVICE_NAME"/,
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
  assert.match(devDeployScript, /journalctl --unit "\$SERVICE_NAME" --no-pager --lines=80/, 'dev deploy failures should include recent service logs')
  assert.match(devDeployScript, /sudo -n journalctl --unit "\$SERVICE_NAME" --no-pager --lines=80 2>\/dev\/null/, 'dev deploy journal fallback must never prompt for a password')
  assert.match(devDeployScript, /run_systemctl status "\$SERVICE_NAME" --no-pager --lines=50/, 'dev deploy status diagnostics should match the documented sudoers command')
  assert.doesNotMatch(devDeployScript, /run_systemctl status[^\n]*--full/, 'dev deploy must not request undocumented systemctl status arguments')
  assert.match(devDeployScript, /--write-out \$'\\n%\{http_code\}'/, 'dev deploy health checks should capture the HTTP status')
  assert.match(devDeployScript, /last health response: HTTP \$http_status; body:/, 'dev deploy should report the final unhealthy response')
  assert.match(devDeployScript, /last health check transport error \(curl exit \$curl_exit\):/, 'dev deploy should distinguish transport failures')
  assertOrdered(devDeployScript, [
    'sha256sum "$ARTIFACT_PATH"',
    'release-artifact.mjs verify --sha "$TARGET_SHA"',
    'run_systemctl restart "$SERVICE_NAME"',
  ])
  assert.doesNotMatch(devDeployScript, /MIGRATION_SERVICE_NAME/, 'dev deploy should preserve the existing systemctl sudoers contract')
  assert.doesNotMatch(devDeployScript, /run_systemctl stop "\$SERVICE_NAME"/, 'dev deploy restart should let systemd stop the existing service')
  assert.match(devDeployScript, /systemctl cat "\$SERVICE_NAME"/, 'dev deploy should inspect the installed unit without sudo')
  assert.match(devDeployScript, /missing the migration ExecStartPre/, 'dev deploy should explain how to upgrade an older unit')
  const migrationPrestartBody = extractFunction(devDeployScript, 'check_migration_prestart')
  assert.match(
    migrationPrestartBody,
    /ExecStartPre=\/usr\/bin\/env APP_ROLE=api ALLOW_DATABASE_MIGRATION=true \/usr\/bin\/node \/opt\/goofish-infrast-v1-dev\/server\/dist\/migrate\.js/,
    'dev deployment should require an API-scoped migration child process',
  )
  assert.match(migrationPrestartBody, /if \[\[ "\$REQUIRE_MIGRATION_PRESTART" != "true" \]\]; then\s+return 0\s+fi/, 'optional dev migration pre-start validation should skip successfully')
  assert.doesNotMatch(migrationPrestartBody, /\]\] \|\| return(?:\s|$)/, 'dev migration pre-start validation must not inherit a failed condition status')
  const migrationSkip = spawnSync('bash', ['-c', `set -Eeuo pipefail
REQUIRE_MIGRATION_PRESTART=false
${migrationPrestartBody}
check_migration_prestart
printf 'migration skip continued\\n'
`], { encoding: 'utf8' })
  if (migrationSkip.error?.code !== 'ENOENT') {
    assert.equal(migrationSkip.status, 0, migrationSkip.stderr || 'optional migration pre-start validation should not terminate deployment')
    assert.match(migrationSkip.stdout, /migration skip continued/, 'deployment should continue after optional migration pre-start validation is skipped')
  }

  const mainFlow = deployScript.slice(deployScript.indexOf('RELEASE_DIR="$RELEASES_DIR/$TARGET_SHA"'))
  assertOrdered(mainFlow, [
    'build_release',
    'if [[ "$MIGRATION_ONLY" == "true" ]]',
    'run_systemctl start "$MIGRATION_SERVICE_NAME"',
    'exit 0',
    'write_upstream_configs',
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

function assertWorkerDeploymentScript() {
  const syntax = spawnSync('bash', ['-n', 'scripts/deploy-worker-atomic.sh'], { encoding: 'utf8' })
  if (syntax.error?.code !== 'ENOENT') {
    assert.equal(syntax.status, 0, syntax.stderr || 'worker deploy script should pass bash -n')
  }

  const invalidSha = spawnSync('bash', ['scripts/deploy-worker-atomic.sh'], {
    encoding: 'utf8',
    env: { ...process.env, TARGET_SHA: 'main' },
  })
  if (invalidSha.error?.code !== 'ENOENT') {
    assert.notEqual(invalidSha.status, 0, 'worker deploy must reject mutable refs')
    assert.match(`${invalidSha.stdout}\n${invalidSha.stderr}`, /full 40-character commit SHA/)
  }

  for (const contract of [
    /git -C "\$REPO_DIR" cat-file -e "\$\{TARGET_SHA\}\^\{commit\}"/,
    /git -C "\$REPO_DIR" merge-base --is-ancestor "\$TARGET_SHA"/,
    /worktree add --detach "\$BUILD_DIR" "\$TARGET_SHA"/,
    /sha256sum "\$ARTIFACT_PATH"/,
    /release-artifact\.mjs verify --sha "\$TARGET_SHA"/,
    /node --check server\/dist\/worker\.js/,
    /node --check server\/dist\/optimize-worker\.js/,
    /check_readiness "\$CANDIDATE_SLOT"/,
    /check_systemctl_access/,
    /CANDIDATE_ONLY/,
    /previous-slot-drain/,
    /rollback\(\)/,
    /flock -n 9/,
  ]) {
    assert.match(workerDeployScript, contract)
  }
  assert.doesNotMatch(workerDeployScript, /npm run build/, 'worker deploy must not build on the server')
  assert.match(workerDeployScript, /--connect-timeout "\$HEALTH_CONNECT_TIMEOUT_SECONDS"/, 'worker readiness should bound connection time')
  assert.match(workerDeployScript, /--max-time "\$HEALTH_REQUEST_TIMEOUT_SECONDS"/, 'worker readiness should bound total request time')
  assert.match(workerDeployScript, /last worker readiness (?:transport error|response)/, 'worker readiness should report its final diagnostic')
  assert.match(workerDeployScript, /run_journalctl --unit/, 'worker readiness failures should include unit journal output')
  assert.doesNotMatch(workerDeployScript, /git restore/, 'worker deploy must not restore generated files')
  assert.doesNotMatch(
    workerDeployScript,
    /run_systemctl disable --now "\$\(service_unit "\$OLD_ACTIVE_SLOT"\)"/,
    'worker deploy must not block on the previous slot drain',
  )

  const failBody = extractFunction(workerDeployScript, 'fail')
  assert.match(failBody, /return 1/, 'worker deployment failures must flow through the ERR cleanup trap')
  assert.doesNotMatch(failBody, /exit 1/, 'worker deployment failures must not bypass candidate cleanup')
  const cleanupProbe = spawnSync('bash', ['-c', [
    'set -Eeuo pipefail',
    failBody,
    "trap 'printf cleanup-ran' ERR",
    'fail probe',
  ].join('\n')], { encoding: 'utf8' })
  if (cleanupProbe.error?.code !== 'ENOENT') {
    assert.notEqual(cleanupProbe.status, 0, 'worker failure probe should preserve the failure status')
    assert.match(cleanupProbe.stdout, /cleanup-ran/, 'worker fail must trigger the ERR cleanup trap')
  }

  const errorBody = extractFunction(workerDeployScript, 'on_error')
  assert.match(errorBody, /run_systemctl stop "\$\(service_unit "\$CANDIDATE_SLOT"\)"/, 'failed candidates must be stopped')
  assert.match(errorBody, /restore_link "\$OLD_CANDIDATE_TARGET" "\$SLOTS_DIR\/\$CANDIDATE_SLOT"/, 'failed candidate slot links must be restored')

  const privilegePreflightBody = extractFunction(workerDeployScript, 'check_systemctl_access')
  for (const command of [
    'restart "$unit"',
    'stop "$unit"',
    'enable "$unit"',
    'enable --now "$unit"',
    'disable "$unit"',
    'disable --now "$unit"',
    '--no-block stop "$unit"',
    'is-active --quiet "$unit"',
    'status "$unit" --no-pager --lines=80',
  ]) {
    assert.ok(privilegePreflightBody.includes(command), `worker sudo preflight should cover systemctl ${command}`)
  }
  assert.match(workerDeployScript, /sudo -n -l "\$command_path"/, 'worker sudo preflight must be read-only')

  assertOrdered(workerDeployScript, [
    'PHASE="privilege-preflight"',
    'check_systemctl_access',
    'PHASE="fetch"',
    'build_release',
  ])

  const mainFlow = workerDeployScript.slice(workerDeployScript.indexOf('RELEASE_DIR="$RELEASES_DIR/$TARGET_SHA"'))
  assertOrdered(mainFlow, [
    'build_release',
    'run_systemctl restart "$(service_unit "$CANDIDATE_SLOT")"',
    'check_readiness "$CANDIDATE_SLOT"',
    'if [[ "$CANDIDATE_ONLY" == "true" ]]',
    'atomic_link "slots/$CANDIDATE_SLOT" "$CURRENT_LINK"',
    'run_systemctl enable "$(service_unit "$CANDIDATE_SLOT")"',
    'run_systemctl disable "$(service_unit "$OLD_ACTIVE_SLOT")"',
    'run_systemctl --no-block stop "$(service_unit "$OLD_ACTIVE_SLOT")"',
    'check_readiness "$CANDIDATE_SLOT"',
  ])
}

function assertNginxBlueGreenConfig() {
  const namedUpstreams = apiNginx.match(/proxy_pass http:\/\/goofish_backend;/g) ?? []
  assert.equal(namedUpstreams.length, 4, 'all production API locations should use the named upstream')
  assert.doesNotMatch(apiNginx, /127\.0\.0\.1:3000/)
  assert.match(
    canonicalRedirectNginx,
    /^return 308 https:\/\/maatool\.com\$request_uri;$/m,
    'the canonical redirect should preserve the complete request path and query string',
  )
  assert.doesNotMatch(canonicalRedirectNginx, /proxy_pass|try_files/, 'the www redirect must not serve the application')
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
  assert.match(systemdUnit, /Environment=APP_ROLE=api/)
  assert.match(systemdUnit, /Environment=HOST=127\.0\.0\.1/)
  assert.match(systemdUnit, /KillSignal=SIGTERM/)
  assert.match(systemdUnit, /TimeoutStopSec=75s/)

  assert.match(migrationSystemdUnit, /^Type=oneshot$/m)
  assert.match(migrationSystemdUnit, /^TimeoutStartSec=15min$/m)
  assert.match(migrationSystemdUnit, /^User=ntgmc$/m)
  assert.match(migrationSystemdUnit, /^Group=ntgmc$/m)
  assert.match(migrationSystemdUnit, /WorkingDirectory=\/opt\/goofish-infrast-v1\/migration-candidate/)
  assert.match(migrationSystemdUnit, /APP_ROLE=api ALLOW_DATABASE_MIGRATION=true/)
  assert.match(migrationSystemdUnit, /server\/dist\/migrate\.js/)
  assert.match(migrationSystemdUnit, /EnvironmentFile=\/etc\/goofish-infrast-v1\/backend\.env/)
  assert.match(migrationSystemdUnit, /^NoNewPrivileges=true$/m)

  assert.match(devSystemdUnit, /WorkingDirectory=\/opt\/goofish-infrast-v1-dev/)
  assert.match(devSystemdUnit, /Environment=NODE_ENV=production/)
  assert.match(devSystemdUnit, /^ExecStart=\/usr\/bin\/node \/opt\/goofish-infrast-v1-dev\/server\/dist\/all\.js$/m)
  assert.match(devSystemdUnit, /Environment=APP_ROLE=all/)
  assert.match(devSystemdUnit, /Environment=ALLOW_PRODUCTION_COMBINED_PROCESS=true/)
  assert.match(devSystemdUnit, /Environment=OPTIMIZE_WORKER_CONCURRENCY=1/)
  assert.match(devSystemdUnit, /Environment=PORT=3001/)
  assert.match(devSystemdUnit, /Environment=HOST=127\.0\.0\.1/)
  assert.match(devSystemdUnit, /EnvironmentFile=\/etc\/goofish-infrast-v1\/dev\.env/)
  assert.match(devSystemdUnit, /KillSignal=SIGTERM/)
  assert.match(devSystemdUnit, /TimeoutStopSec=75s/)
  assertOrdered(devSystemdUnit, [
    'EnvironmentFile=/etc/goofish-infrast-v1/dev.env',
    'Environment=NODE_ENV=production',
    'Environment=APP_ROLE=all',
    'Environment=ALLOW_PRODUCTION_COMBINED_PROCESS=true',
    'Environment=OPTIMIZE_WORKER_CONCURRENCY=1',
  ])
  assert.match(
    devSystemdUnit,
    /^ExecStartPre=\/usr\/bin\/env APP_ROLE=api ALLOW_DATABASE_MIGRATION=true \/usr\/bin\/node \/opt\/goofish-infrast-v1-dev\/server\/dist\/migrate\.js$/m,
  )

  assert.match(workerSystemdUnit, /^User=ntgmc$/m)
  assert.match(workerSystemdUnit, /^Group=ntgmc$/m)
  assert.match(workerSystemdUnit, /WorkingDirectory=\/opt\/goofish-infrast-v1-worker\/slots\/%i/)
  assert.match(workerSystemdUnit, /Environment=APP_ROLE=worker/)
  assert.match(workerSystemdUnit, /Environment=WORKER_HEALTH_HOST=127\.0\.0\.1/)
  assert.match(workerSystemdUnit, /Requires=wg-quick@wg0\.service/)
  assert.match(workerSystemdUnit, /KillSignal=SIGTERM/)
  assert.match(workerSystemdUnit, /TimeoutStopSec=930s/)
  assert.doesNotMatch(workerSystemdUnit, /0\.0\.0\.0/)
}

function assertDeploymentDocumentation() {
  assert.ok(productionDocs.includes('PUBLIC_APP_URL=https://maatool.com'), 'production EnvironmentFile must declare the public origin')
  assert.ok(
    productionDocs.includes('server_name www.maatool.com;') &&
      productionDocs.includes('include /etc/nginx/snippets/goofish-canonical-redirect.conf;'),
    'production documentation should redirect the www alias to the canonical origin',
  )
  assert.ok(developmentDocs.includes('PUBLIC_APP_URL=https://dev.maatool.com'), 'development EnvironmentFile must declare the public origin')
  assert.ok(
    developmentDocs.includes('ALLOW_PRODUCTION_COMBINED_PROCESS=true') &&
      developmentDocs.includes('OPTIMIZE_WORKER_CONCURRENCY=1'),
    'development service should explicitly enable a single local optimize worker',
  )
  assert.ok(
    developmentDocs.includes('CREATE DATABASE goofish_infrast_v1_dev OWNER goofish_dev'),
    'development database should be owned by its runtime role',
  )
  assert.ok(
    developmentDocs.includes('GRANT SELECT, INSERT, UPDATE, DELETE') &&
      developmentDocs.includes('public.security_rate_limit_buckets'),
    'development recovery should grant the runtime role access to persistent authentication limits',
  )
  assert.ok(
    developmentDocs.includes('ExecStartPre') &&
      developmentDocs.includes('ALLOW_DATABASE_MIGRATION=true') &&
      developmentDocs.includes('needs no passwordless `stop`'),
    'development deployment should run guarded migration through the existing service restart',
  )
  assert.ok(productionDocs.includes('[worker-deploy.md](worker-deploy.md)'), 'production docs should link the worker runbook')
  assert.ok(productionDocs.includes('goofish-database-migrate.service'), 'production docs should install the controlled migration unit')
  assert.ok(productionDocs.includes('MIGRATION_ONLY=true'), 'production docs should explain the migration-only deployment phase')
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
  for (const expected of [
    'APP_ROLE=worker',
    'wg-quick@wg0.service',
    'hostssl goofish_infrast_v1 goofish_worker 10.66.0.2/32 scram-sha-256',
    'WORKER_DEPLOY_KNOWN_HOSTS',
    'Worker deployment accepts the same immutable artifact contract',
    '/usr/bin/systemctl disable goofish-optimize-worker@blue.service',
    '/usr/bin/systemctl disable --now goofish-optimize-worker@blue.service',
    '/usr/bin/journalctl --unit goofish-optimize-worker@blue.service --no-pager --lines=80',
    'sudo -n -l',
  ]) {
    assert.ok(workerDocs.includes(expected), `worker documentation should include ${expected}`)
  }
  assert.ok(workerDocs.includes('Do not expose PostgreSQL 5432 publicly'), 'worker docs must forbid public PostgreSQL')
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

function normalizeLineEndings(source) {
  return source.replace(/\r\n/g, '\n')
}
