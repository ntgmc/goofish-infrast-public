// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OperatorRows from './OperatorRows'
import { SAMPLE_OPERATORS } from './sample-result'

const observers = new Set<TestResizeObserver>()
let containerWidth = 400
class TestResizeObserver implements ResizeObserver {
  targets = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) { observers.add(this) }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear(); observers.delete(this) }
}
function resize(target: HTMLElement) {
  for (const observer of observers) if (observer.targets.has(target)) observer.callback([
    { target, borderBoxSize: [{ inlineSize: 400, blockSize: target.offsetHeight }] } as unknown as ResizeObserverEntry,
  ], observer)
}

beforeEach(() => {
  containerWidth = 400
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('v2-drawer-body') ? 600 : 0 })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => containerWidth)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('v2-operator-grid-row') ? 160 : 600
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.getAttribute('role') === 'list' ? 200 - (this.closest('.v2-drawer-body')?.scrollTop ?? 0) : 0
    return { x: 0, y: top, top, bottom: top + 600, left: 0, right: 400, width: 400, height: 600, toJSON() {} }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); observers.clear() })

it('keeps grid rows compact while details open separately and retains keyboard focus while recycling', async () => {
  const user = userEvent.setup()
  const operators = Array.from({ length: 150 }, (_, index) => ({ ...SAMPLE_OPERATORS[0], id: `operator-${index}` }))
  const page = render(<div className="v2-drawer-body"><div className="v2-operator-management"><OperatorRows operators={operators} /></div></div>)
  const scroll = page.container.querySelector<HTMLDivElement>('.v2-drawer-body')!
  const list = page.getByRole('list')
  const row = (index: number) => list.querySelector<HTMLDivElement>(`[data-operator-index="${index}"]`)
  const scrollTo = (top: number) => { scroll.scrollTop = top; fireEvent.scroll(scroll) }
  expect(list.style.getPropertyValue('--v2-operator-columns')).toBe('3')
  expect(within(list).getAllByRole('listitem').length).toBeLessThan(35)
  expect(row(0)).toHaveAttribute('aria-setsize', '150')
  expect(row(0)).toHaveAttribute('aria-posinset', '1')
  const collapsedHeight = parseFloat(list.style.height)

  const trigger = row(0)!.querySelector('button')!
  await user.click(trigger)
  const dialog = page.getByRole('dialog')
  expect(dialog.querySelector('.v2-skill-list')).toBeInTheDocument()
  expect(row(0)!.querySelector('.v2-skill-list')).not.toBeInTheDocument()
  expect(parseFloat(list.style.height)).toBe(collapsedHeight)
  const outsideWheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
  document.body.dispatchEvent(outsideWheel)
  expect(outsideWheel.defaultPrevented).toBe(true)
  const zoomWheel = new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true })
  dialog.dispatchEvent(zoomWheel)
  expect(zoomWheel.defaultPrevented).toBe(false)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
  const releasedWheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
  document.body.dispatchEvent(releasedWheel)
  expect(releasedWheel.defaultPrevented).toBe(false)
  act(() => trigger.blur())
  scrollTo(17000)
  await waitFor(() => expect(row(0)).not.toBeInTheDocument())
  expect(within(list).getAllByRole('listitem').length).toBeLessThan(40)
  scrollTo(0)
  await waitFor(() => expect(row(0)).toBeInTheDocument())
  const button = row(0)!.querySelector('button')!
  act(() => button.focus())
  scrollTo(17000)
  expect(button).toHaveFocus()
  expect(row(0)).toBeInTheDocument()
  await user.tab()
  expect(row(1)!.querySelector('button')).toHaveFocus()
  await user.tab({ shift: true })
  expect(button).toHaveFocus()
  act(() => button.blur())
  scrollTo(0)
  const wideHeight = parseFloat(list.style.height)
  containerWidth = 280
  act(() => resize(list))
  await waitFor(() => expect(list.style.getPropertyValue('--v2-operator-columns')).toBe('2'))
  expect(parseFloat(list.style.height)).toBeGreaterThan(wideHeight)
  expect(row(0)).toHaveAttribute('aria-posinset', '1')
  expect(row(0)!.querySelector('button')).toHaveAttribute('aria-haspopup', 'dialog')
})
