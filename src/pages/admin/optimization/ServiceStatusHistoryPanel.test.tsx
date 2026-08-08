// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import ServiceStatusHistoryPanel from './ServiceStatusHistoryPanel'

describe('ServiceStatusHistoryPanel', () => {
  afterEach(cleanup)

  beforeEach(() => {
    adminApiJson.mockReset().mockImplementation(async (_url: string, options?: { method?: string }) => options?.method ? { incident: incident() } : response())
  })

  it('shows cost inputs and appends an incident update', async () => {
    render(<ServiceStatusHistoryPanel />)
    expect(await screen.findByText(/利用率\s*62\.5%/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('追加公开更新'), { target: { value: '正在观察恢复情况。' } })
    fireEvent.click(screen.getByRole('button', { name: '追加更新' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/service-status', expect.objectContaining({
      method: 'PATCH',
      json: expect.objectContaining({ action: 'append_update', incident_id: 'incident-1', body: '正在观察恢复情况。' }),
    })))
  })

  it('creates incidents and disables duplicate submission while saving', async () => {
    let finish: (() => void) | undefined
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string }) => {
      if (!options?.method) return response()
      await new Promise<void>((resolve) => { finish = resolve })
      return { incident: incident() }
    })
    render(<ServiceStatusHistoryPanel />)
    await screen.findByText('状态事件')
    fireEvent.change(screen.getByPlaceholderText('事件标题'), { target: { value: '服务延迟' } })
    fireEvent.change(screen.getByPlaceholderText('公开更新内容'), { target: { value: '正在调查。' } })
    fireEvent.click(screen.getByRole('button', { name: '创建事件' }))
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    finish?.()
  })
})

function response() {
  return {
    generated_at: '2026-08-08T09:00:00.000Z', status: 'busy', queue: null,
    components: [{ id: 'optimization', status: 'busy' }], thresholds: { queue_congested_at: 5 },
    history: { from: '2026-07-09T09:00:00.000Z', to: '2026-08-08T09:00:00.000Z', interval: 'hour', complete: true, buckets: [{ component_id: 'optimization', bucket_start: '2026-08-08T08:00:00.000Z', status: 'busy', sample_count: 12, availability_percent: 75, busy_samples: 3, congested_samples: 0, average_active_concurrency: 2.5, average_provisioned_concurrency: 4, average_utilization_percent: 62.5, peak_queued: 3, peak_running: 4, peak_worker_instances: 1, unavailable_samples: 0 }] },
    incidents: [incident()],
  }
}

function incident() {
  return { id: 'incident-1', component_id: 'optimization', title: '状态事件', impact: 'minor', status: 'investigating', started_at: '2026-08-08T08:00:00.000Z', resolved_at: null, updated_at: '2026-08-08T08:00:00.000Z', updates: [{ id: 'update-1', status: 'investigating', body: '正在调查。', created_at: '2026-08-08T08:00:00.000Z' }] }
}
