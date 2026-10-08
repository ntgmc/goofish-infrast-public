// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

function mockFrames() {
  let time = 0
  let id = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.set(++id, callback)
    return id
  })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => { callbacks.delete(frame) })
  return {
    callbacks, cancel,
    advance: (milliseconds: number) => {
      time += milliseconds
      const pending = [...callbacks.values()]
      callbacks.clear()
      act(() => { for (const callback of pending) callback(time) })
    },
  }
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

it('automatically shares and persists reduced motion after sustained stuttering and stops monitoring', () => {
  const frames = mockFrames()
  const page = mountSettings()
  expect(frames.callbacks.size).toBe(0)
  fireEvent.click(document.body)
  frames.advance(100)
  frames.advance(100)
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('full')
  frames.advance(100)
  expect(screen.getByRole('switch', { name: '减少动画' })).toBeChecked()
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('reduced')
  expect(document.documentElement).toHaveAttribute('data-reduced-motion')
  expect(window.localStorage.getItem(key)).toBe('true')
  fireEvent.scroll(document)
  expect(frames.callbacks.size).toBe(0)
  page.unmount()
  mountSettings()
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('reduced')
})

it('keeps smooth animations and isolated loading pauses, and bounds monitoring to interaction windows', () => {
  const frames = mockFrames()
  const page = mountSettings()
  fireEvent.animationStart(document.body)
  for (let index = 0; index < 70; index += 1) frames.advance(16)
  expect(frames.callbacks.size).toBe(0)
  expect(window.localStorage.getItem(key)).toBeNull()
  fireEvent.keyDown(document.body, { key: 'Enter' })
  frames.advance(600)
  for (let index = 0; index < 30; index += 1) frames.advance(16)
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('full')
  expect(frames.callbacks.size).toBe(0)
  fireEvent.scroll(document)
  expect(frames.callbacks.size).toBe(1)
  page.unmount()
  expect(frames.callbacks.size).toBe(0)
  expect(frames.cancel).toHaveBeenCalled()
  fireEvent.click(document.body)
  expect(frames.callbacks.size).toBe(0)
})

it('discards frames across backgrounding and starts a fresh window on the next visible interaction', () => {
  let visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
  const frames = mockFrames()
  mountSettings()
  fireEvent.scroll(document)
  frames.advance(100)
  frames.advance(100)
  visibility = 'hidden'
  fireEvent(document, new Event('visibilitychange'))
  expect(frames.callbacks.size).toBe(0)
  frames.advance(5000)
  fireEvent.click(document.body)
  expect(frames.callbacks.size).toBe(0)
  visibility = 'visible'
  fireEvent(document, new Event('visibilitychange'))
  fireEvent.click(document.body)
  frames.advance(100)
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('full')
  frames.advance(100)
  frames.advance(100)
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('reduced')
})

it('respects manually disabling automatic reduction for the rest of the visit', () => {
  const frames = mockFrames()
  mountSettings()
  fireEvent.click(document.body)
  for (let index = 0; index < 3; index += 1) frames.advance(100)
  fireEvent.click(screen.getByRole('switch', { name: '减少动画' }))
  fireEvent.scroll(document)
  for (let index = 0; index < 3; index += 1) frames.advance(100)
  expect(frames.callbacks.size).toBe(0)
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('full')
  expect(window.localStorage.getItem(key)).toBe('false')
})

it('still reduces animation automatically when browser storage is blocked', () => {
  const frames = mockFrames()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  mountSettings()
  fireEvent.scroll(document)
  for (let index = 0; index < 3; index += 1) frames.advance(100)
  expect(screen.getByLabelText('motion mode')).toHaveTextContent('reduced')
  expect(screen.getByText(/浏览器未能保存此设置/)).toHaveAttribute('role', 'status')
  expect(frames.callbacks.size).toBe(0)
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
