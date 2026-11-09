// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { copy } from '../../../copy'
import PricingBenefits from './PricingBenefits'

const state = vi.hoisted(() => ({ reduced: false, available: true }))
vi.mock('../../../lib/motion-preference', () => ({ useAppReducedMotion: () => state.reduced }))
vi.mock('../../../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: { maa_export: state.available, scenario_comparison: state.available } }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); state.reduced = false; state.available = true })

it('keeps all capability explanations available while scrolling switches the visual stage', () => {
  let enter: IntersectionObserverCallback
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { enter = callback }
    observe() {}
    disconnect = disconnect
  })
  const view = render(<MemoryRouter><PricingBenefits /></MemoryRouter>)
  const steps = view.container.querySelectorAll('.v2-benefit-step')
  expect(steps).toHaveLength(4)
  act(() => enter([{ isIntersecting: true, target: steps[3] }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(view.container.querySelector('.v2-benefit-stage')).toHaveAttribute('data-step', '3')
  expect(screen.getByRole('heading', { name: copy.public.pricing_story.config.title })).toBeInTheDocument()
  expect(screen.getByText(copy.optimize.paid_preview.quotas(1, 3, 8))).toBeInTheDocument()
  state.reduced = true
  view.rerender(<MemoryRouter><PricingBenefits /></MemoryRouter>)
  expect(disconnect).toHaveBeenCalled()
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
