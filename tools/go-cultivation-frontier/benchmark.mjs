import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, platform, arch } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const directory = dirname(fileURLToPath(import.meta.url))
const options = { rounds: 9, evidence: null, output: join(root, '.cache/go-cultivation-frontier/report.json') }
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index].slice(2)
  assert(process.argv[index].startsWith('--') && Object.hasOwn(options, key) && process.argv[index + 1], 'Use --rounds N --evidence FILE --output FILE')
  options[key] = key === 'rounds' ? Number(process.argv[index + 1]) : resolve(process.argv[index + 1])
}
assert(Number.isInteger(options.rounds) && options.rounds >= 3, 'Use at least three timing rounds')
const work = dirname(options.output)
await mkdir(work, { recursive: true })
const sourcePath = join(root, 'server/cultivation/recommendations.ts')
const source = await readFile(sourcePath, 'utf8')
const startMarker = '      const frontier: Array<{ target: CultivationTarget; covered: Sample[] }> = []'
const endMarker = '      for (const row of frontier) {'
const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start)
assert(start >= 0 && end > start && source.indexOf(startMarker, start + 1) < 0 && source.indexOf(endMarker, end + 1) < 0, 'Frontier source changed; update the benchmark boundary')
const original = source.slice(start, end)
const dimensionsStart = source.indexOf('      const values = (field:')
const dimensionsEnd = source.indexOf('      const maxima =', dimensionsStart)
assert(dimensionsStart >= 0 && dimensionsEnd > dimensionsStart && dimensionsEnd < start, 'Frontier dimensions changed')
const dimensions = source.slice(dimensionsStart, dimensionsEnd)
// Instrument only the generated benchmark bundle; production source stays intact.
const instrumented = source.slice(0, start) + `      const frontier = prototypeHook({ group, base, maxima, module, coverage: query.coverage }, () => {\n${original}\nreturn frontier\n})\n` + source.slice(end) + `
let prototypeHook = (_input, solve) => solve()
export function setPrototypeHook(hook) { prototypeHook = hook }
export function referenceFrontier({ group, base, maxima, module, coverage }) {
  const query = { coverage }
  const branchWeight = group.reduce((sum, row) => sum + row.weight, 0)
${dimensions}
${original}
  return frontier
}
`
const bundle = join(work, 'reference.mjs')
const buildOptions = {
  absWorkingDir: root, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  stdin: { contents: `export * from './server/cultivation/recommendations.ts'; export * from './server/cultivation/public-evidence.ts'; export { defaultCultivationQuery } from './src/lib/cultivation-contract.ts'; export { prtsSnapshotSchema } from './server/cultivation/catalog.ts'; export { cultivationDayStart } from './server/cultivation/cache-policy.ts'`, resolveDir: root, loader: 'ts' },
}
await build({
  ...buildOptions, outfile: bundle,
  plugins: [{ name: 'frontier-probe', setup(builder) {
    builder.onLoad({ filter: /\/cultivation\/recommendations\.ts$/ }, () => ({ contents: instrumented, loader: 'ts', resolveDir: dirname(sourcePath) }))
  } }],
})
const reference = await import(pathToFileURL(bundle).href)
const productionBundle = join(work, 'production.mjs')
await build({ ...buildOptions, outfile: productionBundle })
const production = await import(pathToFileURL(productionBundle).href)
const binary = join(work, 'frontier-go')
execFileSync('go', ['build', '-trimpath', '-o', binary, '.'], { cwd: directory, stdio: 'pipe' })
const hash = (value) => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex')
const elapsed = (started) => performance.now() - started
const summary = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], min: sorted[0], max: sorted.at(-1) }
}
const packedRows = (rows, group) => rows.map(({ target, covered }) => ({ target, covered: covered.map((sample) => group.indexOf(sample)) }))
const normalize = ({ group, base, maxima, module, coverage }) => ({ base, maxima: maxima ?? [],
  module: module ? { elite: Number(String(module.unlockEvolvePhase ?? 'PHASE_2').slice(-1)), level: Number(module.unlockLevel) } : null,
  coverage, samples: group.map(({ requirement, weight }) => ({ target: requirement.target, weight })) })
const unpack = (rows, input) => rows.map(({ target, covered }) => ({ target, covered: covered.map((index) => input.group[index]) }))
const toReference = (task) => ({ ...task, group: task.samples.map(({ target, weight }) => ({ requirement: { target }, weight })),
  module: task.module ? { unlockEvolvePhase: `PHASE_${task.module.elite}`, unlockLevel: task.module.level } : null })

function worker() {
  const child = spawn(binary, [], { env: { ...process.env, GOMAXPROCS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const exit = once(child, 'exit')
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  return {
    async request(tasks) {
      child.stdin.write(`${JSON.stringify({ tasks })}\n`)
      const next = await lines.next()
      assert(!next.done, `Go worker exited: ${stderr}`)
      return JSON.parse(next.value)
    },
    async close() {
      child.stdin.end()
      const [code] = await exit
      assert.equal(code, 0, stderr)
    },
    async stop() { child.kill(); await exit },
  }
}

const persistent = worker()
let completed = false
try {
  // Seeded differential inputs include elite resets, module/skill unlocks, caps and zero weights.
  let seed = 42904
  const random = (limit) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit }
  const differential = Array.from({ length: 240 }, (_, index) => {
    const base = { elite: 2, level: 1, skill: random(4), skillLevel: 1, moduleId: index % 3 ? null : 'mod_x', moduleLevel: null, potential: 1 }
    return { base, maxima: index % 11 ? [50, 60, 90] : [], module: base.moduleId ? { elite: 2, level: 40 } : null,
      coverage: [0.6, 0.8, 0.9, 1, 0.5000000005][index % 5], samples: Array.from({ length: random(35) }, () => ({
        target: { ...base, elite: random(3), level: 1 + random(90), skillLevel: 1 + random(10), potential: 1 + random(6) }, weight: random(101) / 100,
      })) }
  })
  const expected = differential.map((task) => {
    const input = toReference(task)
    return packedRows(reference.referenceFrontier(input), input.group)
  })
  assert.deepEqual((await persistent.request(differential)).results, expected)

  const now = Date.parse('2026-10-08T12:00:00Z')
  function fixture(count, varied) {
    const snapshot = reference.prtsSnapshotSchema.parse(planningFixture())
    snapshot.costs.levels.maxLevel[3] = [50, 60, 90]
    snapshot.homeworks = Array.from({ length: count }, (_, index) => ({ ...snapshot.homeworks[0], id: index + 1,
      stageId: `main_${index % 2}`, uploadedAt: new Date(now - 7 * 86400000).toISOString(),
      content: { opers: [{ name: '测试干员', skill: 1, requirements: { elite: 2, level: varied ? 1 + index % 40 : 20, skill_level: varied ? 7 + index % 4 : 7, potentiality: varied ? 1 + index % 6 : 1, module: 0 } }],
        actions: [{ type: 'Deploy', name: '测试干员', location: [index, 0], direction: 'Right' }] },
    }))
    return snapshot
  }
  const scenarios = []
  for (const [name, snapshot] of [['fixture-small', fixture(3, false)], ['fixture-varied-120', fixture(120, true)]]) {
    scenarios.push({ name, snapshot, prepared: reference.prepareRecommendations(snapshot), now, origin: 'synthetic' })
  }
  let evidenceHash = null
  if (options.evidence) {
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(options.evidence, { readOnly: true })
    let saved
    try { saved = database.prepare('SELECT catalog, prepared FROM snapshot WHERE id = 1').get() } finally { database.close() }
    assert(saved, 'No prepared public evidence in database')
    const snapshot = reference.prtsSnapshotSchema.parse(JSON.parse(gunzipSync(saved.catalog)))
    const packed = JSON.parse(gunzipSync(saved.prepared))
    evidenceHash = hash(Buffer.concat([saved.catalog, saved.prepared]))
    scenarios.push({ name: 'public-evidence', snapshot, prepared: reference.unpackPreparedEvidence(packed, snapshot),
      now: reference.cultivationDayStart(Date.parse(snapshot.updatedAt)), origin: 'cached-public-data' })
  }

  const reports = []
  for (const scenario of scenarios) for (const coverage of [0.6, 0.8, 0.9]) {
    const query = { ...reference.defaultCultivationQuery, coverage, rarityGroup: 'all' }
    const inputs = []
    reference.setPrototypeHook((input, solve) => { inputs.push({ input, solve }); return solve() })
    const calculate = () => reference.calculateCultivationRecommendations(scenario.snapshot, query, scenario.now, scenario.prepared)
    const baseline = reference.compactRecommendations(calculate())
    const productionQuery = () => production.compactRecommendations(production.calculateCultivationRecommendations(scenario.snapshot, query, scenario.now, scenario.prepared))
    assert.deepEqual(productionQuery(), baseline)
    const tasks = () => inputs.map(({ input }) => normalize(input))
    const normalized = tasks()
    const expected = inputs.map(({ input, solve }) => {
      const rows = solve()
      assert.deepEqual(reference.referenceFrontier(input), rows)
      return packedRows(rows, input.group)
    })
    const go = await persistent.request(normalized)
    assert.deepEqual(go.results, expected)
    let position = 0
    reference.setPrototypeHook((input) => {
      assert.deepEqual(normalize(input), normalized[position], 'Task order or input changed')
      return unpack(go.results[position++], input)
    })
    assert.deepEqual(reference.compactRecommendations(calculate()), baseline)
    assert.equal(position, inputs.length)
    const tsTask = [], goKernel = [], goWarm = [], goCold = [], tsQuery = []
    const timeTS = () => {
      const started = performance.now()
      const rows = inputs.map(({ input }) => reference.referenceFrontier(input))
      tsTask.push(elapsed(started))
      assert.deepEqual(rows.map((rows, index) => packedRows(rows, inputs[index].input.group)), expected)
    }
    const timeGo = async () => {
      const started = performance.now()
      const response = await persistent.request(tasks())
      const rows = response.results.map((rows, index) => unpack(rows, inputs[index].input))
      goWarm.push(elapsed(started))
      goKernel.push(response.kernelMs)
      assert.equal(rows.length, expected.length)
      assert.deepEqual(response.results, expected)
    }
    // Warm both implementations before alternating their timed order.
    for (let i = 0; i < 3; i++) { timeTS(); await timeGo(); productionQuery() }
    tsTask.length = goKernel.length = goWarm.length = 0
    for (let round = 0; round < options.rounds; round++) {
      if (round % 2) { await timeGo(); timeTS() } else { timeTS(); await timeGo() }
      const queryStarted = performance.now()
      const result = productionQuery()
      tsQuery.push(elapsed(queryStarted))
      assert.deepEqual(result, baseline)
      const coldStarted = performance.now()
      const cold = worker()
      try {
        const response = await cold.request(tasks())
        const rows = response.results.map((rows, index) => unpack(rows, inputs[index].input))
        await cold.close()
        goCold.push(elapsed(coldStarted))
        assert.equal(rows.length, expected.length)
        assert.deepEqual(response.results, expected)
      } finally { await cold.stop() }
    }
    const distributions = { tsFrontierMs: summary(tsTask), goKernelMs: summary(goKernel), goWarmTaskMs: summary(goWarm), goColdTaskMs: summary(goCold), tsQueryMs: summary(tsQuery) }
    const report = { scenario: scenario.name, origin: scenario.origin, now: scenario.now, query, tasks: normalized.length,
      samples: normalized.reduce((sum, task) => sum + task.samples.length, 0), inputSha256: hash(normalized), outputSha256: hash(baseline),
      requestBytes: Buffer.byteLength(JSON.stringify({ tasks: normalized })), parity: 'exact', distributions,
      samplesMs: { tsTask, goKernel, goWarm, goCold, tsQuery },
      warmTaskSpeedup: distributions.tsFrontierMs.median / distributions.goWarmTaskMs.median,
      coldTaskSpeedup: distributions.tsFrontierMs.median / distributions.goColdTaskMs.median,
      frontierShare: distributions.tsFrontierMs.median / distributions.tsQueryMs.median }
    reports.push(report)
    console.log(JSON.stringify({ scenario: report.scenario, coverage, tasks: report.tasks, ...distributions, warmTaskSpeedup: report.warmTaskSpeedup }))
  }
  const resourceLimit = async (path) => readFile(path, 'utf8').then((value) => value.trim(), () => null)
  const report = { recordedAt: new Date().toISOString(), repositoryHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSha256: { reference: hash(source), go: hash(await readFile(join(directory, 'main.go'))), benchmark: hash(await readFile(fileURLToPath(import.meta.url))) },
    runtime: { node: process.version, go: execFileSync('go', ['version'], { encoding: 'utf8' }).trim(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
      affinity: (await readFile('/proc/self/status', 'utf8')).match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1] ?? null, goMaxProcs: 1,
      cgroupCpuMax: await resourceLimit('/sys/fs/cgroup/cpu.max'), cgroupMemoryMax: await resourceLimit('/sys/fs/cgroup/memory.max'), concurrency: 1 },
    rounds: options.rounds, percentile: 'nearest-rank', differentialCases: differential.length, evidenceSha256: evidenceHash,
    timing: 'Warm Go includes task projection, JSON, IPC and result reconstruction. Cold also includes process startup and exit. TS query includes recommendation calculation and compaction with prepared evidence already loaded. Loading, compilation, assertions and profile sampling are excluded. Task and query samples are separate measurements.',
    productionReplacement: false, reports }
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Exact differential parity: ${differential.length} cases. Report: ${options.output}`)
  completed = true
} finally {
  if (completed) await persistent.close()
  else await persistent.stop()
}
