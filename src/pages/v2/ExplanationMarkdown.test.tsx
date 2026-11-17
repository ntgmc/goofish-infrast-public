// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ExplanationMarkdown from './ExplanationMarkdown'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('../../lib/motion-preference', () => ({ useAppReducedMotion: () => motion.reduced }))
const animated: { text: string | null; keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = []
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
beforeEach(() => {
  motion.reduced = false
  animated.length = 0
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    animated.push({ text: this.textContent, keyframes, options })
  } })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})

it('reveals only fresh Markdown text with bounded blur/stagger and keeps numbers intact across updates and reopening', () => {
  const revealed = { current: 0 }
  const first = '**先看库存**'
  const mounted = render(<ExplanationMarkdown revealed={revealed}>{first}</ExplanationMarkdown>)
  expect(mounted.container.textContent).toBe('先看库存')
  expect(animated.map((item) => item.text).join('')).toBe('先看库存')
  expect(animated[0].keyframes[0]).toMatchObject({ filter: 'blur(4px)', opacity: 0 })
  expect(animated[1].options.delay).toBeGreaterThan(animated[0].options.delay!)
  const count = animated.length
  const next = `${first}，预计日收益 12.50 理智。`
  mounted.rerender(<ExplanationMarkdown revealed={revealed}>{next}</ExplanationMarkdown>)
  expect(animated.slice(count).some((item) => item.text === '12.50')).toBe(true)
  expect(animated.slice(count).some((item) => item.text?.includes('先看'))).toBe(false)
  expect(mounted.container.textContent).toBe('先看库存，预计日收益 12.50 理智。')
  const settled = animated.length
  mounted.unmount()
  render(<ExplanationMarkdown revealed={revealed}>{next}</ExplanationMarkdown>)
  expect(animated).toHaveLength(settled)
  expect(animated.every((item) => item.options.duration === 480 && Number(item.options.delay) <= 108)).toBe(true)
})

it('keeps a large chunk readable immediately while limiting the number of blurred fragments', () => {
  const content = '先核对库存，再培养一项。'.repeat(100)
  const mounted = render(<ExplanationMarkdown revealed={{ current: 0 }}>{content}</ExplanationMarkdown>)
  expect(mounted.container.textContent).toBe(content)
  expect(animated).toHaveLength(24)
})

it('keeps a short Chinese paragraph tail together without changing the text or Markdown semantics', () => {
  const content = '可查看[资料](https://example.test/guide)，`零缺口`也会消耗现有材料。'
  const mounted = render(<ExplanationMarkdown>{content}</ExplanationMarkdown>)
  expect(mounted.container.querySelector('.v2-explanation-tail')).toHaveTextContent('现有材料。')
  expect(mounted.container.textContent).toBe('可查看资料，零缺口也会消耗现有材料。')
  expect(mounted.container.querySelector('a')).toHaveAttribute('href', 'https://example.test/guide')
  expect(animated).toHaveLength(0)
})

it('shows static text for saved answers and reduced motion, cancelling active ink when motion is reduced', () => {
  const revealed = { current: 0 }
  const mounted = render(<ExplanationMarkdown revealed={revealed}>库存还可用 12 天</ExplanationMarkdown>)
  const cancel = vi.fn()
  const body = mounted.container.firstElementChild!
  Object.defineProperty(body, 'getAnimations', { configurable: true, value: () => [{ cancel }] })
  const count = animated.length
  motion.reduced = true
  mounted.rerender(<ExplanationMarkdown revealed={revealed}>库存还可用 12 天，先核对材料。</ExplanationMarkdown>)
  expect(animated).toHaveLength(count)
  expect(cancel).toHaveBeenCalledOnce()
  expect(mounted.container.querySelector('[data-ink-offset]')).toBeNull()
  mounted.rerender(<ExplanationMarkdown>**已保存的解读**</ExplanationMarkdown>)
  expect(mounted.container.textContent).toBe('已保存的解读')
  expect(animated).toHaveLength(count)
})
