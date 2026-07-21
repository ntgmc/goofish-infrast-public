import assert from 'node:assert/strict'
import test from 'node:test'

import { isDocumentationFile, isDocumentationOnly } from './build-relevance-lib.mjs'

test('classifies documentation and README paths', () => {
  assert.equal(isDocumentationFile('README.md'), true)
  assert.equal(isDocumentationFile('docs/getting-started.md'), true)
  assert.equal(isDocumentationFile('docs/site.config.ts'), true)
  assert.equal(isDocumentationFile('nested\\CONTRIBUTING.rst'), true)
})

test('does not classify source, workflow, or dependency files as documentation', () => {
  assert.equal(isDocumentationFile('src/App.tsx'), false)
  assert.equal(isDocumentationFile('.github/workflows/quality-checks.yml'), false)
  assert.equal(isDocumentationFile('requirements-security.txt'), false)
  assert.equal(isDocumentationFile('docs/production-deploy.md'), false)
})

test('requires every changed file to be documentation', () => {
  assert.equal(isDocumentationOnly(['README.md', 'docs/getting-started.md']), true)
  assert.equal(isDocumentationOnly(['README.md', 'src/App.tsx']), false)
  assert.equal(isDocumentationOnly(['README.md', 'docs/worker-deploy.md']), false)
  assert.equal(isDocumentationOnly([]), false)
})
