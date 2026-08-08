// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.getByText('ECS 按量成本计划')).toBeInTheDocument()
    expect(screen.getByText('计划每日实例小时')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('追加公开更新'), { target: { value: '正在观察恢复情况。' } })
    fireEvent.click(screen.getByRole('button', { name: '追加更新' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/service-status', expect.objectContaining({
      method: 'PATCH',
      json: expect.objectContaining({ action: 'append_update', incident_id: 'incident-1', body: '正在观察恢复情况。' }),
    })))
  })

  it('applies the dynamic ECS recommendation and saves the plan', async () => {
    render(<ServiceStatusHistoryPanel />)
    await screen.findByText('自动启停建议')
    fireEvent.click(screen.getByRole('button', { name: '采用推荐计划' }))
    expect(within(screen.getByText('低谷常态实例数').closest('label')!).getByRole('spinbutton')).toHaveValue(1)
    fireEvent.click(screen.getByRole('button', { name: '保存成本计划' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/service-status', expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({ action: 'save_cost_config', schedule_enabled: true, valley_worker_instances: 1 }),
    })))
  })

  it('keeps the recommendation read-only while historical coverage is limited', async () => {
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string }) => options?.method
      ? { incident: incident() }
      : ({ ...response(), cost: { ...response().cost, recommendation: { ...response().cost.recommendation, confidence: 'limited' } } }))
    render(<ServiceStatusHistoryPanel />)
    const applyButton = await screen.findByRole('button', { name: '采用推荐计划' })
    expect(applyButton).toBeDisabled()
    expect(screen.getByText('建议覆盖至少 12 个小时段后采用推荐计划。')).toBeInTheDocument()
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
    cost: { config: { component_id: 'optimization', billing_model: 'ecs_payg', currency: 'CNY', hourly_price_cny: 0.8, timezone: 'Asia/Shanghai', schedule_enabled: false, valley_worker_instances: 1, peak_windows: [], updated_at: null }, estimate: { observed_24h_worker_hours: 24, observed_30d_worker_hours: 720, planned_daily_worker_hours: 24, planned_monthly_worker_hours: 720, estimated_daily_cost_cny: 19.2, estimated_monthly_cost_cny: 576 }, recommendation: { generated_at: '2026-08-08T09:00:00.000Z', source_sample_count: 12, confidence: 'observed', valley_worker_instances: 1, peak_windows: [{ start: '09:00', end: '18:00', worker_instances: 3 }], hourly_worker_instances: [1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1], rationale: ['按上海时区分析了 1 个小时段的历史样本。'] } },
  }
}

function incident() {
  return { id: 'incident-1', component_id: 'optimization', title: '状态事件', impact: 'minor', status: 'investigating', started_at: '2026-08-08T08:00:00.000Z', resolved_at: null, updated_at: '2026-08-08T08:00:00.000Z', updates: [{ id: 'update-1', status: 'investigating', body: '正在调查。', created_at: '2026-08-08T08:00:00.000Z' }] }
}
