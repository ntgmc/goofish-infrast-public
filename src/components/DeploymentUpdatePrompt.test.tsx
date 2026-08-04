// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppBuildMeta } from '../lib/types'
import DeploymentUpdatePrompt from './DeploymentUpdatePrompt'

const currentMeta = buildMeta('2.0.0', '2026-08-04T08:00:00.000Z', 'a')

beforeEach(() => {
  document.documentElement.style.overflow = ''
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function close(this: HTMLDialogElement) {
      this.removeAttribute('open')
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.documentElement.style.overflow = ''
})

describe('DeploymentUpdatePrompt', () => {
  it('keeps the current page uninterrupted for the same or an older deployment', async () => {
    const fetchHealth = vi.fn()
      .mockResolvedValueOnce({ ...currentMeta })
      .mockResolvedValueOnce(buildMeta('1.9.9', '2026-08-04T07:00:00.000Z', 'older'))
    const { unmount } = render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={fetchHealth} />)

    await waitFor(() => expect(fetchHealth).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()

    render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={fetchHealth} />)
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('checks again when the window regains focus and opens a persistent modal for a newer deployment', async () => {
    const user = userEvent.setup()
    const reloadPage = vi.fn()
    const fetchHealth = vi.fn()
      .mockResolvedValueOnce({ ...currentMeta })
      .mockResolvedValueOnce(buildMeta('2.1.0', '2026-08-04T09:00:00.000Z', 'new'))
    render(
      <DeploymentUpdatePrompt
        meta={currentMeta}
        fetchHealth={fetchHealth}
        reloadPage={reloadPage}
      />,
    )

    await waitFor(() => expect(fetchHealth).toHaveBeenCalledOnce())
    fireEvent.focus(window)

    const dialog = await screen.findByRole('dialog', { name: '新版本已发布' })
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(screen.getByText('2.0.0')).toBeInTheDocument()
    expect(screen.getByText('2.1.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即刷新' })).toHaveFocus()
    expect(document.documentElement).toHaveStyle({ overflow: 'hidden' })

    const cancelEvent = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancelEvent)
    expect(cancelEvent.defaultPrevented).toBe(true)
    expect(dialog).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '立即刷新' }))
    expect(reloadPage).toHaveBeenCalledOnce()
    expect(dialog).toBeInTheDocument()
  })

  it('polls on the configured interval and ignores transient health failures', async () => {
    vi.useFakeTimers()
    const fetchHealth = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(buildMeta('2.1.0', '2026-08-04T09:00:00.000Z', 'new'))
    render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={fetchHealth} pollIntervalMs={1_000} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchHealth).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(fetchHealth).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog', { name: '新版本已发布' })).toBeInTheDocument()
  })
})

function buildMeta(version: string, generatedAt: string, gitSha: string): AppBuildMeta {
  return {
    frontend_version: version,
    backend_version: version,
    data_version: `data.${version}`,
    generated_at: generatedAt,
    source_summary: 'test',
    git_sha: gitSha,
  }
}
