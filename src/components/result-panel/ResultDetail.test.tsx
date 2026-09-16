// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OptimizeResult } from '../../lib/types'
import DroneSummary from './DroneSummary'
import ResultDetail from './ResultDetail'
import { prepareResult } from './formatters'

afterEach(cleanup)

describe('ResultDetail efficiency visibility', () => {
  it.each([false, true])('hides dormitory and processing efficiency in rotation=%s', (isRotationMode) => {
    const result: OptimizeResult = {
      author: 'test',
      title: 'test',
      description: '',
      buildingType: 243,
      planTimes: '',
      plans: [{
        name: 'test',
        rooms: {
          dormitory: [{ operators: ['Dormitory'] }],
          processing: [{ operators: ['Processing'] }],
          manufacture: [{ operators: ['Manufacture'] }],
        },
      }],
      raw_results: [],
    }
    const prepared = prepareResult(result, false, false)
    for (const row of prepared.plans[0].rows) {
      row.efficiency = `${row.roomType}-efficiency`
      row.detailItems = [`${row.roomType}-details`]
    }
    render(<ResultDetail prepared={prepared} isRotationMode={isRotationMode} />)

    for (const room of ['dormitory', 'processing']) {
      expect(screen.queryByText(`${room}-efficiency`)).not.toBeInTheDocument()
      expect(screen.queryByText(`${room}-details`)).not.toBeInTheDocument()
    }
    expect(screen.getAllByText('manufacture-efficiency').length).toBeGreaterThan(0)
    expect(screen.getByText('manufacture-details')).toBeInTheDocument()
    expect(screen.getByText('Dormitory')).toBeInTheDocument()
    expect(screen.getByText('Processing')).toBeInTheDocument()
  })
})

describe('DroneSummary order labels', () => {
  it.each([['pre', '换班前'], ['post', '换班后']])('localizes %s', (order, label) => {
    render(<DroneSummary drones={{ enable: true, room: 'manufacture', index: 1, order }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText(order)).not.toBeInTheDocument()
  })
})
