import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = normalizeLineEndings(await readFile('.github/workflows/dependency-audit.yml', 'utf8'))

test('reports the production dependency audit for every pull request to main', () => {
  const pullRequestTrigger = readTriggerBlock('pull_request')

  assert.match(pullRequestTrigger, /^  pull_request:\n    branches:\n      - main$/m)
  assert.doesNotMatch(pullRequestTrigger, /^    paths:/m)
  assert.match(workflow, /^    name: Audit Production Dependencies$/m)
})

test('keeps push audits scoped to dependency and workflow changes', () => {
  const pushTrigger = readTriggerBlock('push')

  assert.match(pushTrigger, /^    paths:\n/m)
  for (const path of ['package.json', 'package-lock.json', '.github/workflows/dependency-audit.yml']) {
    assert.match(pushTrigger, new RegExp(`^      - ${escapeRegExp(path)}$`, 'm'))
  }
})

function readTriggerBlock(name) {
  const match = new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z_]+:|^permissions:)`, 'm').exec(workflow)
  assert.ok(match, `missing ${name} workflow trigger`)
  return match[0].trimEnd()
}

function normalizeLineEndings(value) {
  return value.replaceAll('\r\n', '\n')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
