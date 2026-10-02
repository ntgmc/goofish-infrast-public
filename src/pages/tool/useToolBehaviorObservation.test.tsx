// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readToolBehaviorEvents, recordToolBehavior } from '../../lib/tool-behavior-observation'
import { useToolBehaviorObservation } from './useToolBehaviorObservation'

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Harness({ userId }: { userId: string | null }) {
  const location = useLocation()
  const navigate = useNavigate()
  useToolBehaviorObservation(userId, new URLSearchParams(location.search).get('profile_id'))
  return <button onClick={() => navigate('/tool/optimize/result?profile_id=profile-a&token=sensitive')}>查看结果</button>
}

describe('tool route observations', () => {
  it('measures visible intervals across navigation, pagehide, and unmount without counting hidden time or StrictMode cleanup', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    render(<StrictMode><MemoryRouter initialEntries={['/tool/profiles']}><Harness userId="user-a" /></MemoryRouter></StrictMode>)
    expect(readToolBehaviorEvents('user-a')).toEqual([])
    clock.mockReturnValue(now + 1000)
    await user.click(screen.getByRole('button', { name: '查看结果' }))
    clock.mockReturnValue(now + 2000)
    visibility.mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    clock.mockReturnValue(now + 15000)
    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    clock.mockReturnValue(now + 17000)
    act(() => window.dispatchEvent(new Event('pagehide')))
    act(() => window.dispatchEvent(new Event('pagehide')))
    clock.mockReturnValue(now + 18000)
    act(() => window.dispatchEvent(new Event('pageshow')))
    clock.mockReturnValue(now + 20000)
    cleanup()
    const events = readToolBehaviorEvents('user-a')
    expect(events.map((event) => [event.page, event.duration_ms])).toEqual([
      ['dashboard.profiles', 1000], ['optimize.result', 1000], ['optimize.result', 2000], ['optimize.result', 2000],
    ])
    expect(new Set(events.map((event) => event.session)).size).toBe(1)
    expect(JSON.stringify(events)).not.toContain('sensitive')
  })

  it('separates users and stops observing after logout', () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const tree = (userId: string | null) => <MemoryRouter><Harness userId={userId} /></MemoryRouter>
    render(tree('user-a'))
    // The unknown public path is outside the tool observation scope.
    expect(recordToolBehavior({ name: 'config_save' })).toBe(false)
    cleanup()
    const routedTree = (userId: string | null) => <MemoryRouter initialEntries={['/tool/profiles']}><Harness userId={userId} /></MemoryRouter>
    const view = render(routedTree('user-a'))
    clock.mockReturnValue(now + 1000)
    view.rerender(routedTree('user-b'))
    recordToolBehavior({ name: 'config_save' })
    clock.mockReturnValue(now + 2000)
    view.rerender(routedTree(null))
    expect(recordToolBehavior({ name: 'config_save' })).toBe(false)
    expect(readToolBehaviorEvents('user-a')).toHaveLength(1)
    expect(readToolBehaviorEvents('user-b')).toHaveLength(2)
    expect(readToolBehaviorEvents('user-a')[0].session).not.toBe(readToolBehaviorEvents('user-b')[0].session)
    cleanup()
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('Unavailable') })
    render(routedTree('user-c'))
    expect(screen.getByRole('button', { name: '查看结果' })).toBeInTheDocument()
    expect(recordToolBehavior({ name: 'config_save' })).toBe(false)
  })
})
