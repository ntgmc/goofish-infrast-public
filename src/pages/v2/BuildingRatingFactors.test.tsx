// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as siteFeatureContext from '../../lib/site-feature-context'
import { DEFAULT_SITE_FEATURES } from '../../lib/site-features'
import { buildingRatingFactors } from '../../lib/building-rating-factors'
import { singleBuildingRatings } from '../../lib/building-skill-ratings'
import BuildingRatingFactors from './BuildingRatingFactors'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const enableRadar = () => vi.spyOn(siteFeatureContext, 'useSiteFeatures').mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, building_rating_radar: true }, updatedAt: null, retry: () => undefined })

describe('building rating radar', () => {
  it('hides the chart and details by default and follows feature changes while mounted', () => {
    const profile = buildingRatingFactors('trading', ['trade_ord_spd[000]'])
    const view = () => <BuildingRatingFactors room="trading" series={[{ id: 'base', label: 'E0', factors: profile.factors }]} />
    const { container, rerender } = render(view())
    expect(container).toBeEmptyDOMElement()
    const feature = enableRadar()
    rerender(view())
    expect(screen.getByRole('img', { name: '技能特点雷达图' })).toBeInTheDocument()
    feature.mockReturnValue({ status: 'ready', features: DEFAULT_SITE_FEATURES, updatedAt: null, retry: () => undefined })
    rerender(view())
    expect(container).toBeEmptyDOMElement()
  })
  it('keeps every stage overlaid and details collapsed, and draws exceptional tiers beyond the fifth ring', () => {
    enableRadar()
    const entry = singleBuildingRatings.find((item) => item.name === '但书' && item.room === 'trading')!
    const { container } = render(<BuildingRatingFactors room="trading" series={entry.stages.map((stage) => ({ id: `${stage.elite}.${stage.level}`, label: `E${stage.elite}`, factors: buildingRatingFactors('trading', stage.skills).factors }))} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.v2-factor-series')).toHaveLength(2)
    expect(container.querySelectorAll('.v2-factor-grid')).toHaveLength(5)
    const ring = container.querySelectorAll('.v2-factor-grid polygon')[4]
    const fifthY = Number(ring.getAttribute('points')!.split(' ')[0].split(',')[1])
    const peak = container.querySelector('.v2-factor-series[data-current="true"] circle')!
    expect(Number(peak.getAttribute('cy'))).toBeLessThan(fifthY)
    expect(screen.getByText('8')).toBeInTheDocument()
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    fireEvent.click(within(details).getByText('分项明细', { selector: 'summary' }))
    expect(details.open).toBe(true)
    expect(within(screen.getByRole('table')).getByText('8档')).toBeInTheDocument()
  })

  it('leaves an unquantified effect open in the shape instead of creating a zero or lowest-tier point', () => {
    enableRadar()
    const profile = buildingRatingFactors('control', ['control_mp_cost[000]'])
    const { container } = render(<BuildingRatingFactors room="control" series={[{ id: 'base', label: 'E0', factors: profile.factors }]} />)
    expect(container.querySelectorAll('.v2-factor-series circle')).toHaveLength(4)
    expect(container.querySelector('.v2-factor-series polygon')).toBeNull()
    fireEvent.click(container.querySelector('summary')!)
    expect(within(screen.getByRole('table')).getByText('待量化')).toBeInTheDocument()
  })
})
