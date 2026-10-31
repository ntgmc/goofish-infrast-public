import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { benchmarkMedian, regularBenchmarkComparison, siteBenchmark as data } from './site-benchmark'

const publicFile = (name: string) => new URL(`../../public/benchmarks/2026-10-31/${name}`, import.meta.url)

describe('frozen public benchmark evidence', () => {
  it('preserves all 90 results and keeps execution failures separate from yield comparisons', () => {
    expect(data.cases).toHaveLength(90)
    expect(new Set(data.cases.map((item) => item.id)).size).toBe(90)
    expect(data.sites.map((site) => data.cases.filter((item) => item.site === site.id && item.passed).length)).toEqual([30, 6, 5])
    expect(data.sites.map((site) => data.cases.filter((item) => item.site === site.id).reduce((total, item) => total + item.moodErrors, 0))).toEqual([0, 133, 216])
    expect(data.cases.filter((item) => !item.stable)).toHaveLength(10)
    expect(data.cases.filter((item) => !item.passed).every((item) => item.resources.sanity > 0)).toBe(true)
    expect(data.verification.commonFixturesConfirmed).toBe(false)
    expect(data.verification.gameExecutionTested).toBe(false)
    expect(data.verification.longTermSupplyTested).toBe(false)
    expect(data.verification.structurePassed).toBe(90)

    const groups = [['S1', 'yituliu'], ['S1', 'riic'], ['S2', 'yituliu'], ['S2', 'riic']].map(([layout, site]) => regularBenchmarkComparison(layout, site))
    expect(groups.map(({ counts }) => Object.values(counts).reduce((sum, count) => sum + count, 0))).toEqual([10, 10, 10, 10])
    expect(groups.map(({ counts }) => counts.onlyMaaToolPasses)).toEqual([6, 6, 8, 10])
    expect(groups.map(({ counts }) => counts.bothPassMaaToolHigher)).toEqual([3, 4, 0, 0])
    expect(groups.map(({ counts }) => counts.bothPassClose)).toEqual([1, 0, 2, 0])
    expect(groups.map(({ pairs }) => pairs.length)).toEqual([4, 4, 2, 0])
    expect(groups[0].median).toBeCloseTo(2.23, 2)
    expect(groups[1].median).toBeCloseTo(7.26, 2)
    expect(groups[2].median).toBeCloseTo(0.32, 2)
    expect(groups[3].median).toBeNull()
    const pairs = groups.flatMap((group) => group.pairs)
    expect(pairs).toHaveLength(10)
    expect(pairs.every((pair) => pair.deltaPercent > 0)).toBe(true)
    expect(pairs.filter((pair) => pair.deltaPercent > 1)).toHaveLength(7)
  })

  it('retains opportunity-cost components, deficits and unavailable historical readings', () => {
    const costs = data.cases.filter((item) => item.layout === 'S3')
    expect(costs).toHaveLength(30)
    for (const item of costs) {
      const cost = item.opportunityCost!
      const baseline = data.cases.find((candidate) => candidate.sample === item.sample && candidate.site === item.site && candidate.layout === cost.baselineScenario)!
      expect(cost.foregoneProduction).toBeCloseTo(baseline.resources.sanity - item.resources.sanity, 8)
      expect(cost.materialCost).toBeCloseTo(item.resources.shardsConsumed * 15.36, 8)
      expect(cost.perOrundum).toBeCloseTo((cost.foregoneProduction + cost.materialCost) / item.resources.orundum, 8)
    }
    expect(benchmarkMedian(costs.filter((item) => item.site === 'maatool').map((item) => item.opportunityCost!.perOrundum))).toBeCloseTo(1.7580, 4)
    expect(costs.some((item) => item.resources.shardsNet < 0)).toBe(true)
    expect(data.maatoolChanges).toHaveLength(30)
    expect(data.maatoolChanges.filter((item) => item.previous === null).map((item) => `${item.account}/${item.scenario}`)).toEqual(['A03/S3', 'A07/S3'])
    expect(data.maatoolChanges.some((item) => item.scenario === 'S1' && item.delta !== null && item.delta < 0)).toBe(true)
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
