// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/PublicFooter', () => ({ default: () => <footer>footer</footer> }))
vi.mock('../components/ThemeSwitcher', () => ({ default: () => <button type="button">theme</button> }))

import StatusPage from './StatusPage'

describe('StatusPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the available status without exposing component queue details', async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, payload('available', { queued: 0, running: 1 })))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByText('运行正常').length).toBeGreaterThan(0)
    const componentSection = screen.getByText('服务组件', { selector: 'p' }).closest('section')
    expect(componentSection).not.toBeNull()
    expect(componentSection).toHaveTextContent('正常')
    expect(componentSection).not.toHaveTextContent('等待任务')
    expect(componentSection).not.toHaveTextContent('运行中')
    expect(componentSection).not.toHaveTextContent('并发容量')
  })

  it('renders an unavailable state and exposes a retry path on a 503', async () => {
    vi.mocked(fetch).mockResolvedValue(response(503, payload('unavailable', null)))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByText('暂不可用').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重新检查' })).toBeInTheDocument()
  })

  it('renders a 30-day hourly history grid and incident updates', async () => {
    const body = payload('available', { queued: 0, running: 1 }) as Record<string, unknown>
    body.history = {
      from: '2026-07-09T09:00:00.000Z',
      to: '2026-08-08T09:00:00.000Z',
      interval: 'hour',
      complete: true,
      buckets: [{ component_id: 'optimization', bucket_start: '2026-08-08T08:00:00.000Z', status: 'congested', sample_count: 12, availability_percent: 75 }],
    }
    body.incidents = [{ id: 'incident-1', component_id: 'optimization', title: '队列延迟', impact: 'minor', status: 'resolved', started_at: '2026-08-01T01:00:00.000Z', resolved_at: '2026-08-01T02:00:00.000Z', updated_at: '2026-08-01T02:00:00.000Z', updates: [{ id: 'update-1', status: 'resolved', body: '已恢复。', created_at: '2026-08-01T02:00:00.000Z' }] }]
    vi.mocked(fetch).mockResolvedValue(response(200, body))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('heading', { name: '过去 30 天' })).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')).toHaveLength(30 * 24)
    expect(screen.getByLabelText(/队列拥堵/)).toBeInTheDocument()
    expect(screen.getByText('队列延迟')).toBeInTheDocument()
    expect(screen.getByText('已恢复。')).toBeInTheDocument()
  })
})

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function payload(status: 'available' | 'unavailable', queue: { queued: number; running: number } | null) {
  return {
    generated_at: '2026-08-08T09:00:00.000Z',
    status,
    queue: queue ? { ...queue, queue_limit: 200, worker_concurrency: 3, worker_instances: 1 } : null,
    components: [{ id: 'optimization', status }],
    thresholds: { queue_congested_at: 5 },
  }
}
