// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiVoid } from './api-client'
import {
  TOOL_VISITOR_ID_STORAGE_KEY,
  getOrCreateToolVisitorId,
  reportToolVisit,
} from './usage-tracking'

const { apiVoidMock } = vi.hoisted(() => ({
  apiVoidMock: vi.fn(),
}))

vi.mock('./api-client', () => ({
  apiVoid: apiVoidMock,
}))

const visitorIdPattern = /^[A-Za-z0-9_-]{8,128}$/

beforeEach(() => {
  window.localStorage.clear()
  apiVoidMock.mockReset()
  apiVoidMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('tool visit tracking', () => {
  it('persists an anonymous visitor ID and reuses it in each event', async () => {
    await reportToolVisit()

    const visitorId = window.localStorage.getItem(TOOL_VISITOR_ID_STORAGE_KEY)
    expect(visitorId).toMatch(visitorIdPattern)
    expect(apiVoid).toHaveBeenCalledWith('/api/usage-stats', {
      method: 'POST',
      keepalive: true,
      json: { event: 'tool_visit', visitor_id: visitorId },
    })

    await reportToolVisit()

    expect(window.localStorage.getItem(TOOL_VISITOR_ID_STORAGE_KEY)).toBe(visitorId)
    expect(apiVoid).toHaveBeenLastCalledWith('/api/usage-stats', {
      method: 'POST',
      keepalive: true,
      json: { event: 'tool_visit', visitor_id: visitorId },
    })
  })

  it('replaces malformed persisted visitor IDs', () => {
    window.localStorage.setItem(TOOL_VISITOR_ID_STORAGE_KEY, 'invalid visitor id!')

    const visitorId = getOrCreateToolVisitorId()

    expect(visitorId).toMatch(visitorIdPattern)
    expect(visitorId).not.toBe('invalid visitor id!')
    expect(window.localStorage.getItem(TOOL_VISITOR_ID_STORAGE_KEY)).toBe(visitorId)
  })

  it('uses an ephemeral ID when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    await expect(reportToolVisit()).resolves.toBeUndefined()
    const firstVisitorId = apiVoidMock.mock.calls[0]?.[1]?.json?.visitor_id
    expect(getOrCreateToolVisitorId()).toBe(firstVisitorId)

    expect(apiVoid).toHaveBeenCalledWith('/api/usage-stats', expect.objectContaining({
      method: 'POST',
      keepalive: true,
      json: expect.objectContaining({
        event: 'tool_visit',
        visitor_id: expect.stringMatching(visitorIdPattern),
      }),
    }))
  })

  it('silently ignores telemetry request failures', async () => {
    apiVoidMock.mockRejectedValueOnce(new Error('network unavailable'))

    await expect(reportToolVisit()).resolves.toBeUndefined()
  })
})
