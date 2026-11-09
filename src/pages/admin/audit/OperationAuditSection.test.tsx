// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '../../../test/private-query-render'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdminAuditDetail, AdminAuditRecord } from '../../../lib/admin-audit-contracts'
import OperationAuditSection from './OperationAuditSection'

const api = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: api }))
const record: AdminAuditRecord = { source: 'admin', id: 'audit-1', actor_username: 'operator', action: 'user.freeze_account', target_type: 'user', target_id: 'user-1', reason: '核对工单后冻结', request_id: 'request-1', created_at: '2026-11-08T00:00:00Z' }
const other: AdminAuditRecord = { ...record, source: 'inventory', id: 'audit-2', action: 'grant_item', reason: '补发道具' }
const detail: AdminAuditDetail = { ...record, client_ip: null, before_json: { status: 'active', limits: { count: 2 } }, after_json: { status: 'frozen', limits: { count: 0 } }, context_json: null }
const page = (items = [record], total = items.length, current = 1) => ({ items, pagination: { page: current, page_size: 25, total, total_pages: Math.ceil(total / 25) } })
beforeEach(() => {
  api.mockReset().mockImplementation(async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams
    if (params.has('source')) return { item: params.get('id') === record.id ? detail : { ...detail, ...other, before_json: null, after_json: null } }
    if (params.has('related_source')) return page(params.get('related_id') === record.id ? [other] : [])
    return page()
  })
})
afterEach(cleanup)

it('submits all filters together, resets pagination and keeps draft edits out of the request until submission', async () => {
  render(<OperationAuditSection />)
  await screen.findByText(record.reason)
  fireEvent.change(screen.getByLabelText('管理员账号'), { target: { value: 'operator' } })
  fireEvent.change(screen.getByLabelText('动作'), { target: { value: 'user.freeze_account' } })
  fireEvent.change(screen.getByLabelText('对象类型'), { target: { value: 'user' } })
  fireEvent.change(screen.getByLabelText('对象 ID'), { target: { value: 'user-1' } })
  fireEvent.change(screen.getByLabelText('请求 ID'), { target: { value: 'request-1' } })
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-11-01T12:00' } })
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-11-08T12:00' } })
  expect(api).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2))
  const params = new URL(api.mock.calls[1][0], 'http://localhost').searchParams
  expect(Object.fromEntries(params)).toMatchObject({ actor: 'operator', action: record.action, target_type: 'user', target_id: 'user-1', request_id: 'request-1', page: '1', page_size: '25', from: new Date('2026-11-01T12:00').toISOString(), to: new Date('2026-11-08T12:00').toISOString() })
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-11-09T12:00' } })
  fireEvent.click(screen.getByRole('button', { name: '查询' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('开始时间不能晚于结束时间')
  expect(api).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '重置' }))
  expect(screen.getByLabelText('管理员账号')).toHaveValue('')
})

it('loads details on demand, shows field differences and follows related records with the correct source', async () => {
  render(<OperationAuditSection />)
  const opener = await screen.findByRole('button', { name: '查看详情' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog')
  const changes = await within(dialog).findByRole('region', { name: '变更差异' })
  expect(within(changes).getByText('$["limits"]["count"]')).toBeInTheDocument()
  expect(within(changes).getByText('0')).toBeInTheDocument()
  expect(within(changes).getByText('"frozen"')).toBeInTheDocument()
  expect(within(dialog).getByText('request-1')).toBeInTheDocument()
  const related = within(dialog).getByRole('region', { name: '关联记录' })
  fireEvent.click(await within(related).findByRole('button', { name: /grant_item/ }))
  await within(dialog).findByText('此记录未保存变更前后快照。')
  expect(within(dialog).queryByText('"frozen"')).not.toBeInTheDocument()
  expect(api.mock.calls.some(([url]) => url.includes('source=inventory&id=audit-2'))).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(opener).toHaveFocus()
})

it('does not show the previous page on a failed page read and retries the requested page', async () => {
  let fail = true
  api.mockImplementation(async (url: string) => {
    const current = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    if (current === 2 && fail) throw new Error('审计查询暂不可用')
    return page(current === 2 ? [other] : [record], 26, current)
  })
  render(<OperationAuditSection />)
  fireEvent.click(await screen.findByRole('button', { name: '下一页' }))
  await screen.findByText('审计查询暂不可用')
  expect(screen.queryByText(record.reason)).not.toBeInTheDocument()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByText(other.reason)
  expect(screen.getByText('共 26 条 · 第 2/2 页')).toBeInTheDocument()
})

it('cancels an unobserved detail read when the dialog closes', async () => {
  let signal: AbortSignal | undefined
  let resolve!: (value: unknown) => void
  api.mockImplementation((url: string, options: { signal: AbortSignal }) => {
    if (new URL(url, 'http://localhost').searchParams.has('source')) {
      signal = options.signal
      return new Promise((done) => { resolve = done })
    }
    return Promise.resolve(page())
  })
  render(<OperationAuditSection />)
  fireEvent.click(await screen.findByRole('button', { name: '查看详情' }))
  await screen.findByText('正在加载详情…')
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(signal?.aborted).toBe(true))
  await act(async () => { resolve({ item: detail }) })
  expect(screen.queryByText('"frozen"')).not.toBeInTheDocument()
})
