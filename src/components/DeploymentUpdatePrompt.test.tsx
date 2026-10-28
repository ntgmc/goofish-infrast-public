// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '../test/query-render'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppBuildMeta } from '../lib/types'
import { apiJson } from '../lib/api-client'
import type { ChangelogPageData, ChangelogRelease } from '../lib/changelog-contract'
import DeploymentUpdatePrompt from './DeploymentUpdatePrompt'

vi.mock('../lib/api-client', () => ({ apiJson: vi.fn() }))

const currentMeta = buildMeta('2.0.0', '2026-08-04T08:00:00.000Z', 'a')
const latestMeta = buildMeta('2.1.0', '2026-08-04T09:00:00.000Z', 'new')
const emptyPage: ChangelogPageData = { releases: [], page: 1, pageSize: 10, total: 0 }
const latestRelease: ChangelogRelease = {
  id: 'v2.1.0', version: '2.1.0', displayVersion: 'v2.1.0', releasedAt: '2026-08-04', kind: 'release',
  sections: [{ id: 'feature', kind: 'feature', items: ['支持 **模组预算**，可查看 `总费用` 和[使用说明](https://example.com/guide)。'] }],
}

beforeEach(() => {
  vi.mocked(apiJson).mockReset().mockResolvedValue(emptyPage)
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
    expect(apiJson).not.toHaveBeenCalled()
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

  it('loads notes from the new deployment and renders Markdown for the matching version', async () => {
    vi.mocked(apiJson).mockResolvedValue({ ...emptyPage, releases: [
      { ...latestRelease, id: 'v2.2.0', version: '2.2.0', sections: [{ id: 'fix', kind: 'fix', items: ['其他版本内容'] }] },
      latestRelease,
    ], total: 2 })
    render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} />)

    expect(await screen.findByText('模组预算')).toHaveProperty('tagName', 'STRONG')
    expect(screen.getByText('总费用')).toHaveProperty('tagName', 'CODE')
    expect(screen.getByRole('link', { name: '使用说明' })).toHaveAttribute('href', 'https://example.com/guide')
    expect(screen.getByRole('heading', { name: '新功能' })).toBeInTheDocument()
    expect(screen.queryByText('其他版本内容')).not.toBeInTheDocument()
    expect(apiJson).toHaveBeenCalledExactlyOnceWith('/api/changelog?page=1&release=v2.1.0', { signal: expect.any(AbortSignal) })
  })

  it('keeps refresh available while notes load and cancels the read on unmount', async () => {
    const reloadPage = vi.fn()
    vi.mocked(apiJson).mockImplementation(() => new Promise(() => {}))
    const { unmount } = render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} reloadPage={reloadPage} />)

    expect(await screen.findByRole('status')).toHaveTextContent('正在加载更新日志')
    const signal = vi.mocked(apiJson).mock.calls[0][1]?.signal
    fireEvent.click(screen.getByRole('button', { name: '立即刷新' }))
    expect(reloadPage).toHaveBeenCalledOnce()
    unmount()
    expect(signal?.aborted).toBe(true)
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('allows retrying failed notes without blocking the refresh action', async () => {
    vi.mocked(apiJson).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...emptyPage, releases: [latestRelease], total: 1 })
    render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('更新日志加载失败')
    expect(screen.getByRole('button', { name: '立即刷新' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByText('模组预算')).toBeInTheDocument()
    expect(apiJson).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state when the deployed version has no matching notes', async () => {
    vi.mocked(apiJson).mockResolvedValue({ ...emptyPage, releases: [latestRelease], total: 1 })
    render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={vi.fn().mockResolvedValue({ ...latestMeta, frontend_version: '2.2.0' })} />)

    expect(await screen.findByText('本次发布暂无面向用户的更新记录。')).toBeInTheDocument()
    expect(screen.queryByText('模组预算')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即刷新' })).toBeEnabled()
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

    await act(async () => { await vi.advanceTimersByTimeAsync(1_001) })
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
