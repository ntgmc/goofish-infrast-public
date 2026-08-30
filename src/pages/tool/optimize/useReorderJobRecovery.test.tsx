// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReorderCheckResult } from '../../../lib/types'
import { resumeReorderCheckJob } from './reorder-job-progress'
import { useReorderJobRecovery } from './useReorderJobRecovery'

vi.mock('./reorder-job-progress', () => ({ resumeReorderCheckJob: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('useReorderJobRecovery', () => {
  it('applies only the active Strict Mode recovery instance', async () => {
    const recovered = { recommendation: 'no_need' } as ReorderCheckResult
    vi.mocked(resumeReorderCheckJob).mockResolvedValue(recovered)
    const refreshInventory = vi.fn(async () => undefined)
    const setters = {
      setLoading: vi.fn(),
      setResult: vi.fn(),
      setError: vi.fn(),
    }

    renderHook(
      () => useReorderJobRecovery('profile-1', true, refreshInventory, setters, vi.fn()),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    )
    await flushPromises()

    expect(setters.setResult).toHaveBeenCalledOnce()
    expect(setters.setResult).toHaveBeenCalledWith(recovered)
    expect(setters.setError).toHaveBeenCalledWith(null)
    expect(setters.setLoading).toHaveBeenLastCalledWith(false)
    expect(refreshInventory).toHaveBeenCalledOnce()
  })

  it('cancels callbacks captured for the previous profile', async () => {
    vi.mocked(resumeReorderCheckJob).mockResolvedValue(null)
    const setters = {
      setLoading: vi.fn(),
      setResult: vi.fn(),
      setError: vi.fn(),
    }
    const { result, rerender } = renderHook(
      ({ profileId }) => useReorderJobRecovery(profileId, true, async () => undefined, setters, vi.fn()),
      { initialProps: { profileId: 'profile-1' } },
    )
    const previousProfileCancelled = result.current.isCancelled

    rerender({ profileId: 'profile-2' })
    await act(async () => undefined)

    expect(previousProfileCancelled()).toBe(true)
    expect(result.current.isCancelled()).toBe(false)
  })
})

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
