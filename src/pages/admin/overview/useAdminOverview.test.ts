// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createOperationsOverview } from '../../../test/operations-overview-fixture'
import { useAdminOverview } from './useAdminOverview'

const api = vi.hoisted(() => ({ json: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: api.json }))
beforeEach(() => api.json.mockReset().mockResolvedValue(createOperationsOverview()))
afterEach(cleanup)

it('keeps date drafts out of the query until applied and rejects invalid calendar dates', () => {
  const { result } = renderHook(() => useAdminOverview())
  act(() => result.current.setUsageRange('custom'))
  const initialLoad = result.current.loadUsageStats
  act(() => { result.current.setUsageRangeFrom('2026-02-30'); result.current.setUsageRangeTo('2026-03-01') })
  expect(result.current.loadUsageStats).toBe(initialLoad)
  act(() => result.current.applyCustomRange())
  expect(result.current.customRangeError).not.toBeNull()
  expect(result.current.loadUsageStats).toBe(initialLoad)
  act(() => { result.current.setUsageRangeFrom('2026-02-01'); result.current.setUsageRangeTo('2026-02-07') })
  act(() => result.current.applyCustomRange())
  expect(result.current.customRangeError).toBeNull()
  expect(result.current.loadUsageStats).not.toBe(initialLoad)
})

it('retains the last valid snapshot on failure and ignores a response from an aborted request', async () => {
  const { result } = renderHook(() => useAdminOverview())
  await act(() => result.current.loadUsageStats())
  let resolve!: (data: unknown) => void
  api.json.mockImplementationOnce(() => new Promise((accept) => { resolve = accept }))
  const controller = new AbortController()
  let request!: Promise<void>
  act(() => { request = result.current.loadUsageStats(controller.signal) })
  controller.abort()
  api.json.mockResolvedValueOnce(createOperationsOverview(22))
  await act(() => result.current.loadUsageStats())
  await act(async () => { resolve(createOperationsOverview(11)); await request })
  expect(result.current.businessOverview?.current.successful_users).toBe(22)
  api.json.mockResolvedValueOnce({})
  await expect(result.current.loadUsageStats()).rejects.toThrow('版本不兼容')
  expect(result.current.businessOverview?.current.successful_users).toBe(22)
})
