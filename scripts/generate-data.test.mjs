import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const dataOutput = resolve(root, 'server/handlers/.generated/data.ts')
const metaOutput = resolve(root, 'src/lib/.generated/build-meta.ts')
const sourcePath = resolve(root, 'server/handlers/efficiency-data.json')
const sha = '0123456789abcdef0123456789abcdef01234567'

test('generates deterministic ignored modules and content-addressed data versions', async () => {
  const generatedAt = '2026-07-18T00:00:00.000Z'
  runGenerate({ GENERATED_AT: generatedAt, VERSION_SOURCE_SHA: sha })
  const firstData = await readFile(dataOutput, 'utf8')
  const firstMeta = await readFile(metaOutput, 'utf8')
  runGenerate({ GENERATED_AT: generatedAt, VERSION_SOURCE_SHA: sha })
  assert.equal(await readFile(dataOutput, 'utf8'), firstData)
  assert.equal(await readFile(metaOutput, 'utf8'), firstMeta)

  const sourceHash = createHash('sha256').update(await readFile(sourcePath, 'utf8')).digest('hex').slice(0, 12)
  assert.match(firstMeta, new RegExp(`"data_version": "data\\.${sourceHash}"`))
  assert.match(firstMeta, new RegExp(`"git_sha": "${sha}"`))
})

test('honors explicit release metadata', async () => {
  runGenerate({
    DATA_VERSION: 'data.explicit',
    GENERATED_AT: '2026-07-18T01:02:03.000Z',
    FRONTEND_VERSION: '9.8.7',
    BACKEND_VERSION: '9.8.6',
    VERSION_SOURCE_SHA: sha,
  })
  const meta = await readFile(metaOutput, 'utf8')
  assert.match(meta, /"data_version": "data\.explicit"/)
  assert.match(meta, /"frontend_version": "9\.8\.7"/)
  assert.match(meta, /"backend_version": "9\.8\.6"/)
  assert.match(meta, /"generated_at": "2026-07-18T01:02:03\.000Z"/)
})

function runGenerate(environment) {
  const result = spawnSync(process.execPath, ['scripts/generate-data.mjs'], {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}
