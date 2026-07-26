// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuidedTour, { findVisibleTourTarget, tourStorageKey, useFirstRunTour, type TourDefinition } from './GuidedTour'

const definition: TourDefinition = {
  id: 'test-tour',
  version: 1,
  steps: [{ target: 'test-target', title: '测试步骤', body: '测试说明' }],
}

beforeEach(() => {
  window.localStorage.clear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.zeroRect === 'true') return rect(0, 0, 0, 0)
    return rect(20, 20, 160, 48)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('GuidedTour', () => {
  it('opens once automatically and persists completion by id and version', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness definition={definition} />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(window.localStorage.getItem(tourStorageKey('test-tour', 1))).toBe('done')

    unmount()
    render(<Harness definition={definition} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    cleanup()
    render(<Harness definition={{ ...definition, version: 2 }} />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('marks an escaped tour as skipped and still allows manual replay', async () => {
    const user = userEvent.setup()
    render(<Harness definition={{ ...definition, id: 'escape-tour' }} />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(tourStorageKey('escape-tour', 1))).toBe('done')

    const replay = screen.getByRole('button', { name: '重播' })
    replay.focus()
    await user.click(replay)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('uses an in-memory completion fallback when storage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const user = userEvent.setup()
    const fallbackDefinition = { ...definition, id: 'fallback-tour' }
    const { unmount } = render(<Harness definition={fallbackDefinition} />)
    await user.click(await screen.findByRole('button', { name: '完成' }))
    unmount()

    render(<Harness definition={fallbackDefinition} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(getItem).toHaveBeenCalled()
    expect(setItem).toHaveBeenCalled()
  })

  it('selects the visible instance when desktop and mobile targets are duplicated', () => {
    const { container } = render(
      <>
        <button data-tour-target="duplicate" data-zero-rect="true">hidden</button>
        <button data-tour-target="duplicate">visible</button>
      </>,
    )
    expect(findVisibleTourTarget('duplicate')).toBe(container.querySelector('button:last-child'))
  })

  it('uses a compact header fallback only when the real navigation target is not visible', () => {
    const { container } = render(
      <>
        <button data-tour-target="section" data-zero-rect="true">hidden navigation</button>
        <button data-tour-fallback-targets="section other">compact menu</button>
      </>,
    )
    const compactMenu = screen.getByRole('button', { name: 'compact menu' })
    expect(findVisibleTourTarget('section')).toBe(compactMenu)

    const realTarget = container.querySelector<HTMLButtonElement>('[data-tour-target="section"]')
    realTarget?.removeAttribute('data-zero-rect')
    expect(findVisibleTourTarget('section')).toBe(realTarget)
  })

  it('skips a missing step and continues to the next available target', async () => {
    vi.useFakeTimers()
    const onFinish = vi.fn()
    render(
      <>
        <button data-tour-target="available">available</button>
        <GuidedTour
          definition={{ id: 'missing-tour', version: 1, steps: [
            { target: 'missing', title: '缺失', body: '缺失目标' },
            { target: 'available', title: '可用', body: '可用目标' },
          ] }}
          open
          onFinish={onFinish}
          onSkip={vi.fn()}
        />
      </>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_250)
    })
    expect(screen.getByRole('heading', { name: '可用' })).toBeInTheDocument()
    expect(onFinish).not.toHaveBeenCalled()
  })
})

function Harness({ definition }: { definition: TourDefinition }) {
  const tour = useFirstRunTour({ id: definition.id, version: definition.version })
  return (
    <>
      <button type="button" onClick={tour.start}>重播</button>
      <div data-tour-target="test-target">目标</div>
      <GuidedTour definition={definition} open={tour.open} onFinish={tour.finish} onSkip={tour.skip} />
    </>
  )
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  }
}
