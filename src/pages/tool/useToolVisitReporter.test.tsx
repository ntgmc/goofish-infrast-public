// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolVisitReporter } from './useToolVisitReporter'

const { reportToolVisitMock } = vi.hoisted(() => ({
  reportToolVisitMock: vi.fn(),
}))

vi.mock('../../lib/usage-tracking', () => ({
  reportToolVisit: reportToolVisitMock,
}))

beforeEach(() => {
  reportToolVisitMock.mockReset()
  reportToolVisitMock.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('useToolVisitReporter', () => {
  it('reports once after a valid tool route becomes available and ignores rerenders', async () => {
    const { rerender } = render(
      <StrictMode>
        <Harness enabled={false} />
      </StrictMode>,
    )
    expect(reportToolVisitMock).not.toHaveBeenCalled()

    rerender(
      <StrictMode>
        <Harness enabled />
      </StrictMode>,
    )
    await waitFor(() => expect(reportToolVisitMock).toHaveBeenCalledTimes(1))

    rerender(
      <StrictMode>
        <Harness enabled />
      </StrictMode>,
    )
    expect(reportToolVisitMock).toHaveBeenCalledTimes(1)
  })

  it('reports again after the workbench is left and re-entered', async () => {
    const firstVisit = render(<Harness enabled />)
    await waitFor(() => expect(reportToolVisitMock).toHaveBeenCalledTimes(1))

    firstVisit.unmount()
    render(<Harness enabled />)

    await waitFor(() => expect(reportToolVisitMock).toHaveBeenCalledTimes(2))
  })
})

function Harness({ enabled }: { enabled: boolean }) {
  useToolVisitReporter(enabled)
  return null
}
