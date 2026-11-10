// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import AnimationInspector from './AnimationInspector'
import { copy } from '../../copy'

const mocks = vi.hoisted(() => ({ session: vi.fn(), observe: vi.fn(), stop: vi.fn() }))
vi.mock('../../lib/admin-api-client', () => ({ adminApiJson: mocks.session, ADMIN_SESSION_EXPIRED_EVENT: 'goofish:admin-session-expired' }))
vi.mock('./animation-inspector', () => ({ observePageAnimations: mocks.observe, createAnimationPreview: vi.fn() }))
beforeEach(() => { mocks.observe.mockReturnValue(mocks.stop) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it.each([null, {}, { username: '' }, { username: 123 }])('starts no recorder for an unconfirmed administrator (%s)', async (user) => {
  mocks.session.mockResolvedValue({ user })
  render(<MemoryRouter><AnimationInspector /></MemoryRouter>)
  await waitFor(() => expect(mocks.session).toHaveBeenCalledWith('/api/admin/session'))
  expect(screen.queryByRole('complementary', { name: copy.v2.animationInspector.title })).not.toBeInTheDocument()
  expect(mocks.observe).not.toHaveBeenCalled()
})

it('starts only after server confirmation and tears down the recorder when the administrator session expires', async () => {
  let confirm!: (value: unknown) => void
  mocks.session.mockReturnValue(new Promise((resolve) => { confirm = resolve }))
  render(<MemoryRouter><AnimationInspector /></MemoryRouter>)
  expect(mocks.observe).not.toHaveBeenCalled()
  await act(async () => confirm({ user: { username: 'admin' } }))
  expect(screen.getByRole('complementary', { name: copy.v2.animationInspector.title })).toBeInTheDocument()
  expect(mocks.observe).toHaveBeenCalledTimes(1)
  act(() => window.dispatchEvent(new Event('goofish:admin-session-expired')))
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('ignores a confirmation that arrives after an explicit session expiration', async () => {
  let confirm!: (value: unknown) => void
  mocks.session.mockReturnValue(new Promise((resolve) => { confirm = resolve }))
  render(<MemoryRouter><AnimationInspector /></MemoryRouter>)
  act(() => window.dispatchEvent(new Event('goofish:admin-session-expired')))
  await act(async () => confirm({ user: { username: 'admin' } }))
  expect(mocks.observe).not.toHaveBeenCalled()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})
