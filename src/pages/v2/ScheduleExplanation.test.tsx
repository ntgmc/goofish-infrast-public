// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../copy'
import type { ScheduleExplanationState } from '../../lib/schedule-explanation'
import type { OptimizeResult } from '../../lib/types'
import ScheduleExplanation from './ScheduleExplanation'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../lib/api-client', () => ({ apiJson: mocks.api }))
const text = copy.scheduleExplanation
const report: OptimizeResult = { author: 'test', title: 'test', description: '', buildingType: 243, planTimes: '', plans: [], raw_results: [],
  daily_production: { trading: { LMD: 50000 }, manufacturing: { 'Battle Record': 30 } } }
const initial: ScheduleExplanationState = { explanation: null, pending: false, available: true, reason: null,
  quota: { kind: 'monthly', limit: 10, remaining: 10, resets_at: '2026-11-30T16:00:00.000Z' }, provider: '测试服务商' }
let state: ScheduleExplanationState
const clients: QueryClient[] = []
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false) })
  state = structuredClone(initial)
  mocks.api.mockReset().mockImplementation(async (_url: string, options: { method?: string }) => {
    if (options.method === 'POST') state = { ...state, available: false, explanation: { text: '第一段解读。\n第二段解读。', created_at: new Date().toISOString() } }
    return state
  })
})
afterEach(() => {
  cleanup(); for (const client of clients.splice(0)) client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture'); Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture')
})
function mount(userId = 'u1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30000 }, mutations: { retry: false } } })
  clients.push(client)
  const tree = (id: string) => <QueryClientProvider client={client}><ScheduleExplanation userId={id} profileId="p1" resultId="r1" sample={false} result={report} /></QueryClientProvider>
  return { ...render(tree(userId)), client, tree }
}

it('reads state without generating, then creates one answer only after an explicit click and reuses it', async () => {
  const mounted = mount()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  const generate = await screen.findByRole('button', { name: text.generate })
  expect(mocks.api.mock.calls.every((call) => call[1].method !== 'POST')).toBe(true)
  expect(screen.getByText(text.disclosure('测试服务商'))).toBeVisible()
  fireEvent.click(generate)
  expect(await screen.findByText('第一段解读。')).toBeVisible()
  expect(screen.getByText('第二段解读。')).toBeVisible()
  expect(screen.queryByRole('button', { name: text.generate })).not.toBeInTheDocument()
  mounted.unmount()
  render(mounted.tree('u1'))
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  expect(await screen.findByText('第一段解读。')).toBeVisible()
  expect(mocks.api.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1)
})

it.each(['quota', 'budget', 'disabled', 'daily_limit', 'busy'] as const)('explains %s without allowing a new charge', async (reason) => {
  state = { ...state, available: false, reason }
  mount()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  expect(await screen.findByText(text.reason[reason])).toBeVisible()
  expect(screen.queryByRole('button', { name: text.generate })).not.toBeInTheDocument()
})

it('recovers a failed generation by reading its status without automatically resubmitting', async () => {
  mocks.api.mockImplementation(async (_url: string, options: { method?: string }) => {
    if (options.method === 'POST') throw new Error('生成失败，未扣次数。')
    return state
  })
  mount()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  fireEvent.click(await screen.findByRole('button', { name: text.generate }))
  expect(await screen.findByRole('alert')).toHaveTextContent('未扣次数')
  fireEvent.click(screen.getByRole('button', { name: text.retry }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(mocks.api.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1)
})

it('shows a recoverable error for an incomplete API response', async () => {
  mocks.api.mockResolvedValue({})
  mount()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.failed)
  expect(screen.queryByRole('button', { name: text.generate })).not.toBeInTheDocument()
  mocks.api.mockResolvedValue(state)
  fireEvent.click(screen.getByRole('button', { name: text.retry }))
  expect(await screen.findByRole('button', { name: text.generate })).toBeVisible()
})

it('keeps an in-flight generation across closing and reopening without submitting again', async () => {
  const user = userEvent.setup()
  let finish!: (value: ScheduleExplanationState) => void
  mocks.api.mockImplementation(async (_url: string, options: { method?: string }) => options.method === 'POST'
    ? new Promise<ScheduleExplanationState>((resolve) => { finish = resolve }) : state)
  mount()
  await user.click(screen.getByRole('button', { name: text.title }))
  await user.click(await screen.findByRole('button', { name: text.generate }))
  await waitFor(() => expect(finish).toBeDefined())
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: text.title })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: text.title }))
  expect(screen.getByRole('button', { name: text.generating })).toBeDisabled()
  state = { ...state, available: false, explanation: { text: '收起后完成的解读', created_at: new Date().toISOString() } }
  await act(async () => finish(state))
  expect(await screen.findByText('收起后完成的解读')).toBeVisible()
  expect(mocks.api.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1)
})

it('moves the launcher and dialog together, clamps to the viewport, and keeps position after reopening', async () => {
  const user = userEvent.setup()
  vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue({ width: 1024 } as DOMRect)
  const workspace = document.createElement('main')
  workspace.className = 'v2-main'
  document.body.append(workspace)
  vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({ left: 216 } as DOMRect)
  mount()
  const launcher = screen.getByRole('button', { name: text.title })
  const group = launcher.parentElement!
  vi.spyOn(group, 'getBoundingClientRect').mockImplementation(() => ({
    right: 1024 - (Number.parseFloat(group.style.right) || 24), bottom: 768 - (Number.parseFloat(group.style.bottom) || 24),
    width: 400, height: 300,
  }) as DOMRect)
  launcher.focus()
  await user.keyboard('{ArrowLeft}')
  expect(group.style.right).toBe('48px')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(launcher)
  expect(group).toContainElement(screen.getByRole('dialog'))
  screen.getByRole('button', { name: text.moveHint }).focus()
  await user.keyboard('{ArrowLeft}{ArrowUp}')
  expect(group.style.right).toBe('72px')
  expect(group.style.bottom).toBe('48px')
  for (let index = 0; index < 30; index++) fireEvent.keyDown(screen.getByRole('button', { name: text.moveHint }), { key: 'ArrowLeft' })
  expect(group.style.right).toBe('400px')
  for (let index = 0; index < 30; index++) fireEvent.keyDown(screen.getByRole('button', { name: text.moveHint }), { key: 'ArrowRight' })
  expect(group.style.right).toBe('8px')
  await user.click(screen.getByRole('button', { name: text.close }))
  await user.click(launcher)
  expect(group.style.right).toBe('8px')
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
  workspace.remove()
})

it('opens the public sample in the same window without requesting an AI explanation', async () => {
  const user = userEvent.setup()
  render(<ScheduleExplanation sample result={report} />)
  expect(screen.queryByText(text.sampleAction)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.title }))
  expect(screen.getByRole('dialog', { name: text.title })).toBeVisible()
  expect(screen.getByRole('heading', { name: text.sampleTitle })).toBeVisible()
  expect(mocks.api).not.toHaveBeenCalled()
})

it('does not restore a prior account cache after switching identity during generation', async () => {
  let finish!: (value: ScheduleExplanationState) => void
  mocks.api.mockImplementation(async (_url: string, options: { method?: string }) => options.method === 'POST'
    ? new Promise<ScheduleExplanationState>((resolve) => { finish = resolve }) : state)
  const mounted = mount()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  fireEvent.click(await screen.findByRole('button', { name: text.generate }))
  await waitFor(() => expect(finish).toBeDefined())
  mounted.rerender(mounted.tree('u2'))
  mounted.client.removeQueries({ queryKey: ['user', 'u1'] })
  await act(async () => finish({ ...state, explanation: { text: '旧账号私密解读', created_at: new Date().toISOString() } }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  expect(screen.queryByText('旧账号私密解读')).not.toBeInTheDocument()
  expect(mounted.client.getQueriesData({ queryKey: ['user', 'u1'] })).toHaveLength(0)
})
