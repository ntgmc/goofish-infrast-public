// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceStatusLevel } from '../lib/service-status'

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
    expect(componentSection).toHaveTextContent('森空岛导入')
    expect(componentSection).toHaveTextContent('干员、仓库数据导入服务')
    expect(componentSection).not.toHaveTextContent('等待任务')
    expect(componentSection).not.toHaveTextContent('运行中')
    expect(componentSection).not.toHaveTextContent('并发容量')
  })

  it('renders a server-reported unavailable state without a connection error', async () => {
    vi.mocked(fetch).mockResolvedValue(response(503, payload('unavailable', null)))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByText('暂不可用').length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeInTheDocument()
  })

  it('keeps the last known status when a refresh cannot reach the status endpoint', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, payload('available', { queued: 0, running: 1 })))
      .mockRejectedValueOnce(new TypeError('network error'))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
      await Promise.resolve()
    })

    expect(screen.getAllByText('运行正常').length).toBeGreaterThan(0)
    expect(screen.getByRole('alert')).toHaveTextContent('无法连接到状态接口')
  })

  it('does not report an outage when the initial status request fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('network error'))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    const overall = screen.getByRole('heading', { name: '状态暂时无法获取' }).closest('section')
    expect(overall).toHaveTextContent('状态未知')
    expect(overall).toHaveTextContent('暂无可用更新时间')
    expect(overall).not.toHaveTextContent('暂不可用')
  })

  it('renders orange when the queue exceeds twenty jobs', async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, payload('overloaded', { queued: 21, running: 3 })))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByText('排队过多').length).toBeGreaterThan(0)
    expect(screen.getAllByText('服务排队超过 20 个，处理等待明显增加。').length).toBeGreaterThan(0)
  })

  it('renders elastic processing while autoscaling consumes the queue', async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, payload('scaling', { queued: 5, running: 3 })))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByText('弹性处理中').length).toBeGreaterThan(0)
    expect(screen.getByText('自动扩缩容正在消化排队任务，服务保持可用。')).toBeInTheDocument()
  })

  it('renders the Skland import status independently from optimization', async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, payload('available', { queued: 0, running: 1 }, 'unavailable')))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    const sklandComponent = screen.getByRole('heading', { name: '森空岛导入' }).closest('article')
    expect(sklandComponent).toHaveTextContent('不可用')
    expect(screen.getByRole('heading', { name: '当前服务运行正常。' })).toBeInTheDocument()
  })

  it('renders a 7-day hourly history grid and incident updates', async () => {
    const body = payload('available', { queued: 0, running: 1 }) as Record<string, unknown>
    body.history = {
      from: '2026-07-09T09:00:00.000Z',
      to: '2026-08-08T09:00:00.000Z',
      interval: 'hour',
      complete: true,
      buckets: [
        { component_id: 'optimization', bucket_start: '2026-08-08T07:00:00.000Z', status: 'overloaded', sample_count: 12, availability_percent: 50 },
        { component_id: 'optimization', bucket_start: '2026-08-08T08:00:00.000Z', status: 'congested', sample_count: 12, availability_percent: 75 },
        { component_id: 'optimization', bucket_start: '2026-08-08T06:00:00.000Z', status: 'scaling', sample_count: 12, availability_percent: 100 },
      ],
    }
    body.incidents = [{ id: 'incident-1', component_id: 'optimization', title: '队列延迟', impact: 'minor', status: 'resolved', started_at: '2026-08-01T01:00:00.000Z', resolved_at: '2026-08-01T02:00:00.000Z', updated_at: '2026-08-01T02:00:00.000Z', updates: [{ id: 'update-1', status: 'resolved', body: '已恢复。', created_at: '2026-08-01T02:00:00.000Z' }] }]
    vi.mocked(fetch).mockResolvedValue(response(200, body))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('heading', { name: '最近 7 天' })).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')).toHaveLength(7 * 24)
    expect(screen.getByLabelText(/排队过多/)).toBeInTheDocument()
    expect(screen.getByLabelText(/服务繁忙/)).toBeInTheDocument()
    expect(screen.getByLabelText(/弹性处理中/)).toBeInTheDocument()
    expect(screen.getByText('队列延迟')).toBeInTheDocument()
    expect(screen.getByText('已恢复。')).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell').every((cell) => !cell.hasAttribute('tabindex'))).toBe(true)
    expect(document.querySelector('.service-status-history-axis')).toHaveTextContent('17时')
  })

  it('shows every active incident and only the three most recent resolved incidents', async () => {
    const body = payload('available', { queued: 0, running: 1 }) as Record<string, unknown>
    body.incidents = [
      incident('active-1', '进行中一', 'investigating'),
      incident('active-2', '进行中二', 'monitoring'),
      incident('resolved-1', '最近解决一', 'resolved'),
      incident('resolved-2', '最近解决二', 'resolved'),
      incident('resolved-3', '最近解决三', 'resolved'),
      incident('resolved-4', '更早解决', 'resolved'),
    ]
    vi.mocked(fetch).mockResolvedValue(response(200, body))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('进行中的事件')).toBeInTheDocument()
    expect(screen.getByText('最近已解决')).toBeInTheDocument()
    expect(screen.getByText('进行中一')).toBeInTheDocument()
    expect(screen.getByText('进行中二')).toBeInTheDocument()
    expect(screen.getByText('最近解决一')).toBeInTheDocument()
    expect(screen.getByText('最近解决二')).toBeInTheDocument()
    expect(screen.getByText('最近解决三')).toBeInTheDocument()
    expect(screen.queryByText('更早解决')).not.toBeInTheDocument()
  })
})

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function payload(status: ServiceStatusLevel, queue: { queued: number; running: number } | null, sklandStatus: ServiceStatusLevel = 'available') {
  return {
    generated_at: '2026-08-08T09:00:00.000Z',
    status,
    queue: queue ? { ...queue, queue_limit: 200, worker_concurrency: 3, worker_instances: 1 } : null,
    components: [{ id: 'optimization', status }, { id: 'skland_import', status: sklandStatus }],
    thresholds: { queue_congested_at: 5, queue_overloaded_at: 20 },
  }
}

function incident(id: string, title: string, status: 'investigating' | 'monitoring' | 'resolved') {
  return {
    id,
    component_id: 'optimization',
    title,
    impact: 'minor',
    status,
    started_at: '2026-08-01T01:00:00.000Z',
    resolved_at: status === 'resolved' ? '2026-08-01T02:00:00.000Z' : null,
    updated_at: '2026-08-01T02:00:00.000Z',
    updates: [],
  }
}
