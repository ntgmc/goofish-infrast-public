// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copy } from '../../../copy/index'
import { useResultDownloads } from './useResultDownloads'

const { requestFullResultExport, requestMaaExport } = vi.hoisted(() => ({
  requestFullResultExport: vi.fn(),
  requestMaaExport: vi.fn(),
}))
const featureSwitches = vi.hoisted(() => ({ maa_export: true, full_result_export: true }))
vi.mock('../../../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: featureSwitches }) }))

vi.mock('./optimization-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./optimization-api')>(),
  requestFullResultExport,
  requestMaaExport,
}))

function renderDownloads(overrides: Partial<Parameters<typeof useResultDownloads>[0]> = {}) {
  const options: Parameters<typeof useResultDownloads>[0] = {
    profileId: 'profile-1',
    guardExport: async (run) => { await run() },
    canExportMaaWithoutCoupon: false,
    maaExportCouponBalance: 0,
    refreshInventory: vi.fn(),
    setWorkspaceNotice: vi.fn(),
    setWorkspaceError: vi.fn(),
    setWorkspaceBusyAction: vi.fn(),
    ...overrides,
  }
  return { options, ...renderHook(() => useResultDownloads(options)) }
}

describe('useResultDownloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    featureSwitches.maa_export = true
    featureSwitches.full_result_export = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('blocks closed exports before declarations, confirmation or coupon consumption', async () => {
    featureSwitches.maa_export = false
    featureSwitches.full_result_export = false
    const guardExport = vi.fn(async (run: () => void | Promise<void>) => { await run() })
    const { options, result } = renderDownloads({ guardExport, maaExportCouponBalance: 2 })
    await act(async () => {
      await result.current.downloadMaaResult('result-1')
      await result.current.downloadFullResult('result-1')
    })
    expect(guardExport).not.toHaveBeenCalled()
    expect(requestMaaExport).not.toHaveBeenCalled()
    expect(requestFullResultExport).not.toHaveBeenCalled()
    expect(options.setWorkspaceError).toHaveBeenCalledWith(copy.features.closed_body)
  })

  it('fails closed before requesting a MAA export when no coupon is available', async () => {
    const { options, result } = renderDownloads()

    await act(async () => { await result.current.downloadMaaResult('result-1') })

    expect(requestMaaExport).not.toHaveBeenCalled()
    expect(options.setWorkspaceError).toHaveBeenCalledWith(copy.inventory.maa_export_coupon_unavailable)
    expect(result.current.exportFailure).toMatchObject({ format: 'maa', resultId: 'result-1', error: { code: 'maa_export_coupon_required' } })
  })

  it('reports declaration errors for the requested export without making a download request', async () => {
    const { result } = renderDownloads({ guardExport: async (_run, onError) => onError('声明状态加载失败') })
    await act(async () => { await result.current.downloadFullResult('result-1') })
    expect(result.current.exportFailure).toMatchObject({ format: 'full', resultId: 'result-1', error: { message: '声明状态加载失败' } })
    expect(requestFullResultExport).not.toHaveBeenCalled()
  })

  it('clears a full-result failure after retrying the same request successfully', async () => {
    requestFullResultExport.mockRejectedValueOnce(new Error('完整数据下载失败')).mockResolvedValueOnce(undefined)
    const { result } = renderDownloads()
    await act(async () => { await result.current.downloadFullResult('result-1') })
    expect(result.current.exportFailure).toMatchObject({ format: 'full', resultId: 'result-1', error: { message: '完整数据下载失败' } })
    await act(async () => { await result.current.downloadFullResult('result-1') })
    expect(requestFullResultExport.mock.calls[1]?.[2]).toBe(requestFullResultExport.mock.calls[0]?.[2])
    expect(result.current.exportFailure).toBeNull()
  })

  it('reports missing saved results instead of silently ignoring the download', async () => {
    const { result } = renderDownloads()
    await act(async () => { await result.current.downloadFullResult(undefined) })
    expect(result.current.exportFailure).toMatchObject({ format: 'full', error: { code: 'result_not_found' } })
    expect(requestFullResultExport).not.toHaveBeenCalled()
  })

  it('does not attach a previous profile’s delayed failure to the new profile', async () => {
    let reject!: (error: Error) => void
    requestFullResultExport.mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest }))
    const { options, result, rerender } = renderDownloads()
    let pending!: Promise<void>
    act(() => { pending = result.current.downloadFullResult('result-1') })
    await act(async () => { await Promise.resolve() })
    options.profileId = 'profile-2'
    rerender()
    await act(async () => { reject(new Error('Old profile failed')); await pending })
    expect(result.current.exportFailure).toBeNull()
    expect(options.setWorkspaceError).not.toHaveBeenCalledWith('Old profile failed')
  })

  it('does not report a successful coupon export as failed when refreshing inventory fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    requestMaaExport.mockResolvedValueOnce({ consumed_coupon: true })
    const { options, result } = renderDownloads({ maaExportCouponBalance: 1, refreshInventory: vi.fn().mockRejectedValue(new Error('库存刷新失败')) })
    await act(async () => { await result.current.downloadMaaResult('result-1') })
    expect(result.current.exportFailure).toBeNull()
    expect(options.setWorkspaceNotice).toHaveBeenCalledWith(copy.inventory.maa_export_coupon_consumed)
    expect(requestMaaExport).toHaveBeenCalledOnce()
  })

  it('reuses the pending key after an unknown outcome and refreshes inventory after consumption', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    requestMaaExport
      .mockRejectedValueOnce(new Error('network outcome unknown'))
      .mockResolvedValueOnce({ consumed_coupon: true })
    const refreshInventory = vi.fn()
    const { options, result, rerender } = renderDownloads({
      maaExportCouponBalance: 2,
      refreshInventory,
    })

    await act(async () => { await result.current.downloadMaaResult('result-1') })
    expect(result.current.exportFailure).toMatchObject({ format: 'maa', resultId: 'result-1', error: { message: 'network outcome unknown' } })
    options.maaExportCouponBalance = 0
    rerender()
    await act(async () => { await result.current.downloadMaaResult('result-1') })
    expect(result.current.exportFailure).toBeNull()

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(window.confirm).toHaveBeenCalledWith(copy.inventory.maa_export_coupon_confirm(2))
    expect(requestMaaExport).toHaveBeenCalledTimes(2)
    expect(requestMaaExport.mock.calls[1]?.[2].idempotencyKey).toBe(
      requestMaaExport.mock.calls[0]?.[2].idempotencyKey,
    )
    expect(requestMaaExport.mock.calls[1]?.[2]).toMatchObject({ useCoupon: true })
    expect(options.setWorkspaceError).toHaveBeenCalledWith('network outcome unknown')
    expect(options.setWorkspaceNotice).toHaveBeenCalledWith(copy.inventory.maa_export_coupon_consumed)
    expect(refreshInventory).toHaveBeenCalledTimes(1)
  })
})
