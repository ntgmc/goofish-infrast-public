// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { cleanup, render, screen, waitFor } from '../../../test/query-render'
import QqBotActivities from './QqBotActivities'
import QqBotVerificationPanel from '../../../components/QqBotVerificationPanel'
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../../lib/api-client', () => ({ apiJson: mocks.api }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const activity = { group_id: '2101', campaign_id: 'oldmember', item_code: 'maa_export_trial_coupon', item_name: 'MAA 导出体验券', icon_key: 'maa_export_trial_coupon', quantity: 1, validity_days: 30, min_join_days: 0, joined_before: '2026-11-03T16:00:00Z', ends_at: null, enabled: true, claimed: false, claimed_elsewhere: false }
const verification = { id: '00000000-0000-4000-8000-000000000001', qq_number: '123456789', group_id: '2101', campaign_id: 'oldmember', kind: 'message', status: 'pending', expires_at: '2030-01-01T00:00:00Z', error_message: null }

it('retains the activity through verification, keeps a failed confirmation retryable and refreshes claimed state', async () => {
  let row: typeof verification | null = null, claimed = false, bound = false, attempts = 0
  const writes: unknown[] = []
  mocks.api.mockImplementation(async (url: string, options?: { method?: string; json?: { action: string } }) => {
    if (options?.method === 'POST') {
      writes.push(options.json)
      if (options.json?.action === 'start') { row = { ...verification }; return { verification: row, code: 'A1B2C3-D4E5F6' } }
      if (++attempts === 1) throw new Error('网站暂时不可用，请重试')
      row = { ...verification, status: 'completed' }; claimed = true; bound = true
      return { status: 'completed' }
    }
    if (url.startsWith('/api/user/qqbot/activities')) return { campaigns: [{ ...activity, claimed }] }
    if (url === '/api/user/qqbot') return { available: true, binding: bound ? { qq_number: verification.qq_number } : null }
    return { verification: row }
  })
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/v2?section=inventory&view=qq-groups&group_id=2101&campaign_id=oldmember']}><QqBotActivities userId="user-1" /></MemoryRouter>)
  await user.type(await screen.findByLabelText('你的 QQ 号'), verification.qq_number)
  await user.click(screen.getByRole('button', { name: '生成群内验证消息' }))
  expect(await screen.findByLabelText('群内验证消息')).toHaveValue('网站绑定确认 A1B2C3-D4E5F6')
  expect(writes[0]).toEqual({ action: 'start', qq_number: verification.qq_number, group_id: '2101', campaign_id: 'oldmember' })
  expect(screen.queryByRole('button', { name: '确认绑定并领取' })).not.toBeInTheDocument()
  row = { ...verification, status: 'verified' }
  await user.click(screen.getByRole('button', { name: '刷新验证状态' }))
  await user.click(await screen.findByRole('button', { name: '确认绑定并领取' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('网站暂时不可用')
  expect(screen.getByLabelText('你的 QQ 号')).toHaveValue(verification.qq_number)
  await user.click(screen.getByRole('button', { name: '确认绑定并领取' }))
  expect(await screen.findByText('已领取，奖励可在背包查看。')).toBeInTheDocument()
  expect(writes.slice(1)).toEqual(Array(2).fill({ action: 'confirm', verification_id: verification.id }))
})

it('submits a bound claim once, waits for background membership and shows the website result', async () => {
  let row: typeof verification | null = null, claimed = false
  const writes: unknown[] = []
  mocks.api.mockImplementation(async (url: string, options?: { method?: string; json?: unknown }) => {
    if (options?.method === 'POST') { writes.push(options.json); row = { ...verification, kind: 'membership' }; return { verification: row } }
    if (url.startsWith('/api/user/qqbot/activities')) return { campaigns: [{ ...activity, claimed }] }
    if (url === '/api/user/qqbot') return { available: true, binding: { qq_number: verification.qq_number } }
    return { verification: row }
  })
  const user = userEvent.setup()
  render(<MemoryRouter><QqBotActivities userId="user-2" /></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: '领取奖励' }))
  expect(await screen.findByRole('button', { name: '正在核验…' })).toBeDisabled()
  expect(screen.queryByLabelText('群内验证消息')).not.toBeInTheDocument()
  row = { ...verification, kind: 'membership', status: 'completed' }; claimed = true
  await user.click(screen.getByRole('button', { name: '刷新验证状态' }))
  await waitFor(() => expect(screen.getByText('已领取，奖励可在背包查看。')).toBeInTheDocument())
  expect(writes).toEqual([{ action: 'claim', group_id: '2101', campaign_id: 'oldmember' }])
})

it('keeps generic account binding separate from a previously verified activity', async () => {
  let row = { ...verification, status: 'verified', campaign_id: 'oldmember' as string | null }
  const writes: unknown[] = []
  mocks.api.mockImplementation(async (_url: string, options?: { method?: string; json?: unknown }) => {
    if (options?.method === 'POST') {
      writes.push(options.json); row = { ...verification, campaign_id: null }
      return { verification: row, code: 'A1B2C3-D4E5F6' }
    }
    return { verification: row }
  })
  const user = userEvent.setup()
  render(<QqBotVerificationPanel userId="user-3" />)
  await waitFor(() => expect(mocks.api).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: '确认绑定并领取' })).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('你的 QQ 号'), verification.qq_number)
  await user.type(screen.getByLabelText('QQ 群号'), verification.group_id)
  await user.click(screen.getByRole('button', { name: '生成群内验证消息' }))
  expect(await screen.findByLabelText('群内验证消息')).toBeInTheDocument()
  expect(writes).toEqual([{ action: 'start', qq_number: verification.qq_number, group_id: verification.group_id, campaign_id: null }])
  row = { ...row, status: 'verified' }
  await user.click(screen.getByRole('button', { name: '刷新验证状态' }))
  expect(await screen.findByRole('button', { name: '确认绑定 QQ' })).toBeInTheDocument()
})

it('ignores a completed check belonging to the previous QQ after rebinding', async () => {
  mocks.api.mockResolvedValue({ verification: { ...verification, status: 'completed' } })
  render(<QqBotVerificationPanel userId="user-4" groupId="2101" campaignId="oldmember" boundQq="987654321" />)
  await waitFor(() => expect(mocks.api).toHaveBeenCalled())
  expect(screen.getByRole('button', { name: '领取奖励' })).toBeEnabled()
  expect(screen.queryByText('奖励已到账，可在背包查看。')).not.toBeInTheDocument()
})
