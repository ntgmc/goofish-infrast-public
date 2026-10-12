// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import FeedbackButton from './FeedbackDialog'
import { copy } from '../copy'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api-client', () => ({ apiJson: mocks.api, getApiErrorMessage: (error: Error) => error.message }))
beforeEach(() => { vi.clearAllMocks() })

it('preserves the draft after failure, submits the chosen category, and clears it only after success', async () => {
  const user = userEvent.setup()
  mocks.api.mockRejectedValueOnce(new Error('稍后重试')).mockResolvedValueOnce({ id: 'feedback' })
  render(<FeedbackButton />)
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  await user.selectOptions(screen.getByLabelText(copy.feedback.category), 'account')
  fireEvent.change(screen.getByLabelText(copy.feedback.message), { target: { value: '登录后出现问题' } })
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  expect(await screen.findByRole('alert')).toHaveTextContent('稍后重试')
  expect(screen.getByLabelText(copy.feedback.message)).toHaveValue('登录后出现问题')
  await user.click(screen.getByRole('button', { name: copy.feedback.submit }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(copy.feedback.submitted))
  expect(mocks.api).toHaveBeenLastCalledWith('/api/user/feedback', expect.objectContaining({ method: 'POST', json: { category: 'account', message: '登录后出现问题' } }))
  await user.click(screen.getAllByRole('button', { name: copy.feedback.close })[0])
  await user.click(screen.getByRole('button', { name: copy.feedback.title }))
  expect(screen.getByLabelText(copy.feedback.message)).toHaveValue('')
})
