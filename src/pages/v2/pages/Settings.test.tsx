// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { cleanup, render, screen, within } from '../../../test/query-render'
import type { V2Session } from '../OptionsDrawer'
import Settings from './Settings'

vi.mock('../../../components/QqBotSettingsPanel', () => ({ default: () => null }))
vi.mock('../../../lib/admin-api-client', () => ({
  adminApiJson: vi.fn(async () => ({ user: null })),
  ADMIN_SESSION_EXPIRED_EVENT: 'goofish:admin-session-expired',
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openDeletion() {
  const user = userEvent.setup()
  const router = createMemoryRouter([
    { path: '/v2', element: <Settings session={{ profiles: [], activeProfile: null, applyAuthPayload: vi.fn() } as unknown as V2Session} /> },
    { path: '/account-safety', element: <main>注销申请已受理</main> },
  ], { initialEntries: ['/v2?section=settings'] })
  render(<RouterProvider router={router} />)
  await user.click(screen.getByRole('button', { name: '数据与隐私' }))
  await user.click(screen.getByText('注销账号'))
  const button = screen.getByRole('button', { name: '申请注销账号' })
  const form = within(button.closest('form')!)
  await user.type(form.getByLabelText('确认邮箱'), 'doctor@qq.com')
  await user.type(form.getByLabelText('当前密码'), 'valid-password')
  return { user, router, button, form }
}

it('requires a reason and submits the survey with credentials before leaving settings', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ scheduled_for: '2026-11-13T12:00:00Z' }), { status: 202, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { user, router, button, form } = await openDeletion()
  expect(button).toBeDisabled()
  await user.selectOptions(form.getByLabelText('注销原因（必选）'), 'results_unsatisfactory')
  await user.type(form.getByLabelText('补充说明（选填，最多 500 字）'), '  希望排班更容易调整  ')
  await user.click(button)
  expect(await screen.findByText('注销申请已受理')).toBeInTheDocument()
  const [, options] = fetchMock.mock.calls[0]
  expect(JSON.parse(options.body)).toEqual({
    email: 'doctor@qq.com', password: 'valid-password', reason: 'results_unsatisfactory', reason_detail: '希望排班更容易调整',
  })
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('原邮箱无法再次注册'))
  expect(router.state.historyAction).toBe('REPLACE')
})

it('keeps answers and credentials when submission fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '服务暂时不可用' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { user, button, form } = await openDeletion()
  await user.selectOptions(form.getByLabelText('注销原因（必选）'), 'privacy')
  const detail = form.getByLabelText('补充说明（选填，最多 500 字）')
  expect(detail).toHaveAttribute('maxlength', '500')
  await user.type(detail, '希望减少数据留存')
  await user.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用')
  expect(form.getByLabelText('注销原因（必选）')).toHaveValue('privacy')
  expect(detail).toHaveValue('希望减少数据留存')
  expect(form.getByLabelText('当前密码')).toHaveValue('valid-password')
  expect(button).toBeEnabled()
})

it('preserves the form and sends nothing when final confirmation is cancelled', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { user, button, form } = await openDeletion()
  await user.selectOptions(form.getByLabelText('注销原因（必选）'), 'prefer_not_to_say')
  await user.click(button)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(form.getByLabelText('注销原因（必选）')).toHaveValue('prefer_not_to_say')
  expect(button).toBeEnabled()
})
