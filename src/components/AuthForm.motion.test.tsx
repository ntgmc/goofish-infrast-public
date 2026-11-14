// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '../test/query-render'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthForm from './AuthForm'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('../lib/motion-preference', () => ({ useAppReducedMotion: () => motion.reduced }))

const payload = { user: { id: 'doctor' }, profiles: [], active_profile: null, workspace: null }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mount() {
  const onAuthenticated = vi.fn()
  const view = render(<AuthForm animateActions onAuthenticated={onAuthenticated} />)
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'doctor@qq.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
  const submit = view.container.querySelector<HTMLButtonElement>('button[type="submit"]')!
  vi.useFakeTimers()
  return { ...view, submit, onAuthenticated }
}

async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function submit(button: HTMLButtonElement) {
  await act(async () => { fireEvent.click(button) })
}

afterEach(() => {
  cleanup()
  motion.reduced = false
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AuthForm action feedback', () => {
  it('waits for the loading and success feedback before authenticating, without duplicate submissions', async () => {
    const fetch = vi.fn().mockResolvedValue(response(payload))
    vi.stubGlobal('fetch', fetch)
    const view = mount()
    await submit(view.submit)
    expect(view.submit).toHaveAttribute('data-phase', 'loading')
    expect(screen.getByRole('button', { name: '注册' })).toBeDisabled()
    fireEvent.submit(view.submit.form!)
    expect(fetch).toHaveBeenCalledTimes(1)
    await tick(1199)
    expect(view.submit).toHaveAttribute('data-phase', 'loading')
    expect(view.onAuthenticated).not.toHaveBeenCalled()
    await tick(1)
    expect(view.submit).toHaveAttribute('data-phase', 'success')
    expect(view.submit).toHaveAttribute('aria-busy', 'false')
    await tick(999)
    expect(view.onAuthenticated).not.toHaveBeenCalled()
    await tick(1)
    expect(view.onAuthenticated).toHaveBeenCalledExactlyOnceWith(payload)
    expect(view.submit).toHaveAttribute('data-phase', 'idle')
    expect(view.submit).toBeEnabled()
  })

  it('keeps a slow request loading until the server succeeds', async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
    const view = mount()
    await submit(view.submit)
    await tick(3000)
    expect(view.submit).toHaveAttribute('data-phase', 'loading')
    expect(view.onAuthenticated).not.toHaveBeenCalled()
    await act(async () => { resolve(response(payload)) })
    await tick(0)
    expect(view.submit).toHaveAttribute('data-phase', 'success')
    await tick(1000)
    expect(view.onAuthenticated).toHaveBeenCalledExactlyOnceWith(payload)
  })

  it('shows error feedback before restoring the action and allows a successful retry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ error: '密码错误，请重试。' }, 401)).mockResolvedValueOnce(response(payload))
    vi.stubGlobal('fetch', fetch)
    const view = mount()
    await submit(view.submit)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(view.submit).toHaveAttribute('data-phase', 'loading')
    await tick(399)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await tick(1)
    expect(view.submit).toHaveAttribute('data-phase', 'error')
    expect(screen.getByRole('alert')).toHaveTextContent('密码错误')
    expect(view.submit).toHaveAttribute('aria-busy', 'false')
    expect(view.submit).toBeDisabled()
    await tick(999)
    expect(view.submit).toHaveAttribute('data-phase', 'error')
    await tick(1)
    expect(view.submit).toHaveAttribute('data-phase', 'idle')
    expect(view.submit).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('密码错误')
    expect(screen.getByLabelText('邮箱')).toHaveValue('doctor@qq.com')
    expect(screen.getByLabelText('密码')).toHaveValue('password123')
    expect(view.onAuthenticated).not.toHaveBeenCalled()
    await submit(view.submit)
    await tick(2200)
    expect(view.onAuthenticated).toHaveBeenCalledExactlyOnceWith(payload)
  })

  it('reveals a slow failure in the same update as the cross', async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
    const view = mount()
    await submit(view.submit)
    await tick(3000)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => { resolve(response({ error: '请求失败，请重试。' }, 503)) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(view.submit).toHaveAttribute('data-phase', 'loading')
    await tick(0)
    expect(view.submit).toHaveAttribute('data-phase', 'error')
    expect(screen.getByRole('alert')).toHaveTextContent('请求失败')
    expect(view.onAuthenticated).not.toHaveBeenCalled()
  })

  it.each([
    { code: 'email_domain_typo', field: '邮箱', suggested_email: 'doctor@163.com' },
    { code: 'invite_code_required', field: '邀请码（可选）' },
  ])('reveals the $code field error with the cross', async ({ code, field, ...extra }) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('registration-settings')
      ? response({ invite_code_required: false })
      : response({ error: '请修正注册信息。', code, ...extra }, 400)))
    const view = mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '注册' })) })
    await tick(0)
    const input = screen.getByLabelText(field)
    await submit(view.submit)
    await tick(399)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByRole('button', { name: /doctor@163.com/ })).not.toBeInTheDocument()
    await tick(1)
    expect(view.submit).toHaveAttribute('data-phase', 'error')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent === '请修正注册信息。')).toBe(true)
    if (code === 'email_domain_typo') expect(screen.getByRole('button', { name: /doctor@163.com/ })).toBeInTheDocument()
  })

  it('reveals verification recovery and resend failures with the active button cross', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ error: '请先验证邮箱。', code: 'email_not_verified' }, 403))
      .mockResolvedValueOnce(response({ error: '邮件发送失败，请重试。' }, 503)))
    const view = mount()
    await submit(view.submit)
    await tick(399)
    expect(screen.queryByRole('button', { name: '重新发送验证邮件' })).not.toBeInTheDocument()
    await tick(1)
    expect(view.submit).toHaveAttribute('data-phase', 'error')
    expect(screen.getByRole('alert')).toHaveTextContent('请先验证邮箱')
    const resend = screen.getByRole('button', { name: '重新发送验证邮件' })
    await tick(1000)
    await act(async () => { fireEvent.click(resend) })
    await tick(399)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(resend).toHaveAttribute('data-phase', 'loading')
    await tick(1)
    expect(resend).toHaveAttribute('data-phase', 'error')
    expect(view.submit).toHaveAttribute('data-phase', 'idle')
    expect(screen.getByRole('alert')).toHaveTextContent('邮件发送失败')
  })

  it('cancels the pending authentication transition when the form unmounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload)))
    const view = mount()
    await submit(view.submit)
    view.unmount()
    await tick(5000)
    expect(view.onAuthenticated).not.toHaveBeenCalled()
  })

  it('completes immediately when motion is reduced', async () => {
    motion.reduced = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload)))
    const view = mount()
    await submit(view.submit)
    expect(view.onAuthenticated).toHaveBeenCalledExactlyOnceWith(payload)
    expect(view.submit).toHaveAttribute('data-phase', 'idle')
  })

  it('shows errors immediately without animation when motion is reduced', async () => {
    motion.reduced = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: '密码错误，请重试。' }, 401)))
    const view = mount()
    await submit(view.submit)
    expect(view.submit).toHaveAttribute('data-phase', 'idle')
    expect(view.submit).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('密码错误')
    expect(view.onAuthenticated).not.toHaveBeenCalled()
  })

  it('keeps invalid input editable without starting a request or result animation', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const view = mount()
    const email = screen.getByLabelText('邮箱')
    fireEvent.change(email, { target: { value: 'invalid' } })
    await submit(view.submit)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(view.submit).toHaveAttribute('data-phase', 'idle')
    expect(view.submit).toBeEnabled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps registration signed out and animates only the active resend action', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('registration-settings')
      ? response({ invite_code_required: false })
      : response({ accepted: true, verification_required: true, message: '请按邮件提示完成注册。', resend_after_seconds: 1 }, 202)))
    const view = mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '注册' })) })
    await tick(0)
    await submit(view.submit)
    expect(screen.getByRole('status')).toHaveTextContent('请按邮件提示完成注册')
    await tick(2200)
    expect(view.onAuthenticated).not.toHaveBeenCalled()
    const resend = screen.getByRole('button', { name: '重新发送验证邮件' })
    await act(async () => { fireEvent.click(resend) })
    expect(resend).toHaveAttribute('data-phase', 'loading')
    expect(view.submit).toHaveAttribute('data-phase', 'idle')
    expect(view.submit).toBeDisabled()
    await tick(1200)
    expect(resend).toHaveAttribute('data-phase', 'success')
    await tick(1000)
    expect(resend).toHaveAttribute('data-phase', 'idle')
    expect(view.onAuthenticated).not.toHaveBeenCalled()
  })
})
