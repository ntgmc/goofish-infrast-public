import { describe, expect, it } from 'vitest'
import { createOperationsOverview } from '../test/operations-overview-fixture'
import { isOperationsDate, operationsDate, operationsOverviewCsv, shiftOperationsDate } from './operations-overview'

describe('business report boundaries', () => {
  it('uses Shanghai calendar boundaries and rejects impossible dates', () => {
    expect(operationsDate(new Date('2026-01-01T16:00:00Z'))).toBe('2026-01-02')
    expect(shiftOperationsDate('2024-03-01', -1)).toBe('2024-02-29')
    expect(isOperationsDate('2024-02-29')).toBe(true)
    expect(isOperationsDate('2026-02-29')).toBe(false)
    expect(isOperationsDate('0000-01-01')).toBe(false)
  })

  it('keeps missing metrics empty in CSV and escapes strings and spreadsheet formulas', () => {
    const data = createOperationsOverview()
    data.current.maa.rate = null
    data.failure_reasons = [{ reason_code: '=SUM(1,2)', count: 3 }, { reason_code: 'quoted,"reason"', count: 1 }]
    const csv = operationsOverviewCsv(data)
    expect(csv).toContain('"maa","rate","","","80"')
    expect(csv).toContain('"coverage","complete","","true","true"')
    expect(csv).toContain('"failure_reason","\'=SUM(1,2)","","3",""')
    expect(csv).toContain('"failure_reason","quoted,""reason""","","1",""')
    expect(csv).toContain('"metadata","timezone","","Asia/Shanghai"')
    expect(csv.split('\n').every((row) => row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length === 5)).toBe(true)
  })
})
