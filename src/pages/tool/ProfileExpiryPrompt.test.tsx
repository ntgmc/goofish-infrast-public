// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserGameAccount } from '../../lib/types'
import ProfileExpiryPrompt from './ProfileExpiryPrompt'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-02T04:00:00.000Z')

beforeEach(() => {
  window.localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function createProfile(overrides: Partial<UserGameAccount> = {}): UserGameAccount {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    kind: 'cdk',
    permission: 'advanced',
    status: 'active',
    expires_at: new Date(NOW + 2 * DAY_MS).toISOString(),
    cdk_order_hash: null,
    display_name: '测试档案',
    note: '',
    operator_count: 1,
    updated_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('ProfileExpiryPrompt', () => {
  it('shows the expiry in Beijing time and opens the matching profile export page', () => {
    const profile = createProfile({ expires_at: new Date(NOW + 3 * DAY_MS).toISOString() })
    const onOpenExport = vi.fn()
    render(<ProfileExpiryPrompt userId="user-1" profiles={[profile]} onOpenExport={onOpenExport} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('测试档案')
    expect(screen.getByRole('dialog')).toHaveTextContent('2026/10/05 12:00')
    expect(screen.getByRole('dialog')).toHaveTextContent('排班 JSON 导出到本地')
    fireEvent.click(screen.getByRole('button', { name: '前往保存与导出' }))
    expect(onOpenExport).toHaveBeenCalledWith(profile)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each<Partial<UserGameAccount>>([
    { expires_at: null },
    { expires_at: 'invalid' },
    { expires_at: new Date(NOW).toISOString() },
    { expires_at: new Date(NOW - 1).toISOString() },
    { expires_at: new Date(NOW + 3 * DAY_MS + 1).toISOString() },
    { kind: 'free_preview' },
    { status: 'frozen' },
    { status: 'revoked' },
    { archived_at: '2026-10-01T00:00:00.000Z' },
  ])('skips profiles that are not active limited CDKs nearing expiry: %j', (overrides) => {
    render(<ProfileExpiryPrompt userId="user-1" profiles={[createProfile(overrides)]} onOpenExport={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('also reminds for limited CDK trials using their end time and describes the return to free preview', () => {
    const profile = createProfile({
      kind: 'free_preview',
      expires_at: null,
      trial: {
        id: 'trial-1',
        starts_at: '2026-10-01T00:00:00.000Z',
        ends_at: new Date(NOW + DAY_MS).toISOString(),
        active: true,
        effective_permission: 'advanced',
      },
    })
    const props = { userId: 'user-1', onOpenExport: vi.fn() }
    const view = render(<ProfileExpiryPrompt {...props} profiles={[profile]} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('2026/10/03 12:00')
    expect(screen.getByRole('dialog')).toHaveTextContent('之后恢复免费预览权限')
    view.rerender(<ProfileExpiryPrompt {...props} profiles={[{ ...profile, trial: { ...profile.trial!, active: false } }]} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('persists dismissal for the Beijing calendar day and reminds again after midnight', () => {
    const profile = createProfile()
    const props = { userId: 'user-1', profiles: [profile], onOpenExport: vi.fn() }
    render(<ProfileExpiryPrompt {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '今天不再提醒' }))
    cleanup()
    render(<ProfileExpiryPrompt {...props} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.setSystemTime('2026-10-02T16:00:00.000Z')
    fireEvent.focus(window)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps dismissal separate for each account, profile, and renewed expiry', () => {
    const profile = createProfile()
    const onOpenExport = vi.fn()
    const view = render(<ProfileExpiryPrompt userId="user-1" profiles={[profile]} onOpenExport={onOpenExport} />)
    fireEvent.click(screen.getByRole('button', { name: '今天不再提醒' }))
    view.rerender(<ProfileExpiryPrompt userId="user-2" profiles={[profile]} onOpenExport={onOpenExport} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '今天不再提醒' }))
    view.rerender(<ProfileExpiryPrompt userId="user-1" profiles={[createProfile({ id: 'profile-2' })]} onOpenExport={onOpenExport} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '今天不再提醒' }))
    view.rerender(<ProfileExpiryPrompt userId="user-1" profiles={[createProfile({ expires_at: new Date(NOW + 3 * DAY_MS).toISOString() })]} onOpenExport={onOpenExport} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    view.rerender(<ProfileExpiryPrompt userId="user-1" profiles={[createProfile({ expires_at: new Date(NOW + 10 * DAY_MS).toISOString() })]} onOpenExport={onOpenExport} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('checks the reminder window while the page stays open and prioritizes the earliest expiry', () => {
    const profiles = [
      createProfile({ id: 'later', display_name: '稍后到期', expires_at: new Date(NOW + 3 * DAY_MS + 120_000).toISOString() }),
      createProfile({ id: 'earlier', display_name: '先到期', expires_at: new Date(NOW + 3 * DAY_MS + 60_000).toISOString() }),
    ]
    render(<ProfileExpiryPrompt userId="user-1" profiles={profiles} onOpenExport={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(screen.getByRole('dialog')).toHaveTextContent('先到期')
    fireEvent.click(screen.getByRole('button', { name: '今天不再提醒' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('稍后到期')
  })

  it('waits for an existing modal to close before reminding', async () => {
    const blocker = document.createElement('dialog')
    blocker.setAttribute('open', '')
    document.body.append(blocker)
    try {
      render(<ProfileExpiryPrompt userId="user-1" profiles={[createProfile()]} onOpenExport={vi.fn()} />)
      expect(screen.queryByText('限时 CDK 档案即将到期')).not.toBeInTheDocument()
      blocker.removeAttribute('open')
      await waitFor(() => expect(screen.getByText('限时 CDK 档案即将到期')).toBeInTheDocument())
    } finally {
      blocker.remove()
    }
  })

  it('can dismiss reminders when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked') })
    render(<ProfileExpiryPrompt userId="user-1" profiles={[createProfile()]} onOpenExport={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭到期提醒' }))
    fireEvent.focus(window)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
