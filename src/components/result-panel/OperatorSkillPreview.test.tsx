// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OperatorSkillPreview from './OperatorSkillPreview'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers() })

function renderPreview(dialogTrigger: boolean) {
  const page = render(<OperatorSkillPreview>
    <button type="button" aria-haspopup={dialogTrigger ? 'dialog' : undefined}>
      <span data-operator-name="能天使" data-operator-id="char_103_angel" data-operator-elite="2" data-operator-level="90">能天使</span>
    </button>
  </OperatorSkillPreview>)
  const button = page.getByRole('button')
  return { button, tile: button.querySelector('span')! }
}

it('keeps a single-operator dialog trigger free of focus previews after dismissal and closes hover previews on leave', () => {
  const { button, tile } = renderPreview(true)
  act(() => { button.focus(); vi.advanceTimersByTime(200) })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  fireEvent.pointerOver(tile, { pointerType: 'mouse' })
  act(() => vi.advanceTimersByTime(200))
  expect(screen.getByRole('tooltip')).toHaveTextContent('物流专家')
  fireEvent.pointerOut(tile, { relatedTarget: document.body, pointerType: 'mouse' })
  act(() => vi.advanceTimersByTime(150))
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(button).toHaveFocus()
  act(() => { button.blur(); button.focus(); vi.advanceTimersByTime(200) })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

it('preserves focus previews for a standalone operator button', () => {
  const { button, tile } = renderPreview(false)
  act(() => { button.focus(); vi.advanceTimersByTime(200) })
  expect(screen.getByRole('tooltip')).toHaveTextContent('物流专家')
  fireEvent.pointerOut(tile, { relatedTarget: document.body, pointerType: 'mouse' })
  act(() => vi.advanceTimersByTime(150))
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
  act(() => { button.blur(); vi.advanceTimersByTime(150) })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})
