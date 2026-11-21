// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildingRatingFactors } from '../../lib/building-rating-factors'
import { singleBuildingRatings } from '../../lib/building-skill-ratings'
import BuildingRatingFactors from './BuildingRatingFactors'

afterEach(cleanup)

describe('building rating radar', () => {
  it('keeps every stage overlaid and details collapsed, and draws exceptional tiers beyond the fifth ring', () => {
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
    const profile = buildingRatingFactors('control', ['control_mp_cost[000]'])
    const { container } = render(<BuildingRatingFactors room="control" series={[{ id: 'base', label: 'E0', factors: profile.factors }]} />)
    expect(container.querySelectorAll('.v2-factor-series circle')).toHaveLength(4)
    expect(container.querySelector('.v2-factor-series polygon')).toBeNull()
    fireEvent.click(container.querySelector('summary')!)
    expect(within(screen.getByRole('table')).getByText('待量化')).toBeInTheDocument()
  })
})
