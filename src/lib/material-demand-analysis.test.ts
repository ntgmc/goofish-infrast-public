import { describe, expect, it } from 'vitest'
import { materialDemandAnalysis, materialDemandAnalysisCsv } from './material-demand-analysis'
import { materialDemandMonths, type MaterialDemandEvent, type MaterialDemandOrigin, type MaterialDemandSnapshot } from './material-demand'

const event = (id: string, date: string, amounts: number[], origin: MaterialDemandOrigin): MaterialDemandEvent => ({
  id, name: id, date, rarity: 6, amounts,
  origins: { direct: [0, 0], purple: [0, 0], gold: [0, 0], [origin]: amounts },
})
const data: MaterialDemandSnapshot = {
  version: 2, asOf: '2026-11-04', gameSha: 'a'.repeat(40), releaseDatesSha256: 'b'.repeat(64),
  materials: [{ id: 'rock', name: '源岩组', icon: 'rock' }, { id: 'new', name: '新材料', icon: 'new' }],
  operators: [event('old', '2024-11-01', [100, 0], 'gold'), event('large', '2025-11-01', [300, 0], 'gold'), event('latest', '2026-10-01', [100, 20], 'direct'), event('partial', '2026-11-01', [9000, 9000], 'direct'), event('future', '2026-12-01', [9999, 9999], 'direct')],
  modules: [event('old-module', '2025-10-01', [100, 0], 'purple'), event('new-module', '2026-03-01', [100, 40], 'purple')],
}

describe('material demand comparisons', () => {
  it('compares full calendar years, separates volume from share, and reconciles content and recipe contributions', () => {
    const [row] = materialDemandAnalysis(data, materialDemandMonths(data))
    expect(row.comparable).toBe(true)
    expect(row.recent).toMatchObject({ start: '2025-11', end: '2026-10', months: 12, total: 500, operators: 400, modules: 100, origins: { direct: 100, purple: 100, gold: 300 } })
    expect(row.previous).toMatchObject({ start: '2024-11', end: '2025-10', months: 12, total: 200, origins: { direct: 0, purple: 100, gold: 100 } })
    expect(row.change).toBe(150)
    expect(row.shareChange).toBeCloseTo(500 / 560 * 100 - 100)
    expect(row.halfYearChange).toBe(-75)
    expect(row.peak).toEqual({ month: '2025-11', amount: 300 })
    expect(row.contributors[0]).toMatchObject({ id: 'large', source: 'operators', amount: 300 })
    expect(row.contributors.some((item) => ['partial', 'future'].includes(item.id))).toBe(false)
    const delta = row.recent.total - row.previous.total
    expect(row.recent.operators - row.previous.operators + row.recent.modules - row.previous.modules).toBe(delta)
    expect(Object.values(row.recent.origins).reduce((a, b) => a + b, 0)).toBe(row.recent.total)
  })

  it('leaves growth unknown for new materials, missing history and zero demand rather than inventing a zero baseline', () => {
    const [, row] = materialDemandAnalysis(data, materialDemandMonths(data))
    expect(row).toMatchObject({ firstDemand: '2026-03', comparable: false, change: null, shareChange: null, halfYearChange: null })
    expect(row.recent.total).toBe(60)
    const empty = { ...data, operators: [], modules: [] }
    const [zero] = materialDemandAnalysis(empty, materialDemandMonths(empty))
    expect(zero).toMatchObject({ firstDemand: null, comparable: false, change: null, shareChange: null, peak: null, contributors: [] })
    expect(zero.recent.share).toBeNull()
    const short = { ...data, operators: [event('short', '2026-10-01', [10, 0], 'direct')], modules: [] }
    expect(materialDemandAnalysis(short, materialDemandMonths(short))[0].change).toBeNull()
  })

  it('exports numeric comparison evidence and leaves unavailable percentages blank', () => {
    const analyses = materialDemandAnalysis(data, materialDemandMonths(data))
    const rows = materialDemandAnalysisCsv(data, analyses).trim().split('\r\n')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toContain('"2025-11","2026-10","2024-11","2025-10"')
    expect(rows[1]).toContain('"500","200","150"')
    expect(rows[2]).toContain('"60","0",""')
  })
})
