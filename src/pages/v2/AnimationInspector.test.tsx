// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import AnimationInspector, { AnimationInspectorSetting } from './AnimationInspector'
import { copy } from '../../copy'

const mocks = vi.hoisted(() => ({ session: vi.fn(), observe: vi.fn(), stop: vi.fn() }))
vi.mock('../../lib/admin-api-client', () => ({ adminApiJson: mocks.session, ADMIN_SESSION_EXPIRED_EVENT: 'goofish:admin-session-expired' }))
vi.mock('./animation-inspector', () => ({ observePageAnimations: mocks.observe, createAnimationPreview: vi.fn() }))
beforeEach(() => { localStorage.clear(); mocks.observe.mockReturnValue(mocks.stop) })
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks() })
const view = (userId: string | null = 'user-a') => <MemoryRouter><AnimationInspector userId={userId}><AnimationInspectorSetting /></AnimationInspector></MemoryRouter>
const key = (userId: string) => `maatool-animation-inspector:${userId}`

it.each([null, {}, { username: '' }, { username: 123 }])('starts no recorder for an unconfirmed administrator (%s)', async (user) => {
  localStorage.setItem(key('user-a'), 'true')
  mocks.session.mockResolvedValue({ user })
  render(view())
  await waitFor(() => expect(mocks.session).toHaveBeenCalledWith('/api/admin/session'))
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(mocks.observe).not.toHaveBeenCalled()
})

it('defaults off after admin login and starts and stops immediately through the user setting', async () => {
  mocks.session.mockResolvedValue({ user: { username: 'admin' } })
  render(view())
  const toggle = await screen.findByRole('switch', { name: copy.v2.animationInspector.enable })
  expect(toggle).not.toBeChecked()
  expect(mocks.observe).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  expect(toggle).toBeChecked()
  expect(localStorage.getItem(key('user-a'))).toBe('true')
  expect(mocks.observe).toHaveBeenCalledTimes(1)
  fireEvent.click(toggle)
  expect(localStorage.getItem(key('user-a'))).toBe('false')
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('isolates saved preferences and stops recording when the website user changes', async () => {
  mocks.session.mockResolvedValue({ user: { username: 'admin' } })
  const { rerender } = render(view())
  fireEvent.click(await screen.findByRole('switch'))
  rerender(view('user-b'))
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  expect(await screen.findByRole('switch')).not.toBeChecked()
  expect(mocks.observe).toHaveBeenCalledTimes(1)
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key('user-a'), newValue: 'true' })))
  expect(screen.getByRole('switch')).not.toBeChecked()
  rerender(view())
  expect(await screen.findByRole('switch')).toBeChecked()
  expect(mocks.observe).toHaveBeenCalledTimes(2)
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key('user-a'), newValue: 'false' })))
  expect(screen.getByRole('switch')).not.toBeChecked()
  expect(mocks.stop).toHaveBeenCalledTimes(2)
  rerender(view(null))
  await waitFor(() => expect(mocks.session).toHaveBeenCalledTimes(4))
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('allows immediate shutdown even when the browser cannot save the preference', async () => {
  mocks.session.mockResolvedValue({ user: { username: 'admin' } })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  render(view())
  const toggle = await screen.findByRole('switch')
  fireEvent.click(toggle)
  expect(screen.getByRole('status')).toHaveTextContent(copy.dashboard.animation.storageError)
  expect(mocks.observe).toHaveBeenCalledTimes(1)
  fireEvent.click(toggle)
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('starts only after server confirmation and tears down the recorder when the administrator session expires', async () => {
  localStorage.setItem(key('user-a'), 'true')
  let confirm!: (value: unknown) => void
  mocks.session.mockReturnValue(new Promise((resolve) => { confirm = resolve }))
  render(view())
  expect(mocks.observe).not.toHaveBeenCalled()
  await act(async () => confirm({ user: { username: 'admin' } }))
  expect(screen.getByRole('complementary', { name: copy.v2.animationInspector.title })).toBeInTheDocument()
  expect(mocks.observe).toHaveBeenCalledTimes(1)
  act(() => window.dispatchEvent(new Event('goofish:admin-session-expired')))
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('ignores a confirmation that arrives after an explicit session expiration', async () => {
  localStorage.setItem(key('user-a'), 'true')
  let confirm!: (value: unknown) => void
  mocks.session.mockReturnValue(new Promise((resolve) => { confirm = resolve }))
  render(view())
  act(() => window.dispatchEvent(new Event('goofish:admin-session-expired')))
  await act(async () => confirm({ user: { username: 'admin' } }))
  expect(mocks.observe).not.toHaveBeenCalled()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})
