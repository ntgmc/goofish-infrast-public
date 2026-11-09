// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useListReveal } from './use-list-reveal'

const state = vi.hoisted(() => ({ reduced: false }))
vi.mock('./motion-preference', () => ({ useAppReducedMotion: () => state.reduced }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); state.reduced = false })

it('reveals recycled rows once, preserves virtual positioning and cancels immediately on focus or reduced motion', async () => {
  let enter: IntersectionObserverCallback
  const observe = vi.fn(), disconnect = vi.fn(), cancel = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { enter = callback }
    observe = observe
    unobserve() {}
    disconnect = disconnect
  })
  const animate = vi.fn(() => ({ cancel, onfinish: null }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  function List({ show = true, enabled = true }) {
    const ref = useListReveal(enabled)
    return <div ref={ref}>{show && <div data-reveal-id="one" style={{ transform: 'translateY(140px)' }}><div data-reveal-content><button>Skills</button></div></div>}</div>
  }
  const view = render(<List />)
  const row = view.container.querySelector('[data-reveal-id]')!
  act(() => enter([{ isIntersecting: true, target: row }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(animate.mock.instances[0]).toBe(row.firstElementChild)
  expect(row).toHaveStyle({ transform: 'translateY(140px)' })
  fireEvent.focusIn(view.getByRole('button'))
  expect(cancel).toHaveBeenCalledOnce()
  view.rerender(<List show={false} />)
  view.rerender(<List />)
  await waitFor(() => expect(view.getByRole('button')).toBeInTheDocument())
  expect(observe).toHaveBeenCalledTimes(1)
  state.reduced = true
  view.rerender(<List />)
  expect(disconnect).toHaveBeenCalled()
})

it('does not hide or animate search results, including after clearing the filter', () => {
  const observe = vi.fn()
  vi.stubGlobal('IntersectionObserver', class { observe = observe; unobserve() {}; disconnect() {} })
  function List({ enabled }: { enabled: boolean }) {
    const ref = useListReveal(enabled)
    return <div ref={ref}><button data-reveal-id="match">Match</button></div>
  }
  const view = render(<List enabled={false} />)
  expect(view.getByRole('button')).toBeVisible()
  view.rerender(<List enabled />)
  expect(observe).not.toHaveBeenCalled()
})
