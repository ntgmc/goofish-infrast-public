// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copy } from '../../../copy/index'
import { useResultDownloads } from './useResultDownloads'

const { requestFullResultExport, requestMaaExport } = vi.hoisted(() => ({
  requestFullResultExport: vi.fn(),
  requestMaaExport: vi.fn(),
}))

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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails closed before requesting a MAA export when no coupon is available', async () => {
    const { options, result } = renderDownloads()

    await act(async () => { await result.current.downloadMaaResult('result-1') })

    expect(requestMaaExport).not.toHaveBeenCalled()
    expect(options.setWorkspaceError).toHaveBeenCalledWith(copy.inventory.maa_export_coupon_unavailable)
  })

  it('reuses the pending key after an unknown outcome and refreshes inventory after consumption', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    requestMaaExport
      .mockRejectedValueOnce(new Error('network outcome unknown'))
      .mockResolvedValueOnce({ consumed_coupon: true })
    const refreshInventory = vi.fn()
    const { options, result } = renderDownloads({
      maaExportCouponBalance: 2,
      refreshInventory,
    })

    await act(async () => { await result.current.downloadMaaResult('result-1') })
    await act(async () => { await result.current.downloadMaaResult('result-1') })

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
