// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '../test/query-render'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppBuildMeta } from '../lib/types'
import { apiJson } from '../lib/api-client'
import type { ChangelogPageData, ChangelogRelease } from '../lib/changelog-contract'
import DeploymentUpdatePrompt from './DeploymentUpdatePrompt'

vi.mock('../lib/api-client', () => ({ apiJson: vi.fn() }))
const { releases } = vi.hoisted(() => ({ releases: [] as ChangelogRelease[] }))
vi.mock('../lib/changelog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/changelog')>(),
  CHANGELOG_RELEASES: releases,
}))
const LAST_VISIT_KEY = 'maatool:last-visited-build'

const currentMeta = buildMeta('2.0.0', '2026-08-04T08:00:00.000Z', 'a')
const latestMeta = buildMeta('2.1.0', '2026-08-04T09:00:00.000Z', 'new')
const emptyPage: ChangelogPageData = { releases: [], page: 1, pageSize: 10, total: 0 }
const latestRelease: ChangelogRelease = {
  id: 'v2.1.0', version: '2.1.0', displayVersion: 'v2.1.0', releasedAt: '2026-08-04', kind: 'release',
  sections: [{ id: 'feature', kind: 'feature', items: ['支持 **模组预算**，可查看 `总费用` 和[使用说明](https://example.com/guide)。'] }],
}

beforeEach(() => {
  window.localStorage.clear()
  releases.splice(0, releases.length, latestRelease)
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

  it('remembers the first visit without a welcome and shows updates once after reopening a newer build', async () => {
    const first = render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={vi.fn().mockResolvedValue(currentMeta)} />)
    await waitFor(() => expect(localStorage.getItem(LAST_VISIT_KEY)).toBe(JSON.stringify(currentMeta)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    first.unmount()

    const second = render(<StrictMode><DeploymentUpdatePrompt meta={latestMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} /></StrictMode>)
    expect(await screen.findByRole('dialog', { name: '欢迎回来' })).toBeInTheDocument()
    expect(await screen.findByText('模组预算')).toBeInTheDocument()
    expect(screen.getByText('v2.1.0')).toBeInTheDocument()
    expect(screen.getByText('2.0.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续使用' })).toHaveFocus()
    expect(screen.getByRole('link', { name: '查看完整更新日志' })).toHaveAttribute('href', '/changelog')
    expect(apiJson).not.toHaveBeenCalled()
    second.unmount()

    render(<DeploymentUpdatePrompt meta={latestMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('summarizes only the latest three releases after the previous version and through the opened version', async () => {
    const version = (value: string, items: string[]): ChangelogRelease => ({
      ...latestRelease, id: `v${value}`, version: value, displayVersion: `v${value}`,
      sections: [{ id: 'feature', kind: 'feature', items }],
    })
    localStorage.setItem(LAST_VISIT_KEY, JSON.stringify(currentMeta))
    releases.splice(0, releases.length,
      version('2.10.1', ['尚未打开的新版本']),
      version('2.10.0', ['最新更新']),
      version('2.9.0', []),
      version('2.8.0', ['第二次更新']),
      version('2.7.0', ['第三次更新']),
      version('2.6.0', ['更早更新']),
      version('2.0.0', ['上次已用版本']),
      version('1.9.0', ['旧版本内容']),
    )
    const meta = buildMeta('2.10.0', '2026-08-05T09:00:00.000Z', 'latest')
    render(<DeploymentUpdatePrompt meta={meta} fetchHealth={vi.fn().mockResolvedValue(meta)} />)
    expect(await screen.findByText('最新更新')).toBeInTheDocument()
    expect(screen.getByText('第二次更新')).toBeInTheDocument()
    expect(screen.getByText('第三次更新')).toBeInTheDocument()
    for (const text of ['尚未打开的新版本', '更早更新', '上次已用版本', '旧版本内容']) expect(screen.queryByText(text)).not.toBeInTheDocument()
  })

  it.each(['button', 'Escape'])('dismisses the welcome with %s and keeps the current page usable', async (action) => {
    localStorage.setItem(LAST_VISIT_KEY, JSON.stringify(currentMeta))
    const reloadPage = vi.fn()
    render(<DeploymentUpdatePrompt meta={latestMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} reloadPage={reloadPage} />)
    const dialog = await screen.findByRole('dialog', { name: '欢迎回来' })
    if (action === 'button') fireEvent.click(screen.getByRole('button', { name: '继续使用' }))
    else fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('')
    expect(reloadPage).not.toHaveBeenCalled()
  })

  it('does not welcome again after refreshing from the update prompt, but still welcomes a later release', async () => {
    const reloadPage = vi.fn()
    const oldPage = render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} reloadPage={reloadPage} />)
    fireEvent.click(await screen.findByRole('button', { name: '立即刷新' }))
    expect(reloadPage).toHaveBeenCalledOnce()
    expect(localStorage.getItem(LAST_VISIT_KEY)).toBe(JSON.stringify(latestMeta))
    oldPage.unmount()

    const refreshed = render(<DeploymentUpdatePrompt meta={latestMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    refreshed.unmount()

    const newer = buildMeta('2.2.0', '2026-08-05T09:00:00.000Z', 'newer')
    render(<DeploymentUpdatePrompt meta={newer} fetchHealth={vi.fn().mockResolvedValue(newer)} />)
    expect(await screen.findByRole('dialog', { name: '欢迎回来' })).toBeInTheDocument()
    expect(await screen.findByText('当前版本已更新，暂无新的更新摘要。')).toBeInTheDocument()
  })

  it('gives a newer service deployment priority over the welcome without mixing their notes', async () => {
    localStorage.setItem(LAST_VISIT_KEY, JSON.stringify(currentMeta))
    const newer = buildMeta('2.2.0', '2026-08-05T09:00:00.000Z', 'newer')
    vi.mocked(apiJson).mockResolvedValue({ ...emptyPage, releases: [{ ...latestRelease, version: '2.2.0', sections: [{ id: 'fix', kind: 'fix', items: ['需要刷新的更新'] }] }] })
    render(<DeploymentUpdatePrompt meta={latestMeta} fetchHealth={vi.fn().mockResolvedValue(newer)} />)
    expect(await screen.findByRole('dialog', { name: '新版本已发布' })).toBeInTheDocument()
    expect(await screen.findByText('需要刷新的更新')).toBeInTheDocument()
    expect(screen.queryByText('模组预算')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '继续使用' })).not.toBeInTheDocument()
  })

  it('does not let an older reopened tab overwrite the last seen deployment', async () => {
    localStorage.setItem(LAST_VISIT_KEY, JSON.stringify(latestMeta))
    render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={vi.fn().mockResolvedValue(currentMeta)} />)
    await waitFor(() => expect(localStorage.getItem(LAST_VISIT_KEY)).toBe(JSON.stringify(latestMeta)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['{broken', '{"frontend_version":"old"}'])('treats invalid stored metadata as a first visit: %s', async (stored) => {
    localStorage.setItem(LAST_VISIT_KEY, stored)
    render(<DeploymentUpdatePrompt meta={latestMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} />)
    await waitFor(() => expect(localStorage.getItem(LAST_VISIT_KEY)).toBe(JSON.stringify(latestMeta)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps refresh working when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const reloadPage = vi.fn()
    render(<DeploymentUpdatePrompt meta={currentMeta} fetchHealth={vi.fn().mockResolvedValue(latestMeta)} reloadPage={reloadPage} />)
    fireEvent.click(await screen.findByRole('button', { name: '立即刷新' }))
    expect(reloadPage).toHaveBeenCalledOnce()
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
