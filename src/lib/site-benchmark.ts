import snapshot from '../data/site-benchmark-2026-10-31.json'

export const siteBenchmark = snapshot
export const BENCHMARK_ASSETS = `/benchmarks/${snapshot.date}`
export type BenchmarkCase = typeof snapshot.cases[number]

export function benchmarkMedian(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function regularBenchmarkComparison(layout: string, opponent: string) {
  const counts = { onlyMaaToolPasses: 0, bothPassMaaToolHigher: 0, bothPassClose: 0, bothPassMaaToolLower: 0, onlyRivalPasses: 0, bothFail: 0 }
  const pairs: { sample: string; deltaPercent: number }[] = []
  for (const sample of snapshot.samples) {
    const own = snapshot.cases.find((item) => item.sample === sample.alias && item.layout === layout && item.site === 'maatool')!
    const rival = snapshot.cases.find((item) => item.sample === sample.alias && item.layout === layout && item.site === opponent)!
    if (own.passed && rival.passed) {
      const ratio = own.resources.sanity / rival.resources.sanity
      pairs.push({ sample: sample.alias, deltaPercent: (ratio - 1) * 100 })
      if (ratio > 1.01) counts.bothPassMaaToolHigher++
      else if (ratio < 0.99) counts.bothPassMaaToolLower++
      else counts.bothPassClose++
    } else if (own.passed) counts.onlyMaaToolPasses++
    else if (rival.passed) counts.onlyRivalPasses++
    else counts.bothFail++
  }
  return { counts, pairs, median: benchmarkMedian(pairs.map((pair) => pair.deltaPercent)) }
}

export function benchmarkCasePath(item: BenchmarkCase): string {
  return `/v2/benchmarks?${new URLSearchParams({ sample: item.sample, layout: item.layout, site: item.site })}#benchmark-data`
}

export function benchmarkNumber(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
