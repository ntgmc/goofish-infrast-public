// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { copy } from '../../../copy'
import PricingBenefits from './PricingBenefits'

const state = vi.hoisted(() => ({ reduced: false, available: true }))
vi.mock('../../../lib/motion-preference', () => ({ useAppReducedMotion: () => state.reduced }))
vi.mock('../../../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: { maa_export: state.available, scenario_comparison: state.available } }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); state.reduced = false; state.available = true })

it('keeps all capability explanations available while scrolling switches the visual stage', () => {
  let frame: FrameRequestCallback
  let scrollTop = 0
  vi.stubGlobal('innerHeight', 1100)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = 500 + Number(this.dataset.step ?? 0) * 400 - scrollTop
    return { top, bottom: top + 400 } as DOMRect
  })
  const view = render(<MemoryRouter><PricingBenefits /></MemoryRouter>)
  const steps = view.container.querySelectorAll('.v2-benefit-step')
  expect(steps).toHaveLength(4)
  const stage = view.container.querySelector('.v2-benefit-stage')!
  for (const [top, expected] of [[420, 1], [820, 2], [1220, 3], [820, 2], [420, 1], [0, 0], [1220, 3], [0, 0], [1050, 3]]) {
    scrollTop = top
    fireEvent.scroll(window)
    act(() => frame(0))
    expect(stage).toHaveAttribute('data-step', String(expected))
  }
  scrollTop = 820
  fireEvent.resize(window)
  act(() => frame(0))
  expect(stage).toHaveAttribute('data-step', '2')
  expect(screen.getByRole('heading', { name: copy.public.pricing_story.config.title })).toBeInTheDocument()
  expect(screen.getByText(copy.optimize.paid_preview.quotas(1, 3, 8))).toBeInTheDocument()
  state.reduced = true
  view.rerender(<MemoryRouter><PricingBenefits /></MemoryRouter>)
  expect(cancelAnimationFrame).toHaveBeenCalled()
  expect(steps[0]).toHaveTextContent(copy.public.pricing_story.config.body)
})

it('shows current export and comparison availability beside their explanations', () => {
  state.reduced = true
  state.available = false
  render(<MemoryRouter><PricingBenefits /></MemoryRouter>)
  expect(screen.getByText(copy.public.pricing_choice.export_unavailable)).toBeInTheDocument()
  expect(screen.getByText(copy.optimize.paid_preview.lab_unavailable)).toBeInTheDocument()
  expect(screen.queryByText(copy.optimize.paid_preview.quotas(1, 3, 8))).not.toBeInTheDocument()
})
