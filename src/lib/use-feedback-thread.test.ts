// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
  fail = false
  await act(async () => { expect(await hook.result.current.save({ message: '处理说明' })).toBe(true) })
  expect(writes()[2]![1].json).toMatchObject({ expected_revision: 3 })
  expect(writes()[2]![1].json.request_key).toBe(writes()[0]![1].json.request_key)
  expect(hook.result.current.data?.feedback.revision).toBe(4)
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
