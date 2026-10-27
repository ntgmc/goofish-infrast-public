// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '../../../test/private-query-render'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import type { AdminFeedback, FeedbackDetail } from '../../../lib/feedback-contracts'
import FeedbackSection from './FeedbackSection'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: mocks.api }))
const feedback: AdminFeedback = { id: '764b3769-09e4-4261-83b8-d23896419a8f', user_id: 'user', email: 'user@example.com', assignee: null, category: 'schedule', message: '排班结果异常', status: 'processing', result: null, revision: 0, has_image: false, created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' }
beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

it('preserves drafts on a conflict and uses the refreshed revision for an audited public outcome', async () => {
  let revision = 0
  let conflicts = true
  mocks.api.mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') {
      if (conflicts) throw new Error(copy.feedback.conflict)
      return { id: feedback.id }
    }
    if (url.includes('feedback_id=')) return { feedback: { ...feedback, revision }, entries: [], next_before_revision: null } satisfies FeedbackDetail
    return { items: [feedback], pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 } }
  })
  const user = userEvent.setup()
  render(<MemoryRouter><FeedbackSection active canManage /></MemoryRouter>)
  expect(screen.getByLabelText(copy.feedback.status)).toHaveValue('')
  await user.click(await screen.findByRole('button', { name: /user@example.com/ }))
  await screen.findByLabelText(copy.feedback.publicReply)
  await user.selectOptions(screen.getAllByLabelText(copy.feedback.status)[1]!, 'resolved')
  fireEvent.change(screen.getByLabelText(copy.feedback.publicReply), { target: { value: '已修复，请重新生成。' } })
  fireEvent.change(screen.getByLabelText(copy.feedback.internalNote), { target: { value: '关联任务 42' } })
  fireEvent.change(screen.getByLabelText(copy.feedback.reason), { target: { value: '修复完成' } })
  await user.click(screen.getByRole('button', { name: copy.feedback.save }))
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.feedback.conflict)
  expect(screen.getByLabelText(copy.feedback.publicReply)).toHaveValue('已修复，请重新生成。')
  expect(screen.getByLabelText(copy.feedback.internalNote)).toHaveValue('关联任务 42')
  revision = 1
  const requestsBeforeRefresh = mocks.api.mock.calls.length
  await user.click(screen.getByRole('button', { name: copy.feedback.refresh }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  const refreshedUrls = mocks.api.mock.calls.slice(requestsBeforeRefresh).map(([url]) => url)
  expect(refreshedUrls).toContain('/api/admin/feedback?page=1&page_size=25')
  expect(refreshedUrls).toContain(`/api/admin/feedback?feedback_id=${feedback.id}`)
  expect(screen.getByLabelText(copy.feedback.publicReply)).toHaveValue('已修复，请重新生成。')
  expect(screen.getByLabelText(copy.feedback.internalNote)).toHaveValue('关联任务 42')
  conflicts = false
  await user.click(screen.getByRole('button', { name: copy.feedback.save }))
  await screen.findByText(copy.feedback.saved)
  const calls = mocks.api.mock.calls.filter((call) => call[1]?.method === 'PATCH')
  expect(calls[1]![1].json).toMatchObject({ expected_revision: 1, status: 'resolved', message: '已修复，请重新生成。', internal_note: '关联任务 42', reason: '修复完成' })
  expect(screen.getByLabelText(copy.feedback.publicReply)).toHaveValue('')
})

it('lets viewers inspect follow-up records without mutation controls', async () => {
  mocks.api.mockImplementation(async (url) => url.includes('feedback_id=')
    ? { feedback, entries: [{ revision: 1, actor: 'admin', actor_username: 'operator', message: null, internal_note: '排查情况', status: 'processing', previous_status: 'processing', assignee: null, previous_assignee: null, created_at: feedback.created_at }], next_before_revision: null }
    : { items: [feedback], pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 } })
  const user = userEvent.setup()
  render(<MemoryRouter><FeedbackSection active /></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: /user@example.com/ }))
  await screen.findByText('排查情况')
  expect(screen.queryByLabelText(copy.feedback.publicReply)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.feedback.save })).not.toBeInTheDocument()
})

it('combines quick filters, opens related records, and persists a selected operation with the feedback revision', async () => {
  const operation = { source: 'inventory' as const, id: feedback.id, action: 'grant_item', reason: '补发缺少的道具', created_at: feedback.created_at }
  mocks.api.mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') return { id: feedback.id }
    if (url.includes('feedback_id=')) return { feedback: { ...feedback, context: { profile_id: 'profile-42', job_id: 'job-42' } }, entries: [], next_before_revision: null, recent_operations: [operation] }
    return { items: [feedback], pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 }, metrics: { first_response_seconds: 7200, longest_wait_seconds: 86400, reopened_count: 3 } }
  })
  const user = userEvent.setup()
  render(<MemoryRouter><FeedbackSection active canManage canViewUser canViewTasks /></MemoryRouter>)
  await screen.findByText('2 小时 0 分钟')
  await user.click(screen.getByRole('button', { name: copy.feedback.todos.mine }))
  await user.selectOptions(screen.getByLabelText(copy.feedback.category), 'payment')
  fireEvent.change(screen.getByLabelText(copy.feedback.emailFilter), { target: { value: 'user@example.com' } })
  await user.selectOptions(screen.getByLabelText(copy.feedback.waitFilter), '24')
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/feedback?page=1&page_size=25&todo=mine&category=payment&email=user%40example.com&min_wait_hours=24', expect.anything()))
  await user.click(await screen.findByRole('button', { name: /user@example.com/ }))
  expect(await screen.findByRole('link', { name: copy.feedback.openUser })).toHaveAttribute('href', '/admin/users?user_id=user')
  expect(screen.getByRole('link', { name: copy.feedback.openProfile })).toHaveAttribute('href', '/admin/users?user_id=user&profile_id=profile-42')
  expect(screen.getByRole('link', { name: copy.feedback.openJobs })).toHaveAttribute('href', '/admin/queue?query=job-42&job_id=job-42')
  await user.selectOptions(screen.getByLabelText(copy.feedback.relatedOperation), `inventory:${operation.id}`)
  fireEvent.change(screen.getByLabelText(copy.feedback.reason), { target: { value: '记录补发操作' } })
  await user.click(screen.getByRole('button', { name: copy.feedback.save }))
  await screen.findByText(copy.feedback.saved)
  expect(mocks.api).toHaveBeenCalledWith('/api/admin/feedback', expect.objectContaining({ method: 'PATCH', json: expect.objectContaining({ expected_revision: 0, related_operation: { source: 'inventory', id: operation.id } }) }))
})
