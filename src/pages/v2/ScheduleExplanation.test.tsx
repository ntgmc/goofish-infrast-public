// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../copy'
import type { ScheduleExplanationState } from '../../lib/schedule-explanation'
import { DEFAULT_SITE_FEATURES } from '../../lib/site-features'
import type { OptimizeResult } from '../../lib/types'
import ScheduleExplanation from './ScheduleExplanation'

const mocks = vi.hoisted(() => ({ api: vi.fn(), features: vi.fn() }))
vi.mock('../../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: mocks.features() }) }))
vi.mock('../../lib/api-client', async (original) => ({ ...await original<object>(), apiJson: mocks.api,
  apiStream: async (url: string, options: unknown, consume: (response: Response) => Promise<unknown>) => {
    const value = await mocks.api(url, options)
    return value instanceof Response ? consume(value) : value
  },
}))
const text = copy.scheduleExplanation
const paragraph = (value: string) => (_text: string, element: Element | null) => element?.tagName === 'P' && element.textContent === value
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
  mocks.features.mockReturnValue({ ...DEFAULT_SITE_FEATURES, ai_schedule_explanation: true })
  mocks.api.mockReset().mockImplementation(async (_url: string, options: { method?: string }) => {
    if (options.method === 'POST') state = { ...state, available: false, explanation: { text: '第一段解读。\n\n第二段解读。', created_at: new Date().toISOString() } }
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
  expect(await screen.findByText(paragraph('第一段解读。'))).toBeVisible()
  expect(screen.getByText(paragraph('第二段解读。'))).toBeVisible()
  expect(screen.queryByRole('button', { name: text.generate })).not.toBeInTheDocument()
  mounted.unmount()
  render(mounted.tree('u1'))
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  expect(await screen.findByText(paragraph('第一段解读。'))).toBeVisible()
  expect(mocks.api.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1)
})

it.each(['quota', 'budget', 'disabled', 'daily_limit', 'busy'] as const)('explains %s without allowing a new charge', async (reason) => {
  state = { ...state, available: false, reason }
  mount()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  expect(await screen.findByText(text.reason[reason])).toBeVisible()
  expect(screen.queryByRole('button', { name: text.generate })).not.toBeInTheDocument()
})

it('hides the paused avatar by request and preserves view access when the avatar is kept', async () => {
  mocks.features.mockReturnValue({ ...DEFAULT_SITE_FEATURES, schedule_explanation_avatar: false })
  const mounted = mount()
  expect(screen.queryByRole('button', { name: text.title })).not.toBeInTheDocument()
  expect(mocks.api).not.toHaveBeenCalled()

  mocks.features.mockReturnValue({ ...DEFAULT_SITE_FEATURES })
  mounted.rerender(mounted.tree('u1'))
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  expect(await screen.findByText(text.reason.disabled)).toBeVisible()
  expect(screen.queryByRole('button', { name: text.generate })).not.toBeInTheDocument()

  mocks.features.mockReturnValue({ ...DEFAULT_SITE_FEATURES, schedule_explanation_avatar: false, ai_schedule_explanation: true })
  mounted.rerender(mounted.tree('u1'))
  expect(await screen.findByRole('button', { name: text.generate })).toBeVisible()
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
  expect(screen.getByRole('status')).toHaveTextContent(text.pending)
  expect(screen.queryByRole('button', { name: text.generate })).not.toBeInTheDocument()
  state = { ...state, available: false, explanation: { text: '收起后完成的解读', created_at: new Date().toISOString() } }
  await act(async () => finish(state))
  expect(await screen.findByText(paragraph('收起后完成的解读'))).toBeVisible()
  expect(mocks.api.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1)
})

it('renders streaming Markdown before settlement and preserves it across closing without resubmitting', async () => {
  const user = userEvent.setup()
  let producer!: ReadableStreamDefaultController<Uint8Array>
  mocks.api.mockImplementation(async (_url: string, options: { method?: string }) => options.method === 'POST'
    ? new Response(new ReadableStream({ start(controller) { producer = controller } }), { headers: { 'Content-Type': 'text/event-stream' } }) : state)
  mount()
  await user.click(screen.getByRole('button', { name: text.title }))
  await user.click(await screen.findByRole('button', { name: text.generate }))
  const emit = (event: unknown) => producer.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  await act(async () => emit({ type: 'delta', text: '**先看库存**\n\n- 核对赤金' }))
  await waitFor(() => expect(document.querySelector('.v2-explanation-body strong')).toHaveTextContent('先看库存'))
  expect(screen.getByRole('listitem')).toHaveTextContent('核对赤金')
  expect(screen.getByText(text.streaming)).toBeVisible()
  expect(screen.queryByText(text.saved)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.close }))
  await user.click(screen.getByRole('button', { name: text.title }))
  expect(document.querySelector('.v2-explanation-body strong')).toHaveTextContent('先看库存')
  state = { ...state, available: false, explanation: { text: '**先看库存**\n\n- 核对赤金\n- 再培养', created_at: new Date().toISOString() } }
  await act(async () => { emit({ type: 'state', state }); producer.close() })
  expect(await screen.findByText(/解读已保存/)).toBeVisible()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(mocks.api.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1)
})

it('recovers a disconnected stream by reading the saved result without keeping partial text or resubmitting', async () => {
  let producer!: ReadableStreamDefaultController<Uint8Array>
  mocks.api.mockImplementation(async (_url: string, options: { method?: string }) => options.method === 'POST'
    ? new Response(new ReadableStream({ start(controller) { producer = controller } }), { headers: { 'Content-Type': 'text/event-stream' } }) : state)
  mount()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  fireEvent.click(await screen.findByRole('button', { name: text.generate }))
  await waitFor(() => expect(producer).toBeDefined())
  await act(async () => producer.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"未完成的片段"}\n\n')))
  await waitFor(() => expect(document.querySelector('.v2-explanation-body')).toHaveTextContent('未完成的片段'))
  state = { ...state, available: false, explanation: { text: '**恢复的完整正文**', created_at: new Date().toISOString() } }
  await act(async () => producer.error(new Error('connection lost')))
  expect(await screen.findByText('恢复的完整正文')).toBeVisible()
  expect(screen.queryByText('未完成的片段')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(mocks.api.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1)
})

it('renders saved Markdown and safe links without executing HTML or loading images', async () => {
  state = { ...state, available: false, explanation: { text: '### 库存\n\n**赤金**与`培养`\n\n| 建议 | 下一步 |\n| --- | --- |\n| 一项 | 重排 |\n\n[资料](https://example.test/guide) [危险](javascript:alert%281%29)\n\n![图](https://example.test/tracker.png)\n\n<script>alert(1)</script>', created_at: new Date().toISOString() } }
  mount()
  fireEvent.click(screen.getByRole('button', { name: text.title }))
  expect(await screen.findByRole('heading', { name: '库存' })).toBeVisible()
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getByRole('link', { name: '资料' })).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.queryByRole('link', { name: '危险' })).not.toBeInTheDocument()
  const body = document.querySelector('.v2-explanation-body')!
  expect(body.querySelector('script, img')).toBeNull()
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
