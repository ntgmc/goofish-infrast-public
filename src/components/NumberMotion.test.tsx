// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CountUp, RollingValue } from './NumberMotion'

const state = vi.hoisted(() => ({ reduced: false, stop: vi.fn(), update: undefined as ((value: number) => void) | undefined }))
vi.mock('../lib/motion-preference', () => ({ useAppReducedMotion: () => state.reduced }))
vi.mock('motion/react', async (original) => ({ ...await original<typeof import('motion/react')>(), animate: vi.fn((_from, _to, options) => { state.update = options.onUpdate; return { stop: state.stop } }) }))

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); state.reduced = false; state.update = undefined })

it('keeps the accessible result stable and stops counting immediately when animations are reduced', () => {
  let enter: IntersectionObserverCallback
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { enter = callback }
    observe() {}
    disconnect = disconnect
  })
  const view = render(<CountUp value={2.08} digits={2} />)
  const visual = view.container.querySelector('[aria-hidden]')!
  act(() => { enter([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver); state.update?.(1.25) })
  expect(visual).toHaveTextContent('1.25')
  expect(view.container.querySelector('.sr-only')).toHaveTextContent('2.08')
  state.reduced = true
  view.rerender(<CountUp value={2.08} digits={2} />)
  expect(state.stop).toHaveBeenCalledOnce()
  expect(visual).toHaveTextContent('2.08')
  expect(disconnect).toHaveBeenCalled()
})

it('preserves configured price text and renders final numbers without an observer or animation', () => {
  state.reduced = true
  const view = render(<><RollingValue value="6.45 元" /><CountUp value={16.7} digits={1} /></>)
  expect(view.container.querySelector('[aria-label="6.45 元"]')).toHaveTextContent('6.45 元')
  expect(view.container.querySelector('.number-motion-count .sr-only')).toHaveTextContent('16.7')
  expect(state.update).toBeUndefined()
})
