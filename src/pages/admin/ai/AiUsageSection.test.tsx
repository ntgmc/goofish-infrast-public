// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '../../../test/private-query-render'
import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminAiUsagePage, AiUsageRecord } from '../../../lib/ai-usage'
import { DEFAULT_AI_SETTINGS } from '../../../lib/ai-settings'
import { copy } from '../../../copy'
import AiServiceSection from './AiServiceSection'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: api }))
const text = copy.aiUsage
const record: AiUsageRecord = { id: 'attempt1', user_id: 'user1', profile_id: 'profile1', result_id: 'result1', status: 'succeeded',
  created_at: '2026-11-17T01:00:00.000Z', settled_at: '2026-11-17T01:00:01.000Z', duration_ms: 1000,
  cost_micro_cny: 480, reserved_micro_cny: 9600, cost_basis: 'usage',
  pricing: { ...DEFAULT_AI_SETTINGS, provider: '测试服务商', model: 'test-model', inputPrice: 1, outputPrice: 2, cachedInputPrice: 0.1 },
  usage: { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 800, cache_write_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 },
  breakdown: { input: 200, cached_input: 80, cache_write_5m: 0, cache_write_1h: 0, output: 200 }, provider_request_id: 'provider-request', error_code: null }
const totals: AdminAiUsagePage['totals'] = { requests: 1, succeeded: 1, failed: 0, pending: 0, metered_requests: 1,
  cache_reported_requests: 1, input_tokens: 1000, output_tokens: 100, cached_input_tokens: 800, cache_write_tokens: 0,
  cost_micro_cny: 480, usage_cost_micro_cny: 480, estimated_cost_micro_cny: 0, reserved_cost_micro_cny: 0,
  input_cost_micro_cny: 200, cached_input_cost_micro_cny: 80, cache_write_cost_micro_cny: 0, output_cost_micro_cny: 200 }
const page: AdminAiUsagePage = { items: [record], totals, daily: [{ ...totals, day: '2026-11-17' }],
  models: [{ ...totals, provider: '测试服务商', model: 'test-model', protocol: 'openai_chat' }], pagination: { page: 1, page_size: 25, total: 26, total_pages: 2 } }
beforeEach(() => {
  api.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/admin/ai-usage?id=')) return { item: record, explanation: { text: '先核对培养成本。', created_at: record.created_at } }
    if (url.startsWith('/api/admin/ai-usage')) return page
    if (url === '/api/admin/ai-settings') return { settings: DEFAULT_AI_SETTINGS, has_api_key: true, enabled: false, effective_enabled: false, revision: 1, feature_revision: 1, updated_at: null }
    throw new Error(`Unexpected ${url}`)
  })
})
afterEach(cleanup)

it('shows scoped totals and tables, then loads billing and saved output only when opening a record', async () => {
  const user = userEvent.setup()
  render(<AiServiceSection />)
  await screen.findByRole('region', { name: text.calls })
  expect(screen.getByRole('region', { name: text.daily })).toBeVisible()
  expect(screen.getByRole('region', { name: text.models })).toBeVisible()
  expect(api.mock.calls.some(([url]) => url.includes('?id='))).toBe(false)
  await user.click(screen.getByRole('button', { name: text.detail }))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('先核对培养成本。')).toBeVisible()
  expect(within(dialog).getByText('provider-request')).toBeVisible()
  expect(within(dialog).getByRole('region', { name: text.breakdown })).toHaveTextContent('¥0.00008')
  expect(api.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('applies filters only on submit and uses server pagination', async () => {
  render(<AiServiceSection />)
  await screen.findByRole('region', { name: text.calls })
  const before = api.mock.calls.length
  fireEvent.change(screen.getByLabelText(text.model), { target: { value: 'different-model' } })
  expect(api).toHaveBeenCalledTimes(before)
  fireEvent.click(screen.getByRole('button', { name: text.query }))
  await waitFor(() => expect(api.mock.calls[api.mock.calls.length - 1][0]).toContain('model=different-model'))
  const next = await screen.findByRole('button', { name: '下一页' })
  fireEvent.click(next)
  await waitFor(() => expect(api.mock.calls[api.mock.calls.length - 1][0]).toContain('page=2'))
})

it('recovers read errors and keeps configuration drafts while switching tabs', async () => {
  api.mockRejectedValueOnce(new Error('读取失败'))
  const user = userEvent.setup()
  render(<AiServiceSection />)
  expect(await screen.findByRole('alert')).toHaveTextContent('读取失败')
  await user.click(screen.getByRole('button', { name: text.refresh }))
  await screen.findByRole('region', { name: text.calls })
  await user.click(screen.getByRole('tab', { name: text.settings }))
  const model = await screen.findByLabelText(copy.aiSettings.model)
  await user.type(model, 'draft-model')
  await user.click(screen.getByRole('tab', { name: text.records }))
  await user.click(screen.getByRole('tab', { name: text.settings }))
  expect(screen.getByLabelText(copy.aiSettings.model)).toHaveValue('draft-model')
})

it('distinguishes unknown historical tokens and empty results from zero consumption', async () => {
  api.mockResolvedValueOnce({ ...page, items: [{ ...record, usage: null, pricing: null, cost_basis: 'legacy' }] })
  render(<AiServiceSection />)
  const table = await screen.findByRole('region', { name: text.calls })
  expect(table).toHaveTextContent(text.bases.legacy)
  expect(table).toHaveTextContent(text.no_data)
  api.mockResolvedValueOnce({ ...page, items: [], totals: { ...totals, requests: 0 } })
  fireEvent.click(screen.getByRole('button', { name: text.refresh }))
  expect(await screen.findByText(text.empty)).toBeVisible()
})
