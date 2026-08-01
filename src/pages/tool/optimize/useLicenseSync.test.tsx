// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }))

vi.mock('../../../lib/api-client', () => ({ apiJson: mocks.apiJson }))

import { useLicenseSync } from './useLicenseSync'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.apiJson.mockResolvedValue({ status: 'used' })
})

describe('useLicenseSync', () => {
  it('revalidates authorization on focus and explicit flush', async () => {
    const { result, unmount } = renderHook(() => useLicenseSync('profile-1', 'order-1'))
    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledTimes(1))

    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledTimes(2))

    act(() => result.current.flushPendingSync())
    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledTimes(3))
    expect(mocks.apiJson).toHaveBeenLastCalledWith('/api/user/status?profile_id=profile-1', expect.any(Object))
    unmount()
  })
})
