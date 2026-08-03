import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  PUBLIC_EFFICIENCY_DATA_FALLBACK,
  readEfficiencyDataSource,
} from './efficiency-data-source.mjs'

const root = resolve(import.meta.dirname, '..')
const dataOutput = resolve(root, 'server/handlers/.generated/data.ts')
const metaOutput = resolve(root, 'src/lib/.generated/build-meta.ts')
const sourcePath = resolve(root, 'server/handlers/efficiency-data.json')
const sha = '0123456789abcdef0123456789abcdef01234567'

test('generates deterministic ignored modules and content-addressed data versions', async () => {
  const generatedAt = '2026-07-18T00:00:00.000Z'
  runGenerate({ GENERATED_AT: generatedAt, DATA_SOURCE_UPDATED_AT: generatedAt, VERSION_SOURCE_SHA: sha })
  const firstData = await readFile(dataOutput, 'utf8')
  const firstMeta = await readFile(metaOutput, 'utf8')
  runGenerate({ GENERATED_AT: generatedAt, DATA_SOURCE_UPDATED_AT: generatedAt, VERSION_SOURCE_SHA: sha })
  assert.equal(await readFile(dataOutput, 'utf8'), firstData)
  assert.equal(await readFile(metaOutput, 'utf8'), firstMeta)

  const sourceHash = createHash('sha256').update(await readEfficiencyDataSource(sourcePath)).digest('hex').slice(0, 12)
  assert.match(firstMeta, new RegExp(`"data_version": "data\\.${sourceHash}"`))
  assert.match(firstMeta, /"source_mode": "public_fallback"/)
  assert.match(firstMeta, /"data_content_sha256": "[0-9a-f]{64}"/)
  assert.match(firstMeta, /"build_generated_at": "2026-07-18T00:00:00\.000Z"/)
  assert.match(firstMeta, /"data_source_updated_at": "2026-07-18T00:00:00\.000Z"/)
  assert.match(firstMeta, new RegExp(`"git_sha": "${sha}"`))
})

test('uses an empty public fallback when the private efficiency source is absent', async () => {
  const missingSource = resolve(root, `.cache/missing-efficiency-data-${process.pid}.json`)
  assert.deepEqual(
    JSON.parse(await readEfficiencyDataSource(missingSource)),
    PUBLIC_EFFICIENCY_DATA_FALLBACK,
  )
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
  assert.match(meta, /"expected_backend_version": "9\.8\.6"/)
  assert.match(meta, /"generated_at": "2026-07-18T01:02:03\.000Z"/)
})

test('fails closed when a release expects full efficiency data', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-data.mjs'], {
    cwd: root,
    env: { ...process.env, EFFICIENCY_DATA_EXPECTED_MODE: 'full' },
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /source mode mismatch/)
})

function runGenerate(environment) {
  const result = spawnSync(process.execPath, ['scripts/generate-data.mjs'], {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}
