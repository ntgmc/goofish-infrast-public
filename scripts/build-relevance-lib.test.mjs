import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { isDocumentationFile, isDocumentationOnly } from './build-relevance-lib.mjs'
import {
  BUILD_RELEVANT_FILES,
  BUILD_RELEVANT_PREFIXES,
  BUILD_RELEVANT_SCRIPTS,
} from './build-relevance-config.mjs'

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

test('checks real Git changes for deletions, imported inputs, explicit docs, and fallback deletions', async () => {
  const script = resolve('scripts/check-build-relevance.mjs')
  for (const path of ['public/sitemap.xml', 'tokens.css', 'scripts/changelog-git.mjs', 'scripts/prts-planning-sync.mjs', 'docs/release-artifacts.md', 'product/catalog.json', 'src/index.css', 'README.md', 'mixed', 'fallback']) {
    const directory = await mkdtemp(join(tmpdir(), 'goofish-relevance-'))
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    const put = async (file, contents) => { await mkdir(dirname(join(directory, file)), { recursive: true }); await writeFile(join(directory, file), contents) }
    const commit = () => { git('add', '-A'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD') }
    try {
      git('init', '-q')
      const relevant = path === 'mixed' || path === 'fallback' ? 'public/sitemap.xml' : path
      await put('notes.txt', 'baseline')
      if (path !== 'fallback') await put(relevant, 'baseline')
      const base = commit()
      if (path === 'fallback') { await put(relevant, 'temporary'); await put('notes.txt', 'changed'); commit() }
      if (relevant === 'public/sitemap.xml') await rm(join(directory, relevant))
      else await put(relevant, 'changed')
      if (path === 'mixed') await put('README.md', 'changed docs')
      const head = commit()
      const output = join(directory, '.git', 'github-output')
      const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8', env: { ...process.env, CACHED_COMMIT_REF: base, COMMIT_REF: head, GITHUB_OUTPUT: output } })
      const required = path !== 'README.md'
      assert.equal(result.status, required ? 1 : 0, result.stderr || result.stdout)
      const values = await readFile(output, 'utf8')
      assert.match(values, new RegExp(`build_required=${required}`))
      assert.match(values, new RegExp(`documentation_only=${!required}`))
      if (path === 'fallback') assert.match(result.stdout, /fallback diff/)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
})

test('keeps every repository-local build relevance path anchored to an existing file or directory', async () => {
  for (const path of [...BUILD_RELEVANT_FILES, ...BUILD_RELEVANT_SCRIPTS]) await access(path)
  for (const prefix of BUILD_RELEVANT_PREFIXES) await access(prefix.replace(/\/$/, ''))
})
