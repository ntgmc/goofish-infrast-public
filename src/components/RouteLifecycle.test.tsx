// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import RouteLifecycle from './RouteLifecycle'

const scrollToMock = vi.fn()

beforeEach(() => {
  scrollToMock.mockReset()
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollToMock })
  Object.defineProperty(window, 'scrollX', { configurable: true, writable: true, value: 0 })
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 })
  Object.defineProperty(window.history, 'scrollRestoration', { configurable: true, writable: true, value: 'auto' })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 1
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RouteLifecycle', () => {
  it('scrolls pushes to the top and restores each history entry on back and forward', async () => {
    const router = createMemoryRouter([
      { path: '*', element: <LifecycleHarness /> },
    ], { initialEntries: ['/first'] })

    render(<RouterProvider router={router} />)
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
    expect(window.history.scrollRestoration).toBe('manual')

    window.scrollX = 12
    window.scrollY = 340
    await act(async () => router.navigate('/second'))
    expect(scrollToMock).toHaveBeenLastCalledWith(0, 0)
    expect(screen.getByRole('main')).toHaveTextContent('/second')
    expect(screen.getByRole('main')).toHaveFocus()

    window.scrollX = 0
    window.scrollY = 80
    await act(async () => router.navigate(-1))
    expect(scrollToMock).toHaveBeenLastCalledWith(12, 340)
    expect(screen.getByRole('main')).toHaveTextContent('/first')

    await act(async () => router.navigate(1))
    expect(scrollToMock).toHaveBeenLastCalledWith(0, 80)
    expect(screen.getByRole('main')).toHaveTextContent('/second')
  })

  it('focuses a route target that mounts after the route lifecycle effect', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '*', element: <DelayedFocusHarness /> },
    ], { initialEntries: ['/lazy'] })

    render(<RouterProvider router={router} />)
    await user.click(screen.getByRole('button', { name: '挂载页面' }))
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
  })
})

function LifecycleHarness() {
  const location = useLocation()
  return (
    <>
      <RouteLifecycle />
      <main tabIndex={-1} data-route-focus>{location.pathname}</main>
    </>
  )
}

function DelayedFocusHarness() {
  const [ready, setReady] = useState(false)
  return (
    <>
      <RouteLifecycle />
      <button type="button" onClick={() => setReady(true)}>挂载页面</button>
      {ready && <main tabIndex={-1} data-route-focus>懒加载页面</main>}
    </>
  )
}
