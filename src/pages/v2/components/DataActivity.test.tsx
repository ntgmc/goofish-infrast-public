// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import { DataActivity, DataRefresh, useDataUpdate } from './DataActivity'

const state = vi.hoisted(() => ({ reduced: false }))
vi.mock('../../../lib/motion-preference', () => ({ useAppReducedMotion: () => state.reduced }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); state.reduced = false })

it('keeps a continuous wait across real stages, pauses in the background and clears its timer on departure', () => {
  vi.useFakeTimers()
  const view = render(<DataActivity label="Syncing" skeleton="cards" />)
  expect(screen.getByRole('status', { name: 'Syncing' })).toHaveAttribute('aria-busy', 'true')
  act(() => vi.advanceTimersByTime(4000))
  view.rerender(<DataActivity label="Calculating" skeleton="cards" />)
  expect(screen.queryByText(copy.common.dataActivity.slow)).not.toBeInTheDocument()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  expect(view.container.firstElementChild).toHaveAttribute('data-paused')
  act(() => vi.advanceTimersByTime(4000))
  expect(screen.getByText(copy.common.dataActivity.slow)).toBeInTheDocument()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
  render(<DataActivity label="Another account" />)
  expect(screen.queryByText(copy.common.dataActivity.slow)).not.toBeInTheDocument()
  cleanup()
  expect(vi.getTimerCount()).toBe(0)
})

it('confirms a returned revision only after the wait ends and suppresses failure and cancellation feedback', () => {
  vi.useFakeTimers()
  const initial = {}, updated = {}
  const view = render(<DataRefresh pending revision={initial} label="Syncing" />)
  view.rerender(<DataRefresh pending revision={updated} label="Syncing" />)
  expect(screen.queryByText(copy.common.dataActivity.updated)).not.toBeInTheDocument()
  view.rerender(<DataRefresh pending={false} revision={updated} label="Syncing" />)
  expect(screen.getByText(copy.common.dataActivity.updated)).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1200))
  expect(screen.queryByText(copy.common.dataActivity.updated)).not.toBeInTheDocument()
  view.rerender(<DataRefresh pending revision={updated} label="Syncing" />)
  view.rerender(<DataRefresh pending={false} revision={updated} label="Syncing" />)
  expect(screen.queryByText(copy.common.dataActivity.updated)).not.toBeInTheDocument()
  view.rerender(<DataRefresh pending revision={updated} label="Syncing" />)
  view.rerender(<DataRefresh pending={false} revision={{}} error label="Syncing" />)
  expect(screen.queryByText(copy.common.dataActivity.updated)).not.toBeInTheDocument()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('highlights changed values without remounting content and cancels immediately for reduced motion', () => {
  const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  function Resource({ value }: { value: number }) {
    const update = useDataUpdate(value)
    return <div ref={update}><input aria-label="Kept input" defaultValue="Draft" /></div>
  }
  const view = render(<Resource value={10} />)
  const input = screen.getByRole('textbox')
  input.focus()
  expect(animate).not.toHaveBeenCalled()
  view.rerender(<Resource value={20} />)
  expect(animate).toHaveBeenCalledOnce()
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveFocus()
  state.reduced = true
  view.rerender(<Resource value={30} />)
  expect(cancel).toHaveBeenCalledOnce()
  expect(animate).toHaveBeenCalledOnce()
})
