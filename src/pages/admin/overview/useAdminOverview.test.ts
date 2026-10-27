// @vitest-environment jsdom
import { useQueryClient } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '../../../test/query-render'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createOperationsOverview } from '../../../test/operations-overview-fixture'
import type { AdminCapability, AdminSection } from '../contracts'
import { buildCdkOpsSummary } from '../shared/helpers'
import { useAdminCdkData } from '../cdk/useAdminCdkData'
import { useAdminOverview } from './useAdminOverview'

const api = vi.hoisted(() => ({ json: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: api.json }))
const options = { adminUsername: 'alice', authenticated: true, capabilities: ['usage_view', 'risk_view', 'admin_manage'] as AdminCapability[], section: 'overview' as AdminSection }
beforeEach(() => { api.json.mockReset().mockResolvedValue(createOperationsOverview()) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('keeps date drafts out of the query until applied and reuses fresh ranges', async () => {
  const { result } = renderHook(() => useAdminOverview(options))
  await waitFor(() => expect(result.current.businessOverview).not.toBeNull())
  act(() => result.current.setUsageRange('custom'))
  await waitFor(() => expect(api.json).toHaveBeenCalledTimes(2))
  act(() => { result.current.setUsageRangeFrom('2026-02-30'); result.current.setUsageRangeTo('2026-03-01') })
  act(() => result.current.applyCustomRange())
  expect(result.current.customRangeError).not.toBeNull()
  expect(api.json).toHaveBeenCalledTimes(2)
  act(() => { result.current.setUsageRangeFrom('2026-02-01'); result.current.setUsageRangeTo('2026-02-07') })
  act(() => result.current.applyCustomRange())
  await waitFor(() => expect(api.json).toHaveBeenCalledTimes(3))
  expect(result.current.customRangeError).toBeNull()
  expect(api.json.mock.calls[2][0]).toContain('from=2026-02-01&to=2026-02-07')
  act(() => result.current.setUsageRange('30d'))
  expect(result.current.businessOverview).not.toBeNull()
  expect(api.json).toHaveBeenCalledTimes(3)
})

it('cancels obsolete ranges and preserves only the current range snapshot on a failed refresh', async () => {
  const { result } = renderHook(() => ({ overview: useAdminOverview(options), client: useQueryClient() }))
  await waitFor(() => expect(result.current.overview.businessOverview).not.toBeNull())
  let finish!: (data: unknown) => void
  api.json.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  act(() => result.current.overview.setUsageRange('7d'))
  const oldSignal = api.json.mock.calls[1][1].signal as AbortSignal
  expect(result.current.overview.businessOverview).toBeNull()
  api.json.mockResolvedValueOnce(createOperationsOverview(22))
  act(() => result.current.overview.setUsageRange('14d'))
  expect(oldSignal.aborted).toBe(true)
  await waitFor(() => expect(result.current.overview.businessOverview?.current.successful_users).toBe(22))
  await act(async () => finish(createOperationsOverview(11)))
  expect(result.current.overview.businessOverview?.current.successful_users).toBe(22)
  api.json.mockResolvedValueOnce({})
  await act(async () => { await result.current.client.invalidateQueries({ queryKey: ['admin', 'alice', 'overview'] }) })
  await waitFor(() => expect(result.current.overview.overviewError).toContain('版本不兼容'))
  expect(result.current.overview.businessOverview?.current.successful_users).toBe(22)
  expect(result.current.overview.overviewPartialFailure).toBe(true)
})

it('isolates administrators and permissions and cancels queries on navigation and logout', async () => {
  const requests: Array<{ signal: AbortSignal; finish: (data: unknown) => void }> = []
  api.json.mockImplementation((_url, init) => new Promise((resolve) => requests.push({ signal: init.signal, finish: resolve })))
  const { result, rerender, unmount } = renderHook((current) => useAdminOverview(current), { initialProps: options })
  rerender({ ...options, adminUsername: 'bob' })
  expect(requests[0].signal.aborted).toBe(true)
  await act(async () => {
    requests[1].finish(createOperationsOverview(22))
    requests[0].finish(createOperationsOverview(11))
  })
  await waitFor(() => expect(result.current.businessOverview?.current.successful_users).toBe(22))
  rerender({ ...options, adminUsername: 'bob', capabilities: ['risk_view'] })
  expect(result.current.businessOverview).toBeNull()
  expect(api.json).toHaveBeenCalledTimes(2)
  rerender({ ...options, adminUsername: 'bob', capabilities: ['risk_view'], section: 'risk' })
  expect(api.json.mock.calls[2][0]).toBe('/api/admin/risk-settings')
  rerender({ ...options, adminUsername: 'bob', authenticated: false, section: 'risk' })
  expect(requests[2].signal.aborted).toBe(true)
  expect(result.current.cdkSummary).toBeNull()
  expect(result.current.riskSettings.can_configure).toBe(false)
  rerender({ ...options, section: 'announcement' })
  expect(api.json.mock.calls[3][0]).toBe('/api/admin/announcement')
  rerender({ ...options, section: 'users' })
  expect(requests[3].signal.aborted).toBe(true)
  rerender({ ...options, section: 'announcement' })
  unmount()
  expect(requests[4].signal.aborted).toBe(true)
})

it('keeps successful risk settings available while the independent CDK summary fails', async () => {
  const settings = { operator_data_risk_enabled: false, revision: 3, can_configure: true, updated_at: null }
  api.json.mockImplementation(async (url) => {
    if (url === '/api/admin/risk-settings') return { settings }
    throw new Error('CDK summary unavailable')
  })
  const { result } = renderHook(() => ({ overview: useAdminOverview({ ...options, section: 'risk' }), client: useQueryClient() }))
  await waitFor(() => expect(result.current.overview.overviewLoading).toBe(false))
  expect(result.current.overview.riskSettings).toEqual(settings)
  expect(result.current.overview.overviewPartialFailure).toBe(true)
  expect(result.current.overview.overviewUpdatedAt).toBeGreaterThan(0)
  expect(result.current.overview.overviewError).toContain('CDK summary unavailable')
  const summary = buildCdkOpsSummary([])
  api.json.mockResolvedValueOnce({ summary })
  await act(async () => { await result.current.client.invalidateQueries({ queryKey: ['admin', 'alice', 'cdks'] }) })
  await waitFor(() => expect(result.current.overview.overviewError).toBeNull())
  expect(result.current.overview.cdkSummary).toEqual(summary)
})

it('shares CDK summaries between CDK and risk pages and invalidates them with list mutations', async () => {
  let summary = buildCdkOpsSummary([])
  api.json.mockImplementation(async (url) => url.includes('view=summary') ? { summary } : {})
  const { result, rerender } = renderHook(({ section }) => ({
    overview: useAdminOverview({ ...options, section }),
    cdks: useAdminCdkData({ ...options, section, setError: vi.fn() }),
  }), { initialProps: { section: 'cdk' as AdminSection } })
  await waitFor(() => expect(result.current.overview.cdkSummary).toEqual(summary))
  rerender({ section: 'risk' })
  await waitFor(() => expect(result.current.cdks.riskLoading).toBe(false))
  expect(api.json.mock.calls.filter(([url]) => url.includes('view=summary'))).toHaveLength(1)
  summary = { ...summary, generated_records: 5 }
  await act(async () => { await result.current.cdks.loadRiskPage() })
  await waitFor(() => expect(result.current.overview.cdkSummary?.generated_records).toBe(5))
  expect(api.json.mock.calls.filter(([url]) => url.includes('view=summary'))).toHaveLength(2)
})

it.each(['announcement', 'risk'] as const)('cancels a stale %s read before caching mutation responses and keeps removed queries cleared', async (section) => {
  const settings = { operator_data_risk_enabled: true, revision: 1, can_configure: true, updated_at: null }
  api.json.mockResolvedValue(section === 'announcement' ? { revision: 1 } : { settings })
  const scoped = { ...options, capabilities: section === 'announcement' ? ['admin_manage'] as AdminCapability[] : ['risk_view'] as AdminCapability[], section }
  const { result } = renderHook(() => ({ overview: useAdminOverview(scoped), client: useQueryClient() }))
  await waitFor(() => expect(result.current.overview.overviewUpdatedAt).toBeGreaterThan(0))
  const updated = { ...settings, revision: 2, operator_data_risk_enabled: false }
  let finish!: (data: unknown) => void
  api.json.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  let refresh!: Promise<void>
  act(() => { refresh = result.current.client.invalidateQueries({ queryKey: ['admin', 'alice'] }) })
  const signal = api.json.mock.calls[1][1].signal as AbortSignal
  await act(async () => {
    if (section === 'announcement') await result.current.overview.updateAnnouncementSnapshot({ revision: 2 })
    else await result.current.overview.setRiskSettings(updated)
    await refresh
    finish(section === 'announcement' ? { revision: 1 } : { settings })
  })
  expect(signal.aborted).toBe(true)
  await waitFor(() => expect(section === 'announcement'
    ? result.current.overview.announcementData?.revision : result.current.overview.riskSettings.revision).toBe(2))
  await act(async () => {
    result.current.client.removeQueries({ queryKey: ['admin'] })
    if (section === 'announcement') await result.current.overview.updateAnnouncementSnapshot({ revision: 3 })
    else await result.current.overview.setRiskSettings({ ...updated, revision: 3 })
  })
  expect(result.current.client.getQueriesData({ queryKey: ['admin'] })).toEqual([])
})
