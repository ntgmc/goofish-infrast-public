// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '../../../test/private-query-render'
import userEvent from '@testing-library/user-event'
import { DEFAULT_AI_SETTINGS, type AdminAiSettings } from '../../../lib/ai-settings'
import { ApiError } from '../../../lib/api-client'
import { copy } from '../../../copy'
import AiSettingsSection from './AiSettingsSection'
const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: api }))
const text = copy.aiSettings
const initial: AdminAiSettings = { settings: { ...DEFAULT_AI_SETTINGS, provider: '服务商', baseURL: 'https://example.test/v1', model: 'model', inputPrice: 1, outputPrice: 2 },
  enabled: false, effective_enabled: false, revision: 4, feature_revision: 5, has_api_key: true, updated_at: null }
beforeEach(() => { api.mockReset(); api.mockResolvedValue(structuredClone(initial)) })
afterEach(cleanup)
it('retains the saved key when blank and submits the model, protocol, limits and both revisions', async () => {
  api.mockResolvedValueOnce({ ...initial, settings: { ...initial.settings, creditPrices: { schedule_explanation: '4.00', comparison: null, cultivation: '1.25', changes: null } } })
  const user = userEvent.setup()
  render(<AiSettingsSection />)
  expect(await screen.findByLabelText(text.api_key)).toHaveValue('')
  expect(screen.getByLabelText(copy.balance.services.schedule_explanation)).toHaveValue('4')
  expect(screen.getByLabelText(copy.balance.services.cultivation)).toHaveValue('1.25')
  await user.selectOptions(screen.getByLabelText(text.protocol), 'anthropic_messages')
  await user.click(screen.getByRole('checkbox', { name: new RegExp(text.enabled) }))
  fireEvent.change(screen.getByLabelText(text.fields.dailyAttemptLimit), { target: { value: '25' } })
  fireEvent.change(screen.getByLabelText(text.fields.cachedInputPrice), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText(text.fields.cacheWrite1hPrice), { target: { value: '4' } })
  fireEvent.change(screen.getByLabelText(copy.balance.services.schedule_explanation), { target: { value: '1.5' } })
  fireEvent.change(screen.getByLabelText(copy.balance.services.cultivation), { target: { value: '3.00' } })
  await user.type(screen.getByLabelText(text.reason), '开放解读')
  api.mockResolvedValueOnce({ ...initial, revision: 5, feature_revision: 6, enabled: true, settings: { ...initial.settings, creditPrices: { schedule_explanation: '1.50', comparison: null, cultivation: '3.00', changes: null } } })
  await user.click(screen.getByRole('button', { name: text.save }))
  await screen.findByText(text.saved)
  expect(api).toHaveBeenLastCalledWith('/api/admin/ai-settings', expect.objectContaining({ method: 'PUT', json: expect.objectContaining({
    expected_revision: 4, expected_feature_revision: 5, enabled: true, settings: expect.objectContaining({ protocol: 'anthropic_messages', dailyAttemptLimit: 25, cachedInputPrice: 0, cacheWritePrice: null, cacheWrite1hPrice: 4, creditPrices: { schedule_explanation: '1.50', comparison: null, cultivation: '3.00', changes: null } }),
  }) }))
  expect(api.mock.calls[api.mock.calls.length - 1][1].json).not.toHaveProperty('api_key')
  expect(screen.getByLabelText(copy.balance.services.schedule_explanation)).toHaveValue('1.5')
  expect(screen.getByLabelText(copy.balance.services.cultivation)).toHaveValue('3')
})
it('rejects invalid point prices without saving and retains the entered value', async () => {
  const user = userEvent.setup()
  render(<AiSettingsSection />)
  const price = await screen.findByLabelText(copy.balance.services.schedule_explanation)
  fireEvent.change(price, { target: { value: '0.001' } })
  await user.type(screen.getByLabelText(text.reason), '配置价格')
  await user.click(screen.getByRole('button', { name: text.save }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.invalid)
  expect(price).toHaveAttribute('aria-invalid', 'true')
  expect(price).toHaveValue('0.001')
  expect(api).toHaveBeenCalledTimes(1)
})

it('clears typed replacement credentials after a successful save', async () => {
  const user = userEvent.setup()
  render(<AiSettingsSection />)
  await user.type(await screen.findByLabelText(text.api_key), 'replacement-test-token')
  await user.type(screen.getByLabelText(text.reason), '轮换密钥')
  await user.click(screen.getByRole('button', { name: text.save }))
  await screen.findByText(text.saved)
  expect(api.mock.calls[api.mock.calls.length - 1][1].json.api_key).toBe('replacement-test-token')
  expect(screen.getByLabelText(text.api_key)).toHaveValue('')
})
it('blocks incomplete enablement and focuses the error before sending a mutation', async () => {
  api.mockResolvedValueOnce({ ...initial, settings: DEFAULT_AI_SETTINGS, has_api_key: false })
  const user = userEvent.setup()
  render(<AiSettingsSection />)
  await user.click(await screen.findByRole('checkbox', { name: new RegExp(text.enabled) }))
  await user.type(screen.getByLabelText(text.reason), '准备开放')
  await user.click(screen.getByRole('button', { name: text.save }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.invalid)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  expect(screen.getByLabelText(text.api_key)).toHaveAttribute('aria-invalid', 'true')
  expect(api).toHaveBeenCalledTimes(1)
})
it('keeps a draft on revision conflicts and only deletes a key on explicit request', async () => {
  const user = userEvent.setup()
  render(<AiSettingsSection />)
  await user.click(await screen.findByLabelText(text.clear_key))
  await user.type(screen.getByLabelText(text.reason), '撤销密钥')
  api.mockRejectedValueOnce(new ApiError('conflict', 409, {}, '/api/admin/ai-settings'))
  await user.click(screen.getByRole('button', { name: text.save }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.conflict)
  expect(screen.getByLabelText(text.clear_key)).toBeChecked()
  expect(api.mock.calls[api.mock.calls.length - 1][1].json).toMatchObject({ clear_api_key: true })
  expect(api.mock.calls[api.mock.calls.length - 1][1].json).not.toHaveProperty('api_key')
})
