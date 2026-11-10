// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { observePageAnimations } from './animation-inspector'

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

it('records short native effects without changing their player and restores instrumentation on departure', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  class Effect {
    target: Element
    constructor(target: Element) { this.target = target }
    getComputedTiming() { return { duration: 40 } }
    getTiming() { return { duration: 40, iterations: Infinity } }
    getKeyframes() { return [{ computedOffset: 0, opacity: 0 }, { computedOffset: 1, opacity: 1 }] }
  }
  vi.stubGlobal('KeyframeEffect', Effect)
  vi.stubGlobal('CSSAnimation', class {})
  vi.stubGlobal('CSSTransition', class {})
  const source = document.createElement('button')
  source.textContent = 'Keep my real operation'
  source.id = 'real-operation'
  const click = vi.fn()
  source.addEventListener('click', click)
  document.body.append(source)
  const player = { effect: new Effect(source), play: vi.fn(), cancel: vi.fn() }
  const original = vi.fn(() => player)
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: original })
  const capture = vi.fn()
  const stop = observePageAnimations(capture, vi.fn())
  try {
    expect(source.animate([{ opacity: 0 }, { opacity: 1 }], 40)).toBe(player)
    expect(capture).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    const record = capture.mock.calls[0][0]
    expect(record.snapshot.node).not.toBe(source)
    expect(record.snapshot.node.id).not.toBe(source.id)
    expect(record.timing.iterations).toBe(1)
    record.snapshot.node.click()
    expect(click).not.toHaveBeenCalled()
    expect(player.play).not.toHaveBeenCalled()
    expect(player.cancel).not.toHaveBeenCalled()
    expect(source.id).toBe('real-operation')
    const pseudoPlayer = { effect: Object.assign(new Effect(source), { pseudoElement: '::after' }) }
    const getAnimations = vi.fn((options?: GetAnimationsOptions) => options?.subtree ? [pseudoPlayer] : [])
    Object.defineProperty(source, 'getAnimations', { value: getAnimations })
    source.dispatchEvent(new Event('animationstart', { bubbles: true }))
    expect(getAnimations).toHaveBeenCalledWith({ subtree: true })
    vi.advanceTimersByTime(16)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(capture.mock.calls[1][0].timing.pseudoElement).toBe('::after')
    const large = document.createElement('div')
    large.append(...Array.from({ length: 600 }, () => document.createElement('span')))
    document.body.append(large)
    original.mockImplementation(function (this: Element) { return { ...player, effect: new Effect(this) } })
    const computedStyle = window.getComputedStyle.bind(window)
    const styles = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => pseudo ? { content: 'none' } as CSSStyleDeclaration : computedStyle(element))
    large.animate([], 40)
    large.animate([], 40)
    expect(styles.mock.calls.every(([element]) => element === large)).toBe(true)
    expect(styles.mock.calls.length).toBeLessThanOrEqual(3)
    vi.advanceTimersByTime(16)
    expect(capture).toHaveBeenCalledTimes(3)
    expect(capture.mock.calls[2][0].snapshot.simplified).toBe(true)
    expect(capture.mock.calls[2][0].snapshot.node.querySelectorAll('*')).toHaveLength(79)
    expect(large.children).toHaveLength(600)
    large.className = 'pending-on-departure'
    large.animate([], 40)
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock++)
    vi.advanceTimersByTime(16)
    expect(capture).toHaveBeenCalledTimes(3)
    stop()
    expect(Element.prototype.animate).toBe(original)
    source.animate([], 1)
    vi.advanceTimersByTime(500)
    expect(capture).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    stop()
    if (descriptor) Object.defineProperty(Element.prototype, 'animate', descriptor)
    else Reflect.deleteProperty(Element.prototype, 'animate')
  }
})

it('keeps a short numeric update after its source disappears and clears pending recordings on departure', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const source = document.createElement('span')
  source.textContent = '0'
  document.body.append(source)
  const capture = vi.fn()
  const stop = observePageAnimations(capture, vi.fn())
  for (const value of ['10', '20', '30']) {
    source.textContent = value
    await Promise.resolve()
    vi.advanceTimersByTime(30)
  }
  source.remove()
  await Promise.resolve()
  vi.advanceTimersByTime(180)
  expect(capture).toHaveBeenCalledTimes(1)
  expect(capture.mock.calls[0][0]).toMatchObject({ kind: 'text', texts: [{ at: 0, value: '0' }, { at: 0, value: '10' }, { at: 30, value: '20' }, { at: 60, value: '30' }] })
  document.body.append(source)
  source.textContent = '40'
  await Promise.resolve()
  stop()
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(500)
  expect(capture).toHaveBeenCalledTimes(1)
})
