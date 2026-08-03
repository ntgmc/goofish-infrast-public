// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiVoid } from './api-client'
import { reportToolVisit } from './usage-tracking'

const { apiVoidMock } = vi.hoisted(() => ({
  apiVoidMock: vi.fn(),
}))

vi.mock('./api-client', () => ({
  apiVoid: apiVoidMock,
}))

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
  it('lets the server-side signed cookie identify visitors without browser storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await reportToolVisit()

    expect(apiVoid).toHaveBeenCalledWith('/api/usage-stats', {
      method: 'POST',
      keepalive: true,
      json: { event: 'tool_visit' },
    })
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('silently ignores telemetry request failures', async () => {
    apiVoidMock.mockRejectedValueOnce(new Error('network unavailable'))

    await expect(reportToolVisit()).resolves.toBeUndefined()
  })
})
