// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../test/query-render'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../copy'
import { authPath, rememberAuthReturn } from '../../lib/auth-navigation'
import { MotionPreferenceProvider } from '../../lib/motion-preference'
import { TaskDraftProvider, useTaskDraft } from '../../lib/task-drafts'
import AuthPage from './AuthPage'

const user = { id: 'user-1', email: 'doctor@qq.com' }
const payload = { user, profiles: [], active_profile: null, workspace: null }
let signedIn: boolean
let reads: number
let loginFails: boolean
const fetchMock = vi.fn()

beforeEach(() => {
  signedIn = false
  reads = 0
  loginFails = false
  localStorage.setItem('maatool-reduce-motion', 'true')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  fetchMock.mockReset().mockImplementation(async (input: string) => {
    if (input === '/api/auth/me') { reads++; return Response.json(signedIn ? payload : { user: null }) }
    if (input === '/api/auth/registration-settings') return Response.json({ invite_code_required: false })
    if (input === '/api/auth/login') {
      if (loginFails) return Response.json({ error: '邮箱或密码错误。' }, { status: 401 })
      signedIn = true
      return Response.json(payload)
    }
    if (input === '/api/auth/register') return Response.json({ accepted: true, verification_required: true, message: '请验证邮箱。', resend_after_seconds: 60 }, { status: 202 })
    throw new Error(`Unexpected request: ${input}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

function Tool() {
  const [draft, setDraft] = useTaskDraft('depot:upload', '')
  return <main><h1>原任务</h1><textarea aria-label="仓库 JSON" value={draft} onChange={(event) => setDraft(event.target.value)} /><Link to={authPath('login', '/v2?section=depot&source=skland#data')}>前往登录</Link></main>
}
function mount(path: string) {
  const router = createMemoryRouter([
    { path: '/login', element: <AuthPage /> }, { path: '/register', element: <AuthPage /> }, { path: '/forgot-password', element: <AuthPage /> },
    { path: '/v2', element: <Tool /> },
  ], { initialEntries: [path] })
  render(<TaskDraftProvider><MotionPreferenceProvider><RouterProvider router={router} /></MotionPreferenceProvider></TaskDraftProvider>)
  return router
}
async function fillLogin() {
  fireEvent.change(await screen.findByLabelText(copy.auth.components_AuthForm_011), { target: { value: user.email } })
  fireEvent.change(screen.getByLabelText(copy.auth.components_AuthForm_012), { target: { value: 'password123' } })
  fireEvent.click(document.querySelector('button[type="submit"]')!)
}

it('returns to the exact task with its draft and never submits the task during authentication', async () => {
  const router = mount('/v2?section=depot&source=skland#data')
  fireEvent.change(screen.getByLabelText('仓库 JSON'), { target: { value: '{"items":[]}' } })
  fireEvent.click(screen.getByRole('link', { name: '前往登录' }))
  await fillLogin()
  expect(await screen.findByRole('heading', { name: '原任务' })).toBeVisible()
  expect(router.state.location.pathname + router.state.location.search + router.state.location.hash).toBe('/v2?section=depot&source=skland#data')
  expect(screen.getByLabelText('仓库 JSON')).toHaveValue('{"items":[]}')
  expect(fetchMock.mock.calls.filter(([path]) => path !== '/api/auth/me' && path !== '/api/auth/login')).toHaveLength(0)
})

it('keeps the destination and email when switching registration to login', async () => {
  const router = mount(authPath('register', '/v2?section=add-account&mode=cdk', '12AB34CD5E6F7G8H'))
  fireEvent.change(await screen.findByLabelText(copy.auth.components_AuthForm_011), { target: { value: user.email } })
  expect(await screen.findByLabelText(copy.auth.components_AuthForm_015)).toHaveValue('12AB34CD5E6F7G8H')
  fireEvent.click(within(screen.getByRole('group', { name: copy.auth.components_AuthForm_007 })).getByRole('button', { name: copy.auth.components_AuthForm_008 }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(screen.getByLabelText(copy.auth.components_AuthForm_011)).toHaveValue(user.email)
  expect(new URLSearchParams(router.state.location.search).get('return_to')).toBe('/v2?section=add-account&mode=cdk')
})

it('collapses an optional invite and still accepts a manually entered code', async () => {
  mount('/register')
  expect(await screen.findByRole('button', { name: copy.auth.optionalInvitation })).toBeVisible()
  expect(screen.queryByLabelText(copy.auth.components_AuthForm_015)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: copy.auth.optionalInvitation }))
  expect(screen.getByLabelText(copy.auth.components_AuthForm_015)).toBeVisible()
})

it('retains credentials after a rejected login and allows a retry', async () => {
  loginFails = true
  const router = mount('/login')
  await fillLogin()
  expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误。')
  expect(router.state.location.pathname).toBe('/login')
  expect(screen.getByLabelText(copy.auth.components_AuthForm_011)).toHaveValue(user.email)
  loginFails = false
  fireEvent.click(document.querySelector('button[type="submit"]')!)
  expect(await screen.findByRole('heading', { name: '原任务' })).toBeVisible()
})

it('recognizes verification in another tab when the registration tab becomes active', async () => {
  const router = mount(authPath('register', '/v2?section=generation'))
  await screen.findByLabelText(copy.auth.components_AuthForm_011)
  signedIn = true
  fireEvent(window, new Event('focus'))
  expect(await screen.findByRole('heading', { name: '原任务' })).toBeVisible()
  expect(reads).toBe(2)
  expect(router.state.location.search).toBe('?section=generation')
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/auth/login')).toBe(false)
})

it('retries a failed session check without treating a service error as logged out', async () => {
  fetchMock.mockRejectedValueOnce(new Error('Network request failed.'))
  mount('/login')
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.v2.loginServiceUnavailable)
  expect(screen.queryByLabelText(copy.auth.components_AuthForm_012)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.v2.loginRetry }))
  expect(await screen.findByLabelText(copy.auth.components_AuthForm_012)).toBeVisible()
})

it('allows an existing session to request a password reset', async () => {
  signedIn = true
  const router = mount('/forgot-password')
  expect(await screen.findByRole('heading', { level: 1, name: copy.auth.forgotTitle })).toBeVisible()
  expect(screen.getByLabelText(copy.auth.components_AuthForm_011)).toBeVisible()
  expect(router.state.location.pathname).toBe('/forgot-password')
})

it.each(['/login', '/register'])('redirects an existing session from %s and ignores stale or external destinations', async (path) => {
  signedIn = true
  rememberAuthReturn('/v2?section=inventory')
  const router = mount(`${path}?return_to=https://outside.test`)
  expect(await screen.findByRole('heading', { name: '原任务' })).toBeVisible()
  expect(router.state.location.pathname + router.state.location.search).toBe('/v2')
})
