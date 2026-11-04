import { describe, expect, it } from 'vitest'
import { materialDemandChartMax, materialDemandCsv, materialDemandMonths, materialDemandSeries, type MaterialDemandPoint, type MaterialDemandSnapshot } from './material-demand'

const data: MaterialDemandSnapshot = {
  version: 1, asOf: '2026-04-15', gameSha: 'a'.repeat(40), releaseDatesSha256: 'b'.repeat(64),
  materials: [{ id: 'rock', name: '源岩组', icon: 'rock' }, { id: 'sugar', name: '糖组', icon: 'sugar' }],
  operators: [{ id: 'a', name: '干员A', rarity: 6, date: '2026-01-10', amounts: [12, 0], origins: { direct: [12, 0], purple: [0, 0], gold: [0, 0] } }, { id: 'b', name: '干员B', rarity: 4, date: '2026-03-10', amounts: [0, 6], origins: { direct: [0, 6], purple: [0, 0], gold: [0, 0] } }],
  modules: [{ id: 'm', name: '老干员模组', rarity: 6, date: '2026-03-20', amounts: [6, 0], origins: { direct: [6, 0], purple: [0, 0], gold: [0, 0] } }, { id: 'future', name: '未来模组', rarity: 6, date: '2026-05-01', amounts: [100, 100], origins: { direct: [100, 100], purple: [0, 0], gold: [0, 0] } }],
}

describe('material demand timeline', () => {
  it('combines operator and module costs by their own dates, preserving zero months and a partial current month', () => {
    const months = materialDemandMonths(data)
    expect(months.map((row) => [row.month, row.total, row.partial])).toEqual([
      ['2026-01', 12, false], ['2026-02', 0, false], ['2026-03', 12, false], ['2026-04', 0, true],
    ])
    expect(months[2]).toMatchObject({ operators: [0, 6], modules: [6, 0], operatorCount: 1, moduleCount: 1 })
  })

  it('averages over calendar months rather than events and computes shares using combined window totals', () => {
    const months = materialDemandMonths(data)
    const amount = materialDemandSeries(months, 0, 'amount', 3)
    expect(amount.map((row) => row.value)).toEqual([null, null, 6, null])
    expect(amount[2]).toMatchObject({ operators: 4, modules: 2, operatorCount: 2, moduleCount: 1 })
    const share = materialDemandSeries(months, 0, 'share', 3)
    expect(share[2]).toMatchObject({ operators: 50, modules: 25, value: 75 })
    expect(materialDemandSeries(months, 0, 'share', 1)[1]).toMatchObject({ value: null, raw: null })
    expect(materialDemandSeries(months, 0, 'amount', 1)[1].value).toBe(0)
  })

  it('focuses the chart on normal variation while keeping launch and raw peaks available at full scale', () => {
    const points: MaterialDemandPoint[] = Array.from({ length: 40 }, (_, index) => {
      const value = index === 0 ? 1000 : index === 39 ? 140 : 100
      return { month: String(index), value, raw: index === 0 ? 5000 : index === 39 ? 160 : 120, operators: value * 0.6, modules: value * 0.4, operatorCount: 1, moduleCount: 1 }
    })
    const original = structuredClone(points)
    expect(materialDemandChartMax(points)).toBeCloseTo(151.2)
    expect(materialDemandChartMax(points, { fullScale: true })).toBe(1080)
    expect(materialDemandChartMax(points, { rawPoints: true })).toBeCloseTo(172.8)
    expect(materialDemandChartMax(points, { rawPoints: true, fullScale: true })).toBe(5400)
    expect(points).toEqual(original)
  })

  it('keeps normal peaks and newly introduced materials at full height and handles empty or zero demand', () => {
    const point = (value: number | null): MaterialDemandPoint => ({ month: '', value, raw: value, operators: value, modules: 0, operatorCount: 0, moduleCount: 0 })
    expect(materialDemandChartMax([point(100), point(120)])).toBeCloseTo(129.6)
    expect(materialDemandChartMax([...Array.from({ length: 30 }, () => point(0)), point(100), point(1000)])).toBe(1080)
    expect(materialDemandChartMax([point(null), point(0)])).toBeCloseTo(5.4)
    expect(materialDemandChartMax([], { share: true })).toBeCloseTo(1.08)
  })

  it('includes the last month when the snapshot covers its last day and exports separate source quantities', () => {
    const months = materialDemandMonths({ ...data, asOf: '2026-03-31' })
    expect(months[months.length - 1]?.partial).toBe(false)
    const csv = materialDemandCsv(data, months)
    expect(csv).toContain('"2026-03","完整","rock","源岩组","0","6","6","50","1","1"')
    expect(csv).not.toContain('future')
  })
})
