import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const quality = normalize(await readFile('.github/workflows/quality-checks.yml', 'utf8'))
const security = normalize(await readFile('.github/workflows/security-analysis.yml', 'utf8'))

test('keeps generation, relevance, release, and migrated-data checks in the quality workflow', () => {
  for (const command of [
    'npm run test:generate-data',
    'npm run test:product-catalog',
    'npm run test:migration-verifier',
    'npm run test:backup-contracts',
    'npm run test:build-relevance',
    'npm run check:build-relevance',
    'npm run test:release-artifact',
    'node scripts/verify-migrated-data.mjs --require-database',
  ]) {
    assert.match(quality, new RegExp(escapeRegExp(command)))
  }
  assert.match(quality, /GENERATE_CHANGELOG_CANDIDATE: \$\{\{ github\.event_name == 'push'/)
  assert.match(quality, /npm ci --prefix \.release-smoke\/public --omit=dev/)
})

test('attests the final tarball and runs Semgrep on main pull requests and pushes', () => {
  assert.match(quality, /actions\/attest-build-provenance@[0-9a-f]{40}/)
  assert.match(quality, /subject-path: \.release-packages\/public\/public\.tgz/)
  assert.match(quality, /^  id-token: write$/m)
  assert.match(quality, /^  attestations: write$/m)
  assert.match(security, /^  pull_request:\n    branches: \[main\]$/m)
  assert.match(security, /^  push:\n    branches: \[main\]$/m)
})

function normalize(value) {
  return value.replaceAll('\r\n', '\n')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
