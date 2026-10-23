// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FeedbackButton from './FeedbackDialog'
import { MemoryRouter } from 'react-router'
import { FeedbackLink } from './PublicFooter'
import { copy } from '../copy'

const mocks = vi.hoisted(() => ({ api: vi.fn(), prepareImage: vi.fn() }))
vi.mock('../lib/api-client', () => ({ apiJson: mocks.api, getApiErrorMessage: (error: Error) => error.message }))
vi.mock('../lib/feedback-image', () => ({ prepareFeedbackImage: mocks.prepareImage }))
beforeEach(() => { vi.resetAllMocks() })
afterEach(cleanup)

it('preserves the draft after failure, submits the chosen category, and clears it only after success', async () => {
  const user = userEvent.setup()
  mocks.api.mockRejectedValueOnce(new Error('稍后重试')).mockResolvedValueOnce({ id: 'feedback' })
  render(<FeedbackButton />)
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  await user.selectOptions(screen.getByLabelText(copy.feedback.category), 'account')
  fireEvent.change(screen.getByLabelText(copy.feedback.message), { target: { value: '登录后出现问题' } })
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  expect(await screen.findByRole('alert')).toHaveTextContent('稍后重试')
  expect(screen.getByRole('alert')).toHaveFocus()
  expect(screen.getByLabelText(copy.feedback.message)).toHaveValue('登录后出现问题')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog', { name: copy.feedback.title })).toBeVisible()
  expect(screen.getByLabelText(copy.feedback.message)).toHaveValue('登录后出现问题')
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(copy.feedback.submitted))
  expect(mocks.api).toHaveBeenLastCalledWith('/api/user/feedback', expect.objectContaining({ method: 'POST', json: { category: 'account', message: '登录后出现问题' } }))
  expect(screen.getAllByRole('button', { name: copy.feedback.close })[0]).toHaveFocus()
  await user.click(screen.getAllByRole('button', { name: copy.feedback.close })[0])
  await waitFor(() => expect(screen.getByRole('button', { name: copy.feedback.title })).toHaveFocus())
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  expect(screen.getByLabelText(copy.feedback.message)).toHaveValue('')
})

it('opens website feedback and submits only the context the user chose to attach', async () => {
  mocks.api.mockResolvedValue({ id: 'feedback' })
  const user = userEvent.setup()
  render(<MemoryRouter><FeedbackButton profileId="profile-42" /><FeedbackLink /></MemoryRouter>)
  expect(screen.getByRole('link', { name: copy.feedback.submit })).toHaveAttribute('href', '/v2?feedback=new')
  await user.click(screen.getByRole('link', { name: copy.feedback.submit }))
  expect(screen.getByRole('dialog', { name: copy.feedback.title })).toBeVisible()
  await user.click(screen.getByLabelText(copy.feedback.attachProfile))
  fireEvent.change(screen.getByLabelText(copy.feedback.resultId), { target: { value: 'result-42' } })
  fireEvent.change(screen.getByLabelText(copy.feedback.jobId), { target: { value: 'job-42' } })
  fireEvent.change(screen.getByLabelText(copy.feedback.message), { target: { value: '这个结果存在问题' } })
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  await screen.findByText(copy.feedback.submitted)
  expect(mocks.api).toHaveBeenCalledWith('/api/user/feedback', expect.objectContaining({ json: { category: 'schedule', message: '这个结果存在问题', context: { profile_id: 'profile-42', result_id: 'result-42', job_id: 'job-42' } } }))
})

it('omits hidden schedule IDs after switching categories while keeping the chosen profile context', async () => {
  const user = userEvent.setup()
  mocks.api.mockResolvedValue({ id: 'feedback' })
  render(<FeedbackButton profileId="profile-42" />)
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  fireEvent.change(screen.getByLabelText(copy.feedback.resultId), { target: { value: 'result-42' } })
  fireEvent.change(screen.getByLabelText(copy.feedback.jobId), { target: { value: 'job-42' } })
  await user.click(screen.getByLabelText(copy.feedback.attachProfile))
  for (const category of ['account', 'import', 'payment', 'suggestion', 'other']) {
    await user.selectOptions(screen.getByLabelText(copy.feedback.category), category)
    expect(screen.queryByLabelText(copy.feedback.resultId)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(copy.feedback.jobId)).not.toBeInTheDocument()
  }
  await user.selectOptions(screen.getByLabelText(copy.feedback.category), 'schedule')
  expect(screen.getByLabelText(copy.feedback.resultId)).toHaveValue('result-42')
  expect(screen.getByLabelText(copy.feedback.jobId)).toHaveValue('job-42')
  await user.selectOptions(screen.getByLabelText(copy.feedback.category), 'account')
  fireEvent.change(screen.getByLabelText(copy.feedback.message), { target: { value: '登录遇到问题' } })
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  await screen.findByText(copy.feedback.submitted)
  expect(mocks.api).toHaveBeenCalledWith('/api/user/feedback', expect.objectContaining({ json: { category: 'account', message: '登录遇到问题', context: { profile_id: 'profile-42' } } }))
})

it('pastes screenshots through image validation, preserves attachments on failure, and leaves text paste intact', async () => {
  const user = userEvent.setup()
  const prepared = { image: { type: 'image/png', base64: 'cG5n' }, bytes: 3, compressed: false }
  let finish!: (value: typeof prepared) => void
  mocks.prepareImage.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    .mockRejectedValueOnce(new Error(copy.feedback.invalidImage))
  mocks.api.mockResolvedValue({ id: 'feedback' })
  render(<FeedbackButton />)
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  const message = screen.getByLabelText(copy.feedback.message)
  await user.click(message)
  await user.paste('从剪贴板补充问题')
  expect(message).toHaveValue('从剪贴板补充问题')
  expect(mocks.prepareImage).not.toHaveBeenCalled()
  const image = new File(['png'], '剪贴板截图.png', { type: 'image/png' })
  const clipboardData = { items: [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: image.type, getAsFile: () => image }] }
  expect(fireEvent.paste(message, { clipboardData })).toBe(false)
  expect(mocks.prepareImage).toHaveBeenCalledExactlyOnceWith(image)
  expect(screen.getByRole('button', { name: copy.feedback.submit })).toBeDisabled()
  fireEvent.paste(screen.getByRole('dialog'), { clipboardData })
  expect(mocks.prepareImage).toHaveBeenCalledTimes(1)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeVisible()
  finish(prepared)
  await waitFor(() => expect(screen.getByRole('button', { name: copy.feedback.replaceImage })).toHaveFocus())
  fireEvent.paste(screen.getByRole('dialog'), { clipboardData })
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.feedback.invalidImage)
  expect(screen.getByText(image.name)).toBeVisible()
  expect(message).toHaveValue('从剪贴板补充问题')
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  await screen.findByText(copy.feedback.submitted)
  expect(mocks.api).toHaveBeenCalledWith('/api/user/feedback', expect.objectContaining({ json: { category: 'schedule', message: '从剪贴板补充问题', image: prepared.image } }))
})

it('opens the saved feedback, keeps a failed follow-up draft, and blocks dismissal while sending', async () => {
  const id = '764b3769-09e4-4261-83b8-d23896419a8f'
  const item = { id, category: 'schedule', message: '原始问题', has_image: true, status: 'resolved', result: '已修复，请重试', revision: 2, created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' }
  let finish!: (value: unknown) => void
  let attempt = 0
  mocks.api.mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') {
      if (++attempt === 1) throw new Error('稍后重试')
      return new Promise((resolve) => { finish = resolve })
    }
    if (url.includes('feedback_id=')) return { feedback: item, entries: [{ revision: 2, actor: 'admin', message: '请补充操作步骤', previous_status: 'open', status: 'resolved', created_at: item.updated_at }], next_before_revision: null }
    return { items: [item], pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 } }
  })
  const user = userEvent.setup()
  render(<FeedbackButton />)
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  screen.getByRole('tab', { name: copy.feedback.newFeedback }).focus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: copy.feedback.myFeedback })).toHaveAttribute('aria-selected', 'true')
  await user.click(await screen.findByRole('button', { name: /原始问题/ }))
  await screen.findByText(item.result)
  const thumbnail = screen.getByRole('button', { name: copy.feedback.enlargeImage })
  expect(screen.getByRole('img', { name: copy.feedback.imagePreview })).toHaveAttribute('src', `/api/user/feedback?image_id=${id}`)
  await user.click(thumbnail)
  expect(screen.getByRole('dialog', { name: copy.feedback.imagePreview })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(thumbnail).toHaveFocus())
  expect(screen.getByRole('dialog', { name: copy.feedback.title })).toBeVisible()
  fireEvent.change(screen.getByLabelText(copy.feedback.reply), { target: { value: '问题仍然存在' } })
  await user.click(screen.getByRole('button', { name: copy.feedback.sendReply }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText(copy.feedback.reply)).toHaveValue('问题仍然存在')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByLabelText(copy.feedback.reply)).toHaveValue('问题仍然存在')
  await user.click(screen.getByRole('button', { name: copy.feedback.sendReply }))
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeVisible()
  finish({ id })
  await screen.findByText(copy.feedback.replySaved)
  expect(screen.getByLabelText(copy.feedback.reply)).toHaveValue('')
  const requests = mocks.api.mock.calls.filter((call) => call[1]?.method === 'PATCH')
  expect(requests[0]![1].json.request_key).toBe(requests[1]![1].json.request_key)
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('allows overlay dismissal while browsing the feedback list', async () => {
  mocks.api.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 } })
  const user = userEvent.setup()
  render(<FeedbackButton />)
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  await user.click(screen.getByRole('tab', { name: copy.feedback.myFeedback }))
  await screen.findByText(copy.feedback.myEmpty)
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('opens the referenced report from a notification even when its sidebar trigger is hidden', async () => {
  const id = '764b3769-09e4-4261-83b8-d23896419a8f'
  mocks.api.mockImplementation(async (url) => url.includes('feedback_id=')
    ? { feedback: { id, category: 'other', message: '通知中的反馈', status: 'processing', result: null, revision: 1, created_at: '2026-10-13T00:00:00Z' }, entries: [], next_before_revision: null }
    : { items: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 } })
  render(<div hidden><FeedbackButton /></div>)
  const trigger = screen.getByRole('button', { name: copy.feedback.title, hidden: true })
  fireEvent(trigger, new CustomEvent('goofish:open-feedback', { detail: id }))
  expect(await screen.findByText('通知中的反馈')).toBeVisible()
  expect(screen.getByRole('dialog')).toBeVisible()
})

it('focuses the category on opening, traps Tab inside the dialog, and restores the trigger on Escape', async () => {
  const user = userEvent.setup()
  render(<FeedbackButton iconOnly className="v2-help-link" />)
  const trigger = screen.getByRole('button', { name: copy.feedback.title })
  trigger.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.getByLabelText(copy.feedback.category)).toHaveFocus())
  await user.tab({ shift: true })
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it('keeps focus in the dialog while submitting and prevents dismissal until the request finishes', async () => {
  const user = userEvent.setup()
  let finish!: (value: unknown) => void
  mocks.api.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  render(<FeedbackButton />)
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  fireEvent.change(screen.getByLabelText(copy.feedback.message), { target: { value: '排班异常' } })
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  expect(screen.getByRole('dialog').querySelector('form')).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeVisible()
  finish({ id: 'feedback' })
  await waitFor(() => expect(screen.getAllByRole('button', { name: copy.feedback.close })[0]).toHaveFocus())
})

it('returns focus after image selection and removal, and focuses errors without discarding the existing image', async () => {
  const user = userEvent.setup()
  mocks.prepareImage.mockResolvedValueOnce({ image: { type: 'image/png', base64: 'cG5n' }, bytes: 3, compressed: false })
    .mockRejectedValueOnce(new Error(copy.feedback.invalidImage))
  render(<FeedbackButton />)
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  const input = screen.getByLabelText(copy.feedback.image)
  await user.upload(input, new File(['png'], '截图.png', { type: 'image/png' }))
  await waitFor(() => expect(screen.getByRole('button', { name: copy.feedback.replaceImage })).toHaveFocus())
  expect(screen.getByText('截图.png')).toBeVisible()
  await user.upload(input, new File(['invalid'], '损坏.png', { type: 'image/png' }))
  expect(await screen.findByRole('alert')).toHaveFocus()
  expect(screen.getByText('截图.png')).toBeVisible()
  await user.click(screen.getByRole('button', { name: copy.feedback.removeImage }))
  expect(screen.getByRole('button', { name: copy.feedback.chooseImage })).toHaveFocus()
  expect(screen.getByText(copy.feedback.pasteImageHint)).toBeVisible()
})
