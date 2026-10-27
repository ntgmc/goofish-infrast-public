// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '../test/private-query-render'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { AdminQueryScope, UserQueryScope } from './private-query-scope'
import { useFeedbackThread } from './use-feedback-thread'
import type { FeedbackDetail } from './feedback-contracts'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('./api-client', () => ({ apiJson: mocks.api, getApiErrorMessage: (error: Error) => error.message }))
vi.mock('./admin-api-client', () => ({ adminApiJson: mocks.api }))
const detail = (id: string, revision = 0): FeedbackDetail => ({ feedback: { id, category: 'other', message: '问题', has_image: false, status: 'open', result: null, revision, created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' }, entries: [], next_before_revision: null })
beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

it('aborts old detail requests and prevents late responses from replacing the selected feedback', async () => {
  let finish!: (value: FeedbackDetail) => void
  mocks.api.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce(detail('second'))
  const hook = renderHook(({ id }) => useFeedbackThread('user', id, true), { initialProps: { id: 'first' } })
  const oldSignal = mocks.api.mock.calls[0]![1].signal as AbortSignal
  hook.rerender({ id: 'second' })
  await waitFor(() => expect(hook.result.current.data?.feedback.id).toBe('second'))
  expect(oldSignal.aborted).toBe(true)
  await act(async () => finish(detail('first')))
  expect(hook.result.current.data?.feedback.id).toBe('second')
})

it('reuses a request key after a network failure and retries against the current revision after explicit refresh', async () => {
  let storedRevision = 2
  let fail = true
  mocks.api.mockImplementation(async (_url, init) => {
    if (init?.method === 'PATCH') {
      if (fail) throw new Error('网络中断')
      storedRevision++
      return { id: 'feedback' }
    }
    return detail('feedback', storedRevision)
  })
  const hook = renderHook(() => useFeedbackThread('admin', 'feedback', true))
  await waitFor(() => expect(hook.result.current.data?.feedback.revision).toBe(2))
  await act(async () => { expect(await hook.result.current.save({ message: '处理说明' })).toBe(false) })
  await act(async () => { expect(await hook.result.current.save({ message: '处理说明' })).toBe(false) })
  const writes = () => mocks.api.mock.calls.filter((call) => call[1]?.method === 'PATCH')
  expect(writes()[0]![1].json.request_key).toBe(writes()[1]![1].json.request_key)
  storedRevision = 3
  await act(async () => hook.result.current.refresh())
  await waitFor(() => expect(hook.result.current.data?.feedback.revision).toBe(3))
  fail = false
  await act(async () => { expect(await hook.result.current.save({ message: '处理说明' })).toBe(true) })
  expect(writes()[2]![1].json).toMatchObject({ expected_revision: 3 })
  expect(writes()[2]![1].json.request_key).toBe(writes()[0]![1].json.request_key)
  await waitFor(() => expect(hook.result.current.data?.feedback.revision).toBe(4))
})

it('retains the unknown-result request key across leaving and reopening the same thread', async () => {
  let finish!: (value: unknown) => void
  let writes = 0
  mocks.api.mockImplementation((_url, init) => init?.method === 'PATCH' && ++writes === 1 ? new Promise((resolve) => { finish = resolve }) : Promise.resolve(detail('feedback', 2)))
  const hook = renderHook(({ active }) => useFeedbackThread('admin', 'feedback', active), { initialProps: { active: true } })
  await waitFor(() => expect(hook.result.current.data?.feedback.revision).toBe(2))
  let first!: Promise<boolean>
  act(() => { first = hook.result.current.save({ message: '回复' }) })
  hook.rerender({ active: false })
  await act(async () => { finish({}); expect(await first).toBe(false) })
  hook.rerender({ active: true })
  await waitFor(() => expect(hook.result.current.data?.feedback.revision).toBe(2))
  await act(async () => { expect(await hook.result.current.save({ message: '回复' })).toBe(true) })
  const requests = mocks.api.mock.calls.filter((call) => call[1]?.method === 'PATCH')
  expect(requests).toHaveLength(2)
  expect(requests[1][1].json.request_key).toBe(requests[0][1].json.request_key)
})

it('does not read or write a selected thread before the user identity is confirmed', async () => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(UserQueryScope.Provider, { value: null }, children)
  const hook = renderHook(() => useFeedbackThread('user', 'feedback', true), { wrapper })
  await act(async () => {
    await hook.result.current.refresh()
    await hook.result.current.loadOlder()
    expect(await hook.result.current.save({ message: '回复' })).toBe(false)
  })
  expect(mocks.api).not.toHaveBeenCalled()
})

it('does not repeat a successful reply when the following read fails', async () => {
  let written = false
  mocks.api.mockImplementation(async (_url, init) => {
    if (init?.method === 'PATCH') { written = true; return {} }
    if (written) throw new Error('刷新失败')
    return detail('feedback', 2)
  })
  const hook = renderHook(() => useFeedbackThread('user', 'feedback', true))
  await waitFor(() => expect(hook.result.current.data?.feedback.revision).toBe(2))
  await act(async () => { expect(await hook.result.current.save({ message: '回复' })).toBe(true) })
  await waitFor(() => expect(hook.result.current.error).toBe('刷新失败'))
  expect(hook.result.current.data?.feedback.revision).toBe(2)
  await act(async () => hook.result.current.refresh())
  expect(mocks.api.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(1)
})

it('isolates permission snapshots and cancels a reply when administrator permissions change', async () => {
  let finish!: (value: unknown) => void
  let capabilities: ('user_view' | 'user_manage')[] = ['user_view', 'user_manage']
  mocks.api.mockImplementation((_url, init) => init?.method === 'PATCH' ? new Promise((resolve) => { finish = resolve }) : Promise.resolve(detail('feedback', capabilities.length)))
  const wrapper = ({ children }: { children: ReactNode }) => createElement(AdminQueryScope.Provider, { value: { username: 'alice', capabilities, active: true } }, children)
  const hook = renderHook(() => useFeedbackThread('admin', 'feedback', true), { wrapper })
  await waitFor(() => expect(hook.result.current.data?.feedback.revision).toBe(2))
  let write!: Promise<boolean>
  act(() => { write = hook.result.current.save({ message: '回复' }) })
  const signal = mocks.api.mock.calls.find((call) => call[1]?.method === 'PATCH')![1].signal as AbortSignal
  capabilities = ['user_view']
  hook.rerender()
  expect(hook.result.current.data).toBeNull()
  expect(signal.aborted).toBe(true)
  await act(async () => { finish({}); expect(await write).toBe(false) })
  await waitFor(() => expect(hook.result.current.data?.feedback.revision).toBe(1))
})

it('aborts an in-flight write when the target changes without overwriting the new thread', async () => {
  let finish!: (value: unknown) => void
  mocks.api.mockImplementation((url, init) => init?.method === 'PATCH'
    ? new Promise((resolve) => { finish = resolve })
    : Promise.resolve(detail(url.includes('second') ? 'second' : 'first')))
  const hook = renderHook(({ id }) => useFeedbackThread('user', id, true), { initialProps: { id: 'first' } })
  await waitFor(() => expect(hook.result.current.data).not.toBeNull())
  let write!: Promise<boolean>
  act(() => { write = hook.result.current.save({ message: '补充' }) })
  const signal = mocks.api.mock.calls.find((call) => call[1]?.method === 'PATCH')![1].signal as AbortSignal
  hook.rerender({ id: 'second' })
  await waitFor(() => expect(hook.result.current.data?.feedback.id).toBe('second'))
  expect(signal.aborted).toBe(true)
  await act(async () => { finish({ id: 'first' }); expect(await write).toBe(false) })
  expect(hook.result.current.data?.feedback.id).toBe('second')
  expect(hook.result.current.saving).toBe(false)
})
