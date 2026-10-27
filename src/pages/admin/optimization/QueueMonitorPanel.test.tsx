// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '../../../test/private-query-render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminCapability, AdminOptimizationQueueSnapshot } from '../contracts'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import QueueMonitorPanel from './QueueMonitorPanel'

const identity = { adminUsername: 'operator', capabilities: ['optimization_view'] as AdminCapability[] }

async function flushRequests() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
}

describe('QueueMonitorPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    adminApiJson.mockReset().mockImplementation(async (url: string) => url.includes('view=queue') ? snapshot() : { dead_letters: [] })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders safe queue data, filters by search, and expands operational details', async () => {
    render(<QueueMonitorPanel {...identity} />)
    await flushRequests()

    expect(screen.queryByRole('heading', { name: '30 天服务历史' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '异步优化死信队列' })).not.toBeInTheDocument()
    expect(screen.getByText('2 / 200')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '实时资源状态' })).not.toBeInTheDocument()
    expect(screen.queryByText('运行资源')).not.toBeInTheDocument()
    expect(screen.getAllByText('user@example.test').length).toBeGreaterThan(0)
    expect(screen.queryByText('secret payload')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('任务 ID、邮箱或档案'), { target: { value: 'running-job' } })
    expect(screen.queryByText('queued-job')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '正在执行' }))
    expect(screen.getAllByText('running-job').length).toBeGreaterThan(0)
    expect(adminApiJson).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByRole('button', { name: /running-job/ })[0])
    expect(screen.getAllByText('worker-a').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '服务历史与事件' }))
    await flushRequests()
    expect(screen.getByRole('heading', { name: '30 天服务历史' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '死信处理' }))
    await flushRequests()
    expect(screen.getByRole('heading', { name: '异步优化死信队列' })).toBeInTheDocument()
  })

  it('opens pending abnormal tasks directly even before a queue snapshot has loaded', async () => {
    render(<QueueMonitorPanel {...identity} search="?view=dead&status=pending_review" />)
    await flushRequests()
    expect(screen.getByRole('tab', { name: '死信处理' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '异步优化死信队列' })).toBeInTheDocument()
    expect(adminApiJson.mock.calls.some(([url]) => url === '/api/admin/optimization?limit=50&status=pending_review')).toBe(true)
    expect(adminApiJson.mock.calls.some(([url]) => url.includes('view=queue'))).toBe(false)
  })

  it('pauses both queue polls while another admin section is active and preserves local edits', async () => {
    const view = render(<QueueMonitorPanel {...identity} />)
    await flushRequests()
    const search = screen.getByPlaceholderText('任务 ID、邮箱或档案')
    fireEvent.change(search, { target: { value: 'running-job' } })
    fireEvent.click(screen.getByRole('tab', { name: '服务历史与事件' }))
    await flushRequests()
    const title = screen.getByPlaceholderText('事件标题')
    fireEvent.change(title, { target: { value: '尚未发布的事件' } })
    fireEvent.click(screen.getByRole('tab', { name: '死信处理' }))
    await flushRequests()
    fireEvent.click(screen.getByRole('tab', { name: '任务监控' }))
    await flushRequests()
    const initialCalls = adminApiJson.mock.calls.length

    view.rerender(<QueueMonitorPanel {...identity} active={false} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    })
    await flushRequests()
    expect(adminApiJson.mock.calls).toHaveLength(initialCalls)
    expect(title).toHaveValue('尚未发布的事件')

    view.rerender(<QueueMonitorPanel {...identity} active />)
    await flushRequests()
    expect(adminApiJson.mock.calls.length).toBeGreaterThan(initialCalls)
    expect(search).toHaveValue('running-job')
    expect(title).toHaveValue('尚未发布的事件')
  })

  it('polls while visible, pauses while hidden, and refreshes immediately when visible again', async () => {
    render(<QueueMonitorPanel {...identity} />)
    await flushRequests()
    const initialCalls = adminApiJson.mock.calls.filter(([url]) => String(url).includes('view=queue')).length

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(adminApiJson.mock.calls.filter(([url]) => String(url).includes('view=queue')).length).toBe(initialCalls + 1)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(adminApiJson.mock.calls.filter(([url]) => String(url).includes('view=queue')).length).toBe(initialCalls + 1)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => { document.dispatchEvent(new Event('visibilitychange', { bubbles: true })) })
    await flushRequests()
    expect(adminApiJson.mock.calls.filter(([url]) => String(url).includes('view=queue')).length).toBe(initialCalls + 2)
  })

  it('shares an active slow request across consumers, poll intervals and foreground refreshes', async () => {
    let finish!: (data: AdminOptimizationQueueSnapshot) => void
    adminApiJson.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(<><QueueMonitorPanel {...identity} /><QueueMonitorPanel {...identity} /></>)
    expect(adminApiJson).toHaveBeenCalledOnce()
    const signal = adminApiJson.mock.calls[0][1].signal as AbortSignal
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    })
    await flushRequests()
    expect(adminApiJson).toHaveBeenCalledOnce()
    expect(signal.aborted).toBe(false)
    await act(async () => finish(snapshot()))
    await flushRequests()
    expect(screen.getAllByText('2 / 200')).toHaveLength(2)
  })

  it('isolates administrator and permission changes and discards cancelled late responses', async () => {
    const pending: Array<{ finish: (data: AdminOptimizationQueueSnapshot) => void; signal: AbortSignal }> = []
    adminApiJson.mockImplementation((_url, { signal }) => new Promise((finish) => pending.push({ finish, signal })))
    const view = render(<QueueMonitorPanel {...identity} />)
    view.rerender(<QueueMonitorPanel {...identity} capabilities={['optimization_view', 'sensitive_data_view']} />)
    expect(pending[0].signal.aborted).toBe(true)
    view.rerender(<QueueMonitorPanel {...identity} adminUsername="another-admin" />)
    expect(pending[1].signal.aborted).toBe(true)
    await act(async () => {
      pending[0].finish(snapshot())
      pending[1].finish(snapshot())
      const current = snapshot()
      current.counts.queued = 7
      pending[2].finish(current)
    })
    await flushRequests()
    expect(screen.getByText('7 / 200')).toBeInTheDocument()
    expect(screen.queryByText('2 / 200')).not.toBeInTheDocument()
    view.rerender(<QueueMonitorPanel {...identity} adminUsername="another-admin" capabilities={['usage_view']} />)
    await flushRequests()
    expect(screen.queryByText('7 / 200')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即刷新' })).toBeDisabled()
    expect(adminApiJson).toHaveBeenCalledTimes(3)
  })

  it('cancels reads when leaving tasks and separates related server searches from local filters', async () => {
    let finish!: (data: AdminOptimizationQueueSnapshot) => void
    adminApiJson.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const view = render(<QueueMonitorPanel {...identity} search="?query=first%40example.test" />)
    const firstSignal = adminApiJson.mock.calls[0][1].signal as AbortSignal
    view.rerender(<QueueMonitorPanel {...identity} search="?query=second%40example.test" />)
    expect(firstSignal.aborted).toBe(true)
    await flushRequests()
    expect(adminApiJson.mock.calls[1][0]).toBe('/api/admin/optimization?view=queue&related=second%40example.test')
    await act(async () => finish({ ...snapshot(), counts: { ...snapshot().counts, queued: 9 } }))
    await flushRequests()
    expect(screen.getByText('2 / 200')).toBeInTheDocument()
    expect(screen.queryByText('9 / 200')).not.toBeInTheDocument()

    adminApiJson.mockImplementationOnce(() => new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: '立即刷新' }))
    const pendingSignal = adminApiJson.mock.calls[2][1].signal as AbortSignal
    fireEvent.click(screen.getByRole('tab', { name: '死信处理' }))
    await flushRequests()
    expect(pendingSignal.aborted).toBe(true)
  })

  it('retains the last successful snapshot on refresh failure and retries explicitly without resetting filters', async () => {
    render(<QueueMonitorPanel {...identity} />)
    await flushRequests()
    fireEvent.change(screen.getByPlaceholderText('任务 ID、邮箱或档案'), { target: { value: 'queued-job' } })
    adminApiJson.mockRejectedValueOnce(new Error('Queue unavailable'))
    fireEvent.click(screen.getByRole('button', { name: '立即刷新' }))
    await flushRequests()
    expect(screen.getByRole('alert')).toHaveTextContent('Queue unavailable；当前继续显示上一次成功快照。')
    expect(screen.getByText('2 / 200')).toBeInTheDocument()
    expect(adminApiJson).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '立即刷新' }))
    await flushRequests()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('任务 ID、邮箱或档案')).toHaveValue('queued-job')
    expect(adminApiJson).toHaveBeenCalledTimes(3)
  })

  it('does not fetch without a confirmed administrator', async () => {
    render(<QueueMonitorPanel {...identity} adminUsername={null} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(adminApiJson).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '立即刷新' })).toBeDisabled()
  })
})

function snapshot(): AdminOptimizationQueueSnapshot {
  const base = {
    queue_position: null,
    source: 'account_profile',
    priority: { value: 10, label: '付费任务' as const },
    permission: 'growth',
    user: { id: 'user-1', email: 'user@example.test' },
    profile: { id: 'profile-1', display_name: '主账号' },
    attempt_count: 1,
    failure_count: 0,
    worker_id: null,
    created_at: '2026-07-19T09:58:00.000Z',
    started_at: null,
    finished_at: null,
    updated_at: '2026-07-19T09:58:00.000Z',
    heartbeat_at: null,
    next_attempt_at: null,
    expires_at: '2026-07-19T10:30:00.000Z',
    cancel_requested_at: null,
    failure_kind: null,
    public_error_code: null,
    error_summary: null,
  }
  return {
    snapshot_at: '2026-07-19T10:00:00.000Z',
    capacity: {
      queue_limit: 200,
      worker_concurrency: 3,
      worker_instances: 1,
      source: 'runtime_registry',
      heartbeat_interval_ms: 10_000,
      stale_after_ms: 30_000,
    },
    counts: { queued: 2, ready_queued: 1, oldest_ready_wait_ms: 120_000, running: 1, retry_waiting: 1, recent_failed: 0 },
    queued_jobs: [{ ...base, id: 'queued-job', status: 'queued', queue_position: 1 }],
    running_jobs: [{ ...base, id: 'running-job', status: 'running', worker_id: 'worker-a', started_at: '2026-07-19T09:59:00.000Z', heartbeat_at: '2026-07-19T10:00:00.000Z' }],
    recent_jobs: [],
  }
}
