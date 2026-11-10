// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import { DataActivity } from './DataActivity'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('keeps a continuous wait across real stages, pauses in the background and clears its timer on departure', () => {
  vi.useFakeTimers()
  const view = render(<DataActivity label="Syncing" skeleton="cards" />)
  expect(screen.getByRole('status', { name: 'Syncing' })).toHaveAttribute('aria-busy', 'true')
  act(() => vi.advanceTimersByTime(4000))
  view.rerender(<DataActivity label="Calculating" skeleton="cards" />)
  expect(screen.queryByText(copy.v2.dataActivity.slow)).not.toBeInTheDocument()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  expect(view.container.firstElementChild).toHaveAttribute('data-paused')
  act(() => vi.advanceTimersByTime(4000))
  expect(screen.getByText(copy.v2.dataActivity.slow)).toBeInTheDocument()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
  render(<DataActivity label="Another account" />)
  expect(screen.queryByText(copy.v2.dataActivity.slow)).not.toBeInTheDocument()
  cleanup()
  expect(vi.getTimerCount()).toBe(0)
})
