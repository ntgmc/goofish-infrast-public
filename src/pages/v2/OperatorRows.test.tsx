// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OperatorRows from './OperatorRows'
import { SAMPLE_OPERATORS } from './sample-result'

const observers = new Set<TestResizeObserver>()
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
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('v2-drawer-body') ? 600 : 0 })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('v2-operator-entry') ? this.querySelector('details')?.open ? 440 : 140 : 600
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.getAttribute('role') === 'list' ? 200 - (this.closest('.v2-drawer-body')?.scrollTop ?? 0) : 0
    return { x: 0, y: top, top, bottom: top + 600, left: 0, right: 400, width: 400, height: 600, toJSON() {} }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); observers.clear() })

it('measures expanded rows, restores them after recycling, and keeps keyboard focus while scrolling', async () => {
  const user = userEvent.setup()
  const operators = Array.from({ length: 150 }, (_, index) => ({ ...SAMPLE_OPERATORS[0], id: `operator-${index}` }))
  const page = render(<div className="v2-drawer-body"><div className="v2-operator-management"><OperatorRows operators={operators} /></div></div>)
  const scroll = page.container.querySelector<HTMLDivElement>('.v2-drawer-body')!
  const list = page.getByRole('list')
  const row = (index: number) => list.querySelector<HTMLDivElement>(`[data-index="${index}"]`)
  const scrollTo = (top: number) => { scroll.scrollTop = top; fireEvent.scroll(scroll) }
  expect(within(list).getAllByRole('listitem').length).toBeLessThan(15)
  expect(row(0)).toHaveAttribute('aria-setsize', '150')
  expect(row(0)).toHaveAttribute('aria-posinset', '1')
  const collapsedHeight = parseFloat(list.style.height)

  await user.click(row(0)!.querySelector('summary')!)
  await waitFor(() => expect(row(0)!.querySelector('.v2-skill-list')).toBeInTheDocument())
  act(() => resize(row(0)!))
  await waitFor(() => expect(parseFloat(list.style.height)).toBeGreaterThan(collapsedHeight))
  act(() => row(0)!.querySelector('summary')!.blur())
  scrollTo(17000)
  await waitFor(() => expect(row(0)).not.toBeInTheDocument())
  expect(within(list).getAllByRole('listitem').length).toBeLessThan(20)
  scrollTo(0)
  await waitFor(() => expect(row(0)!.querySelector('details')).toHaveAttribute('open'))
  expect(row(0)!.querySelector('.v2-skill-list')).toBeInTheDocument()

  const summary = row(0)!.querySelector('summary')!
  act(() => summary.focus())
  scrollTo(17000)
  expect(summary).toHaveFocus()
  expect(row(0)).toBeInTheDocument()
  await user.tab()
  expect(row(1)!.querySelector('summary')).toHaveFocus()
  await user.tab({ shift: true })
  expect(summary).toHaveFocus()
})
