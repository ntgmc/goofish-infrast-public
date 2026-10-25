import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { VALIDATION_JOBS } from './ci-validation-reuse.mjs'

const quality = normalize(await readFile('.github/workflows/quality-checks.yml', 'utf8'))
const security = normalize(await readFile('.github/workflows/security-analysis.yml', 'utf8'))

test('keeps generation, relevance, release, and migrated-data checks in the quality workflow', () => {
  for (const command of [
    'pnpm run test:generate-data',
    'pnpm run test:product-catalog',
    'pnpm run test:migration-verifier',
    'pnpm run test:backup-contracts',
    'pnpm run test:build-relevance',
    'pnpm run check:build-relevance',
    'pnpm run test:release-artifact',
    'node scripts/verify-migrated-data.mjs --require-database',
  ]) {
    assert.match(quality, new RegExp(escapeRegExp(command)))
  }
  assert.match(job('public-release'), /GENERATE_CHANGELOG_CANDIDATE: "true"/)
  assert.match(quality, /pnpm --dir \.release-smoke\/public install --frozen-lockfile --prod/)
})

test('attests the final tarball and calls Semgrep from main pull requests and pushes', () => {
  assert.match(quality, /actions\/attest-build-provenance@[0-9a-f]{40}/)
  assert.match(quality, /subject-path: \.release-packages\/public\/public\.tgz/)
  assert.match(quality, /^  id-token: write$/m)
  assert.match(quality, /^  attestations: write$/m)
  assert.match(quality, /^  pull_request:\n    branches: \[main\]$/m)
  assert.match(quality, /^  push:\n    branches: \[main\]$/m)
  assert.match(job('security'), /uses: \.\/\.github\/workflows\/security-analysis\.yml/)
  assert.match(security, /^  workflow_call:\n    inputs:\n      validation_key:/m)
  assert.match(security, /^  schedule:/m)
  assert.match(security, /^  workflow_dispatch:/m)
  assert.doesNotMatch(security, /^  (pull_request|push):/m)
})

test('runs the full application suite once inside the independent public export', async () => {
  const validation = job('public-validation')
  assert.match(validation, /pnpm run check:public-export/)
  assert.doesNotMatch(validation, /pnpm (test|run build)\b/)
  const exporter = await readFile('scripts/check-public-export.mjs', 'utf8')
  assert.match(exporter, /runPnpm\(\['run', 'build'\], temporaryRoot\)/)
  assert.match(exporter, /runPnpm\(\['test'\], temporaryRoot\)/)
})

test('only skips validation jobs when the matching successful record was found', () => {
  for (const [id, kind] of [['public-validation', 'public'], ['postgres-integration', 'postgres'], ['security', 'security']]) {
    const block = job(id)
    assert.match(block, /needs: validation-reuse/)
    assert.ok(block.includes(`if: needs.validation-reuse.outputs.reuse_${kind} != 'true'`))
    const recorder = kind === 'security' ? security : block
    assert.ok(recorder.includes(`record ${kind} "$VALIDATION_KEY"`))
    assert.ok(recorder.includes(`ci-validation-${kind}-`))
    assert.ok(recorder.includes(`name: ${VALIDATION_JOBS[kind].split(' / ').at(-1)}`))
  }
  assert.match(job('validation-reuse'), /run: node scripts\/ci-validation-reuse\.mjs resolve/)
  assert.match(quality, /^  actions: read$/m)
  assert.doesNotMatch(quality + security, /runs-on: ubuntu-latest/)
})

test('always rebuilds release metadata for the push SHA after successful or reused public checks', () => {
  const release = job('public-release')
  assert.match(release, /needs: \[validation-reuse, public-validation\]/)
  assert.match(release, /always\(\) && !cancelled\(\) && github\.event_name == 'push'/)
  assert.match(release, /needs\.validation-reuse\.result == 'success'/)
  assert.match(release, /needs\.public-validation\.result == 'success' \|\|/)
  assert.match(release, /needs\.public-validation\.result == 'skipped' && needs\.validation-reuse\.outputs\.reuse_public == 'true'/)
  assert.match(release, /VERSION_SOURCE_SHA: \$\{\{ github\.sha \}\}/)
  assert.match(release, /run: pnpm run build/)
  assert.doesNotMatch(release, /pnpm run check:public-export/)
})

function job(id) {
  const block = quality.split(`\n  ${id}:\n`)[1]
  assert.ok(block, `Missing job ${id}`)
  return block.split(/\n  [a-z][a-z-]+:\n/)[0]
}

function normalize(value) {
  return value.replaceAll('\r\n', '\n')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
