import { describe, expect, it } from 'vitest'
import { resolveBaselineHistoryItem } from './reorder-baseline'

describe('reorder baseline resolution', () => {
  const first = { id: 'history-1' }
  const second = { id: 'history-2' }
  const history = [first, second] as never[]

  it('uses the requested immutable history item', () => {
    expect(resolveBaselineHistoryItem(history, 'history-2')).toEqual({ ok: true, item: second })
  })

  it('falls back to the latest history item when no id is supplied', () => {
    expect(resolveBaselineHistoryItem(history, undefined)).toEqual({ ok: true, item: first })
  })

  it('reports empty and missing baselines without optimizer dependencies', () => {
    expect(resolveBaselineHistoryItem([], 'history-1')).toMatchObject({ ok: false, status: 409 })
    expect(resolveBaselineHistoryItem(history, 'missing')).toMatchObject({ ok: false, status: 404 })
  })
})
