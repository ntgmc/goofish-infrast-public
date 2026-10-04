// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AnimationSettings from '../components/AnimationSettings'
import SettingsSection from '../pages/tool/dashboard/SettingsSection'
import { MotionPreferenceProvider, useAppReducedMotion } from './motion-preference'

const key = 'maatool-reduce-motion'

beforeEach(() => window.localStorage.removeItem(key))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.removeItem(key)
})

function Probe() {
  const reduced = useAppReducedMotion()
  return <output aria-label="motion mode">{reduced ? 'reduced' : 'full'}</output>
}

function mountSettings() {
  return render(<MotionPreferenceProvider>
    <SettingsSection profiles={[]} onLogout={vi.fn()} onPayload={vi.fn()} />
    <Probe />
  </MotionPreferenceProvider>)
}

it('shares and persists the account setting across mounted settings controls and page reloads', async () => {
  const user = userEvent.setup()
  const first = mountSettings()
  expect(screen.getByRole('switch', { name: '减少动画' })).not.toBeChecked()
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('full')
  await user.click(screen.getByRole('switch', { name: '减少动画' }))
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('reduced')
  expect(document.documentElement).toHaveAttribute('data-reduced-motion')
  expect(window.localStorage.getItem(key)).toBe('true')
  first.unmount()

  render(<MotionPreferenceProvider><AnimationSettings /><Probe /></MotionPreferenceProvider>)
  expect(screen.getByRole('switch', { name: '减少动画' })).toBeChecked()
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('reduced')
  await user.click(screen.getByRole('switch', { name: '减少动画' }))
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('full')
  expect(document.documentElement).not.toHaveAttribute('data-reduced-motion')
  expect(window.localStorage.getItem(key)).toBe('false')
})

it('reacts to system motion changes without replacing the saved browser preference', async () => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: false,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', () => query)
  const page = mountSettings()
  const toggle = screen.getByRole('switch', { name: '减少动画' })
  act(() => {
    query.matches = true
    for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent)
  })
  expect(toggle).toBeChecked()
  expect(toggle).toBeDisabled()
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('reduced')
  expect(window.localStorage.getItem(key)).toBeNull()
  act(() => {
    query.matches = false
    for (const listener of listeners) listener({ matches: false } as MediaQueryListEvent)
  })
  expect(toggle).not.toBeChecked()
  expect(toggle).not.toBeDisabled()
  expect(document.documentElement).not.toHaveAttribute('data-reduced-motion')
  page.unmount()
  expect(listeners.size).toBe(0)
})

it('keeps the preference usable and reports failed persistence when browser storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const user = userEvent.setup()
  mountSettings()
  await user.click(screen.getByRole('switch', { name: '减少动画' }))
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('reduced')
  expect(screen.getByText(/浏览器未能保存此设置/)).toHaveAttribute('role', 'status')
  await user.click(screen.getByRole('switch', { name: '减少动画' }))
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('full')
})
