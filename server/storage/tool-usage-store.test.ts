import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recordToolRun } from './tool-usage-store'

const query = vi.hoisted(() => vi.fn())
vi.mock('./postgres', () => ({ query }))

beforeEach(() => { query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 }) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('measures tool processing before reporting and preserves the authenticated owner', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-09T08:00:01Z'))
  query.mockImplementationOnce(async () => {
    vi.setSystemTime(new Date('2026-11-09T08:00:06Z'))
    return { rows: [], rowCount: 1 }
  })
  await recordToolRun({ tool: 'cultivation_projects', userId: 'user-1', startedAt: Date.parse('2026-11-09T08:00:00Z'), outcome: 'success' })
  const write = query.mock.calls.find(([sql]) => sql.includes('record_json, user_id)'))
  expect(JSON.parse(write![1][7])).toMatchObject({ tool: 'cultivation_projects', user_id: 'user-1', status: 'success', duration_ms: 1_000,
    created_at: '2026-11-09T08:00:01.000Z' })
  expect(write![1][8]).toBe('user-1')
})

it('keeps anonymous cancellation separate from failures and survives reporting outages', async () => {
  await recordToolRun({ tool: 'depot_value', visitorId: 'browser-1', startedAt: Date.now(), outcome: 'cancelled' })
  const write = query.mock.calls.find(([sql]) => sql.includes('record_json, user_id)'))
  const record = JSON.parse(write![1][7])
  expect(record).toMatchObject({ visitor_id: 'browser-1', tool_outcome: 'cancelled' })
  expect(record.status).toBeUndefined()
  expect(write![1][8]).toBeNull()
  query.mockRejectedValueOnce(new Error('database unavailable'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await expect(recordToolRun({ tool: 'depot_value', visitorId: 'browser-1', startedAt: Date.now(), outcome: 'success' })).resolves.toBeUndefined()
})
