// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ValueClockNumber from './ValueClockNumber'

afterEach(cleanup)

it('keeps the fraction separate from the integer animation', () => {
  const { container } = render(<ValueClockNumber value={28_825_564.5} />)
  expect(container.querySelector('.value-clock-number-integer')?.textContent).toBe('28,825,564')
  expect(container.querySelector('.value-clock-number-fraction')?.textContent).toBe('.50')
  expect(container.querySelector('.value-clock-number-fraction .value-clock-digit')).toBeNull()
  expect(container.querySelectorAll('.value-clock-digit')).toHaveLength(8)
})

it('animates only changed integer digits and cancels superseded motion', () => {
  const cancel = vi.fn()
  const animate = vi.fn(() => ({ cancel }))
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  const page = render(<ValueClockNumber value={1234.5} />)
  try {
    expect(animate).not.toHaveBeenCalled()
    page.rerender(<ValueClockNumber value={1235.5} />)
    expect(animate).toHaveBeenCalledOnce()
    page.rerender(<ValueClockNumber value={1235.75} />)
    expect(animate).toHaveBeenCalledOnce()
    page.rerender(<ValueClockNumber value={1236.75} />)
    expect(cancel).toHaveBeenCalledOnce()
    page.rerender(<ValueClockNumber value={1236.75} animated={false} />)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.value-clock-digit')).toBeNull()
  } finally {
    page.unmount()
    if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  }
})

it('preserves rounding and grouping across a carry and signed values in static mode', () => {
  const { container, rerender } = render(<ValueClockNumber value={-99.995} animated={false} />)
  expect(container.textContent).toBe('-100.00')
  rerender(<ValueClockNumber value={9999.995} animated={false} />)
  expect(container.textContent).toBe('10,000.00')
  expect(container.querySelector('.value-clock-digit')).toBeNull()
  rerender(<ValueClockNumber value={undefined} />)
  expect(container.textContent).toBe('—')
})
