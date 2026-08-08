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

  it('renders the available status and queue capacity', async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, payload('available', { queued: 0, running: 1 })))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByText('运行正常').length).toBeGreaterThan(0)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders an unavailable state and exposes a retry path on a 503', async () => {
    vi.mocked(fetch).mockResolvedValue(response(503, payload('unavailable', null)))
    render(<MemoryRouter><StatusPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByText('暂不可用').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重新检查' })).toBeInTheDocument()
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
