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
  expect(row).toHaveAttribute('data-reveal-pending')
  act(() => enter([{ isIntersecting: true, target: row }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(animate.mock.instances[0]).toBe(row.firstElementChild)
  expect(row).not.toHaveAttribute('data-reveal-pending')
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

it.each(['drawer', 'self'] as const)('uses the %s scroll viewport for staggered cards and skips large jumps', (root) => {
  let enter: IntersectionObserverCallback
  let observerRoot: Element | Document | null | undefined
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { enter = callback; observerRoot = options?.root }
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: vi.fn(), onfinish: null }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  function Cards() {
    const ref = useListReveal(true, 50, root === 'self' ? 'self' : undefined)
    return <div className="v2-drawer-body"><div ref={ref}>{['one', 'two', 'three'].map((id) => <div key={id} data-reveal-id={id}>{id}</div>)}</div></div>
  }
  const view = render(<Cards />)
  const drawer = view.container.firstElementChild!
  const scroll = root === 'self' ? drawer.firstElementChild! : drawer
  expect(observerRoot).toBe(scroll)
  Object.defineProperty(drawer, 'clientHeight', { value: 600, configurable: true })
  Object.defineProperty(scroll, 'clientHeight', { value: root === 'self' ? 208 : 600, configurable: true })
  const rows = [...view.container.querySelectorAll('[data-reveal-id]')]
  scroll.scrollTop = 100
  fireEvent.scroll(scroll)
  act(() => enter(rows.slice(0, 2).map((target) => ({ target, isIntersecting: true })) as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(animate).toHaveBeenCalledTimes(2)
  expect(animate.mock.calls[1][1]).toMatchObject({ duration: 240, delay: 50 })
  scroll.scrollTop = root === 'self' ? 300 : 1100
  fireEvent.scroll(scroll)
  act(() => enter([{ target: rows[2], isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(animate).toHaveBeenCalledTimes(2)
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
