// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '../../../test/private-query-render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import ServiceStatusHistoryPanel from './ServiceStatusHistoryPanel'

describe('ServiceStatusHistoryPanel', () => {
  afterEach(cleanup)

  beforeEach(() => {
    adminApiJson.mockReset().mockImplementation(async (_url: string, options?: { method?: string }) => options?.method ? { incident: incident() } : response())
  })

  it('shows automatic lifecycle cost inputs and appends an incident update', async () => {
    render(<ServiceStatusHistoryPanel />)
    expect(await screen.findByText(/利用率\s*62\.5%/)).toBeInTheDocument()
    expect(screen.getByText('Worker ECS 成本')).toBeInTheDocument()
    expect(screen.getByText('过去 24 小时合计费用')).toBeInTheDocument()
    expect(screen.getByText('按近 24 小时推算月费用')).toBeInTheDocument()
    expect(screen.getByText('Burst 已停止，常驻 Worker 持续计费')).toBeInTheDocument()
    expect(screen.queryByText('自动启停建议')).not.toBeInTheDocument()
    expect(screen.queryByText('低谷常态实例数')).not.toBeInTheDocument()
    expect(screen.queryByText('启用峰谷启停计划')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('追加公开更新'), { target: { value: '正在观察恢复情况。' } })
    fireEvent.click(screen.getByRole('button', { name: '追加更新' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/service-status', expect.objectContaining({
      method: 'PATCH',
      json: expect.objectContaining({ action: 'append_update', incident_id: 'incident-1', body: '正在观察恢复情况。' }),
    })))
  })

  it('disables price edits while saving resident and burst prices and clears obsolete peak/valley settings', async () => {
    let finish!: () => void
    adminApiJson.mockImplementation(async (_url: string, options?: { method?: string }) => {
      if (options?.method) await new Promise<void>((resolve) => { finish = resolve })
      return response()
    })
    render(<ServiceStatusHistoryPanel />)
    const residentPrice = await screen.findByRole('spinbutton', { name: /常驻 Worker（2 核）每小时单价（元）/ })
    const burstPrice = screen.getByRole('spinbutton', { name: /Burst Worker（4 核）每小时单价（元）/ })
    fireEvent.change(residentPrice, { target: { value: '0.3' } })
    fireEvent.change(burstPrice, { target: { value: '0.9' } })
    fireEvent.click(screen.getByRole('button', { name: '保存计费单价' }))
    expect(residentPrice).toBeDisabled()
    expect(burstPrice).toBeDisabled()
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/service-status', expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({ action: 'save_cost_config', resident_hourly_price_cny: 0.3, hourly_price_cny: 0.9, schedule_enabled: false, valley_worker_instances: 0, peak_windows: [] }),
    })))
    finish()
    await waitFor(() => expect(burstPrice).toBeEnabled())
  })

  it('recalculates legacy sparse estimates against history.to', async () => {
    const value = response()
    adminApiJson.mockResolvedValue({ ...value, history: { ...value.history, buckets: [
      { ...value.history.buckets[0], bucket_start: '2026-08-06T09:00:00.000Z', average_worker_instances: 3 },
      { ...value.history.buckets[0], average_worker_instances: 1 },
    ] }, cost: { ...value.cost, config: { ...value.cost.config, hourly_price_cny: 0.5 }, estimate: {} } })
    render(<ServiceStatusHistoryPanel />)
    expect(await screen.findByText('0.70 元')).toBeInTheDocument()
    expect(screen.getByText('504.00 元')).toBeInTheDocument()
    expect(screen.getByText('过去 24 小时合计费用').parentElement).not.toHaveTextContent('2.40 元')
  })

  it('keeps cost values available without rendering the retired recommendation controls', async () => {
    render(<ServiceStatusHistoryPanel />)
    const total = (await screen.findByText('过去 24 小时合计费用')).parentElement!
    expect(total).toHaveTextContent('9.60 元')
    expect(screen.queryByRole('button', { name: '采用推荐计划' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '启用峰谷启停计划' })).not.toBeInTheDocument()
  })

  it('separates resident costs from stopped burst usage and previews price changes', async () => {
    const value = response()
    adminApiJson.mockResolvedValue({ ...value, history: { ...value.history, buckets: value.history.buckets.map((bucket) => ({ ...bucket, average_worker_instances: 0 })) },
      cost: { ...value.cost, config: { ...value.cost.config, hourly_price_cny: null } } })
    render(<ServiceStatusHistoryPanel />)
    const residentPrice = await screen.findByRole('spinbutton', { name: /常驻 Worker（2 核）每小时单价（元）/ })
    const resident = screen.getByText('过去 24 小时常驻实例小时').parentElement!
    const burst = screen.getByText('过去 24 小时 Burst 实例小时').parentElement!
    const total = screen.getByText('过去 24 小时合计费用').parentElement!
    expect(within(resident).getByText('24 小时')).toBeInTheDocument()
    expect(resident).toHaveTextContent('估算费用 4.80 元')
    expect(within(burst).getByText('0 小时')).toBeInTheDocument()
    expect(burst).toHaveTextContent('估算费用 0.00 元')
    expect(total).toHaveTextContent('4.80 元')
    expect(screen.getByText('按近 24 小时推算月费用').parentElement).toHaveTextContent('144.00 元')
    fireEvent.change(residentPrice, { target: { value: '0.3' } })
    expect(resident).toHaveTextContent('估算费用 7.20 元')
    expect(total).toHaveTextContent('7.20 元')
    expect(screen.getByText('按近 24 小时推算月费用').parentElement).toHaveTextContent('216.00 元')
    expect(adminApiJson).not.toHaveBeenCalledWith('/api/admin/service-status', expect.objectContaining({ method: 'POST' }))
  })

  it('shows missing observations without reporting zero usage or an unconfigured price', async () => {
    const value = response()
    adminApiJson.mockResolvedValue({ ...value, history: { ...value.history, buckets: [] } })
    render(<ServiceStatusHistoryPanel />)
    const total = (await screen.findByText('过去 24 小时合计费用')).parentElement!
    expect(total).toHaveTextContent('—')
    expect(total).toHaveTextContent('暂无有效采样')
    expect(screen.getByText('过去 24 小时 Burst 实例小时').parentElement).toHaveTextContent('—')
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
    generated_at: '2026-08-08T09:00:00.000Z', status: 'busy', queue: { queued: 0, running: 0, queue_limit: 200, worker_concurrency: 1, worker_instances: 1, billable_worker_instances: 0 },
    components: [{ id: 'optimization', status: 'busy' }], thresholds: { queue_congested_at: 5, queue_overloaded_at: 20 },
    history: { from: '2026-07-09T09:00:00.000Z', to: '2026-08-08T09:00:00.000Z', interval: 'hour', complete: true, buckets: Array.from({ length: 24 }, (_, index) => ({ component_id: 'optimization', bucket_start: new Date(Date.UTC(2026, 7, 7, 9 + index)).toISOString(), status: 'busy', sample_count: 12, availability_percent: 75, busy_samples: 3, congested_samples: 0, overloaded_samples: 0, average_active_concurrency: 2.5, average_provisioned_concurrency: 4, average_worker_instances: 0.25, average_utilization_percent: index === 23 ? 62.5 : 0, peak_queued: 3, peak_running: 4, peak_worker_instances: 1, unavailable_samples: 0 })) },
    incidents: [incident()],
    cost: { config: { component_id: 'optimization', billing_model: 'ecs_payg', currency: 'CNY', resident_hourly_price_cny: 0.2, hourly_price_cny: 0.8, timezone: 'Asia/Shanghai', schedule_enabled: false, valley_worker_instances: 1, peak_windows: [], updated_at: null }, estimate: { observed_24h_worker_hours: 6, observed_30d_worker_hours: 120, observed_24h_sample_hours: 24, observed_30d_sample_hours: 720, observed_24h_cost_cny: 9.6, observed_30d_cost_cny: 240, projected_monthly_cost_cny: 288, observed_savings_cny: 480, planned_daily_worker_hours: 24, planned_monthly_worker_hours: 720, estimated_daily_cost_cny: 24, estimated_monthly_cost_cny: 720 }, recommendation: { generated_at: '2026-08-08T09:00:00.000Z', source_sample_count: 12, confidence: 'observed', valley_worker_instances: 1, peak_windows: [{ start: '09:00', end: '18:00', worker_instances: 3 }], hourly_worker_instances: [1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1], rationale: ['按上海时区分析了 1 个小时段的历史样本。'] } },
  }
}

function incident() {
  return { id: 'incident-1', component_id: 'optimization', title: '状态事件', impact: 'minor', status: 'investigating', started_at: '2026-08-08T08:00:00.000Z', resolved_at: null, updated_at: '2026-08-08T08:00:00.000Z', updates: [{ id: 'update-1', status: 'investigating', body: '正在调查。', created_at: '2026-08-08T08:00:00.000Z' }] }
}
