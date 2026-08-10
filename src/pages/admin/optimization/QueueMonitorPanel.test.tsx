// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminOptimizationQueueSnapshot } from '../contracts'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import QueueMonitorPanel from './QueueMonitorPanel'

describe('QueueMonitorPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    adminApiJson.mockImplementation(async (url: string) => url.includes('view=queue') ? snapshot() : { dead_letters: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders safe queue data, filters by search, and expands operational details', async () => {
    render(<QueueMonitorPanel />)
    await act(async () => { await Promise.resolve() })

    const statusHeading = screen.getByRole('heading', { name: '30 天服务历史' })
    const deadLetterHeading = screen.getByRole('heading', { name: '异步优化死信队列' })
    expect(statusHeading.compareDocumentPosition(deadLetterHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(screen.getByText('2 / 200')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '实时资源状态' })).not.toBeInTheDocument()
    expect(screen.queryByText('运行资源')).not.toBeInTheDocument()
    expect(screen.getAllByText('user@example.test').length).toBeGreaterThan(0)
    expect(screen.queryByText('secret payload')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('任务 ID、邮箱或档案'), { target: { value: 'running-job' } })
    expect(screen.queryByText('queued-job')).not.toBeInTheDocument()
    expect(screen.getAllByText('running-job').length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: /running-job/ })[0])
    expect(screen.getAllByText('worker-a').length).toBeGreaterThan(0)
  })

  it('polls while visible, pauses while hidden, and refreshes immediately when visible again', async () => {
    render(<QueueMonitorPanel />)
    await act(async () => { await Promise.resolve() })
    const initialCalls = adminApiJson.mock.calls.filter(([url]) => String(url).includes('view=queue')).length

    await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve() })
    expect(adminApiJson.mock.calls.filter(([url]) => String(url).includes('view=queue')).length).toBe(initialCalls + 1)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve() })
    expect(adminApiJson.mock.calls.filter(([url]) => String(url).includes('view=queue')).length).toBe(initialCalls + 1)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve() })
    expect(adminApiJson.mock.calls.filter(([url]) => String(url).includes('view=queue')).length).toBeGreaterThanOrEqual(initialCalls + 2)
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
    counts: { queued: 2, running: 1, retry_waiting: 1, recent_failed: 0 },
    queued_jobs: [{ ...base, id: 'queued-job', status: 'queued', queue_position: 1 }],
    running_jobs: [{ ...base, id: 'running-job', status: 'running', worker_id: 'worker-a', started_at: '2026-07-19T09:59:00.000Z', heartbeat_at: '2026-07-19T10:00:00.000Z' }],
    recent_jobs: [],
  }
}
