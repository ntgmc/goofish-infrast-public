// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FeedbackButton from './FeedbackDialog'
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
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(copy.feedback.submitted))
  expect(mocks.api).toHaveBeenLastCalledWith('/api/user/feedback', expect.objectContaining({ method: 'POST', json: { category: 'account', message: '登录后出现问题' } }))
  expect(screen.getAllByRole('button', { name: copy.feedback.close })[0]).toHaveFocus()
  await user.click(screen.getAllByRole('button', { name: copy.feedback.close })[0])
  await waitFor(() => expect(screen.getByRole('button', { name: copy.feedback.title })).toHaveFocus())
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  expect(screen.getByLabelText(copy.feedback.message)).toHaveValue('')
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
  expect(screen.getByText(copy.feedback.noImage)).toBeVisible()
})
