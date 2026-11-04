import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { benchmarkMedian, regularBenchmarkComparison, siteBenchmark as data } from './site-benchmark'

const publicFile = (name: string) => new URL(`../../public/benchmarks/${data.date}/${name}`, import.meta.url)

describe('frozen public benchmark evidence', () => {
  it('preserves all 90 results and keeps execution failures separate from yield comparisons', () => {
    expect(data.cases).toHaveLength(90)
    expect(new Set(data.cases.map((item) => item.id)).size).toBe(90)
    expect(data.sites.map((site) => data.cases.filter((item) => item.site === site.id && item.passed).length)).toEqual([30, 5, 5])
    expect(data.sites.map((site) => data.cases.filter((item) => item.site === site.id).reduce((total, item) => total + item.moodErrors, 0))).toEqual([0, 147, 216])
    expect(data.cases.filter((item) => !item.stable)).toHaveLength(10)
    expect(data.cases.filter((item) => !item.passed).every((item) => item.resources.sanity > 0)).toBe(true)
    expect(data.verification.commonFixturesConfirmed).toBe(false)
    expect(data.verification.gameExecutionTested).toBe(false)
    expect(data.verification.longTermSupplyTested).toBe(false)
    expect(data.verification.structurePassed).toBe(90)

    const groups = [['S1', 'yituliu'], ['S1', 'riic'], ['S2', 'yituliu'], ['S2', 'riic']].map(([layout, site]) => regularBenchmarkComparison(layout, site))
    expect(groups.map(({ counts }) => Object.values(counts).reduce((sum, count) => sum + count, 0))).toEqual([10, 10, 10, 10])
    expect(groups.map(({ counts }) => counts.onlyMaaToolPasses)).toEqual([7, 6, 8, 10])
    expect(groups.map(({ counts }) => counts.bothPassMaaToolHigher)).toEqual([3, 4, 0, 0])
    expect(groups.map(({ counts }) => counts.bothPassClose)).toEqual([0, 0, 2, 0])
    expect(groups.map(({ pairs }) => pairs.length)).toEqual([3, 4, 2, 0])
    expect(groups[0].median).toBeCloseTo(2.08, 2)
    expect(groups[1].median).toBeCloseTo(2.30, 2)
    expect(groups[2].median).toBeCloseTo(0.38, 2)
    expect(groups[3].median).toBeNull()
    const pairs = groups.flatMap((group) => group.pairs)
    expect(pairs).toHaveLength(9)
    expect(pairs.every((pair) => pair.deltaPercent > 0)).toBe(true)
    expect(pairs.filter((pair) => pair.deltaPercent > 1)).toHaveLength(7)
  })

  it('excludes recycling from all scores and charges shard materials once while retaining provenance', () => {
    expect(data.scoring.recyclingRevenue).toBe('excluded')
    expect(data.cases.every((item) => item.resources.recyclingSanity === 0)).toBe(true)
    expect(data.cases.filter((item) => item.provenance.retainedOriginal)).toHaveLength(30)
    expect(data.cases.filter((item) => item.site === 'riic').every((item) => item.provenance.generatedAt.startsWith(data.generation.riicOriginalDate))).toBe(true)
    expect(data.cases.filter((item) => item.site === 'maatool').every((item) => item.provenance.generationVersion === data.simulatorVersion)).toBe(true)
    const costs = data.cases.filter((item) => item.layout === 'S3')
    expect(costs).toHaveLength(30)
    for (const item of costs) {
      const cost = item.opportunityCost!
      const baseline = data.cases.find((candidate) => candidate.sample === item.sample && candidate.site === item.site && candidate.layout === cost.baselineScenario)!
      expect(cost.foregoneProduction).toBeCloseTo(baseline.resources.sanity - item.resources.sanity, 8)
      expect(cost.materialCost).toBeCloseTo(item.resources.shardsConsumed * 15.36, 8)
      expect(cost.perOrundum).toBeCloseTo((cost.foregoneProduction + cost.materialCost) / item.resources.orundum, 8)
    }
    expect(benchmarkMedian(costs.filter((item) => item.site === 'maatool').map((item) => item.opportunityCost!.perOrundum))).toBeCloseTo(1.8064, 4)
    expect(costs.some((item) => item.resources.shardsNet < 0)).toBe(true)
    const validCosts = costs.filter((item) => item.passed && data.cases.find((baseline) => baseline.sample === item.sample && baseline.site === item.site && baseline.layout === item.opportunityCost!.baselineScenario)!.passed)
    expect(validCosts.every((item) => item.site === 'maatool')).toBe(true)
  })

  it('retains the historical snapshot and all its downloadable checksums', async () => {
    const archiveFile = (name: string) => new URL(`../../public/benchmarks/2026-10-31/${name}`, import.meta.url)
    const archived = JSON.parse(await readFile(archiveFile('results.json'), 'utf8'))
    expect(archived).toEqual(JSON.parse(await readFile(new URL('../data/site-benchmark-2026-10-31.json', import.meta.url), 'utf8')))
    expect(archived.simulatorVersion).toMatch(/^2\.0\.1120@/)
    expect(archived.cases.filter((item: { passed: boolean }) => item.passed)).toHaveLength(41)
    const manifest = await readFile(archiveFile('SHA256SUMS'), 'utf8')
    await Promise.all(manifest.trim().split('\n').map(async (line) => {
      const [expected, name] = line.split('  ')
      expect(createHash('sha256').update(await readFile(archiveFile(name))).digest('hex'), name).toBe(expected)
    }))
  })

  it('binds every downloadable artifact and case to the same sanitized snapshot', async () => {
    const published = await readFile(publicFile('results.json'), 'utf8')
    expect(JSON.parse(published)).toEqual(data)
    const manifest = await readFile(publicFile('SHA256SUMS'), 'utf8')
    const files = await Promise.all(manifest.trim().split('\n').map(async (line) => {
      const [expected, name] = line.split('  ')
      const contents = await readFile(publicFile(name))
      expect(createHash('sha256').update(contents).digest('hex'), name).toBe(expected)
      return { name, contents }
    }))
    expect(files.filter((file) => file.name.startsWith('cases/'))).toHaveLength(90)
    const forbidden = /"(?:author|cache_key|profile_id|job_id|diagnosticId|sourceName|cookie|password|token|session|authorization)"|\/home\/|\.cache\/|skland-operators-|[a-z\d._+-]+@[a-z\d.-]+\.[a-z]{2,}/i
    for (const { name, contents } of files.filter((file) => file.name !== 'evidence.zip')) {
      expect(forbidden.test(contents.toString('utf8')), `public field boundary: ${name}`).toBe(false)
      if (!name.startsWith('cases/')) continue
      const evidence = JSON.parse(contents.toString('utf8'))
      const item = data.cases.find((item) => `${item.id}.json` === name.split('/').pop())!
      expect(evidence.result).toEqual(item)
      expect(evidence.nativePlans).toHaveLength(3)
      expect(evidence.simulatedPlans).toHaveLength(3)
      expect(evidence.mood.passed).toBe(item.passed)
      expect(evidence.dormitoryDiagnosis !== null).toBe(item.site === 'yituliu')
    }
    for (const conflict of data.conflicts) {
      const evidence = JSON.parse(await readFile(publicFile(`cases/${conflict.caseId}.json`), 'utf8'))
      expect(evidence.simulatedPlans[0].moodErrors).toContainEqual(expect.objectContaining({ operator: conflict.operator, start: conflict.start, needed: conflict.needed }))
    }
  })
})
