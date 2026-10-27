// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '../../../test/query-render'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { AdminCapability, AdminSection } from '../contracts'
import { useAdminCdkData } from './useAdminCdkData'

vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: vi.fn() }))

afterEach(() => { cleanup(); vi.resetAllMocks() })

const options = {
  adminUsername: 'operator', authenticated: true,
  capabilities: ['admin_manage', 'risk_view'] as AdminCapability[],
  section: 'cdk' as AdminSection, setError: vi.fn(),
}
const page = (number: number, view = 'list') => ({
  cdks: [{ code_hash: `${view}-${number}`, cdk_type: 'profile', permission: 'advanced', status: 'unused' }],
  pagination: { page: number, page_size: 25, total: 50, total_pages: 2 },
})

function respondWithPage(url: string) {
  const params = new URL(url, 'https://example.test').searchParams
  return Promise.resolve(page(Number(params.get('page')), params.get('view') ?? 'list'))
}

describe('admin CDK queries', () => {
  it('reuses pages and isolates filters, search and page size', async () => {
    vi.mocked(adminApiJson).mockImplementation(respondWithPage)
    const { result } = renderHook(() => useAdminCdkData(options))
    await waitFor(() => expect(result.current.records[0]?.code_hash).toBe('list-1'))
    act(() => result.current.setCdkPage(2))
    await waitFor(() => expect(result.current.records[0]?.code_hash).toBe('list-2'))
    act(() => result.current.setCdkPage(1))
    await waitFor(() => expect(result.current.records[0]?.code_hash).toBe('list-1'))
    expect(adminApiJson).toHaveBeenCalledTimes(2)
    act(() => result.current.setStatusFilter('used'))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledTimes(3))
    expect(vi.mocked(adminApiJson).mock.calls[2][0]).toContain('status=used')
    act(() => result.current.setCdkPageSize(50))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledTimes(4))
    expect(vi.mocked(adminApiJson).mock.calls[3][0]).toContain('page_size=50')
    act(() => result.current.setCdkSearchInput('  account  '))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledTimes(5))
    expect(vi.mocked(adminApiJson).mock.calls[4][0]).toContain('search=account')
  })

  it('cancels obsolete pages and requests left behind by navigation', async () => {
    const requests: Array<{ signal: AbortSignal; finish: (value: unknown) => void }> = []
    vi.mocked(adminApiJson).mockImplementation((_url, init) => new Promise((resolve) => {
      requests.push({ signal: init!.signal!, finish: resolve })
    }))
    const { result, rerender } = renderHook(({ section }) => useAdminCdkData({ ...options, section }), {
      initialProps: { section: 'cdk' as AdminSection },
    })
    act(() => result.current.setCdkPage(2))
    expect(requests[0].signal.aborted).toBe(true)
    await act(async () => requests[1].finish(page(2)))
    await waitFor(() => expect(result.current.records[0]?.code_hash).toBe('list-2'))
    await act(async () => requests[0].finish(page(1)))
    expect(result.current.records[0]?.code_hash).toBe('list-2')
    rerender({ section: 'risk' })
    rerender({ section: 'users' })
    expect(requests[2].signal.aborted).toBe(true)
    await act(async () => requests[2].finish(page(1, 'risk')))
    expect(result.current.riskRecords).toEqual([])
    expect(result.current.records).toEqual([])
  })

  it('invalidates both list and risk caches after a CDK change', async () => {
    vi.mocked(adminApiJson).mockImplementation(respondWithPage)
    const { result, rerender } = renderHook(({ section }) => useAdminCdkData({ ...options, section }), {
      initialProps: { section: 'risk' as AdminSection },
    })
    await waitFor(() => expect(result.current.riskRecords).toHaveLength(1))
    rerender({ section: 'cdk' })
    await waitFor(() => expect(result.current.records).toHaveLength(1))
    act(() => result.current.setCdkPage(2))
    await waitFor(() => expect(result.current.records[0]?.code_hash).toBe('list-2'))
    await act(async () => { await result.current.loadCdkPage() })
    expect(adminApiJson).toHaveBeenCalledTimes(4)
    rerender({ section: 'risk' })
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledTimes(5))
    rerender({ section: 'cdk' })
    act(() => result.current.setCdkPage(1))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledTimes(6))
  })

  it('isolates administrators and permissions, allowing risk-only access without fetching the management list', async () => {
    vi.mocked(adminApiJson).mockResolvedValueOnce(page(1)).mockImplementation(() => new Promise(() => {}))
    const { result, rerender } = renderHook((current) => useAdminCdkData({ ...options, ...current }), {
      initialProps: { adminUsername: 'operator', capabilities: options.capabilities, section: 'cdk' as AdminSection },
    })
    await waitFor(() => expect(result.current.records).toHaveLength(1))
    rerender({ adminUsername: 'another-operator', capabilities: options.capabilities, section: 'cdk' })
    expect(result.current.records).toEqual([])
    rerender({ adminUsername: 'operator', capabilities: ['risk_view'], section: 'cdk' })
    expect(result.current.records).toEqual([])
    expect(result.current.cdkLoaded).toBe(false)
    expect(adminApiJson).toHaveBeenCalledTimes(2)
    rerender({ adminUsername: 'operator', capabilities: ['risk_view'], section: 'risk' })
    expect(adminApiJson).toHaveBeenCalledTimes(3)
    expect(vi.mocked(adminApiJson).mock.calls[2][0]).toContain('view=risk')
  })
})
