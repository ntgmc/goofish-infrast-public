// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ResultBoard from './ResultBoard'
import type { PreparedResult } from './formatters'
import type { RoomRow } from './types'

afterEach(cleanup)

describe('ResultBoard room tones', () => {
  it('keeps each room type identifiable with its semantic tone and visible label', () => {
    const roomTypes = [
      ['trading', '贸易站', 'border-brand-500/35', 'bg-brand-500/10'],
      ['manufacture', '制造站', 'border-warning/35', 'bg-warning/10'],
      ['power', '发电站', 'border-success/35', 'bg-success/10'],
      ['control', '控制中枢', 'border-brand-300/25', 'bg-surface-2/45'],
      ['meeting', '会客室', 'border-surface-4/70', 'bg-surface-2/35'],
      ['hire', '办公室', 'border-surface-4/70', 'bg-surface-2/35'],
      ['processing', '加工站', 'border-surface-4/70', 'bg-surface-2/35'],
      ['dormitory', '宿舍', 'border-success/25', 'bg-success/10'],
    ] as const

    render(<ResultBoard prepared={createPreparedResult(roomTypes.map(([roomType, label]) => createRoomRow(roomType, label)))} isRotationMode={false} />)

    for (const [, label, borderClass, backgroundClass] of roomTypes) {
      const card = screen.getByRole('heading', { name: label }).closest('article')
      expect(card).toHaveClass('tool-inset', borderClass, backgroundClass)
    }
  })

  it('uses the neutral fallback tone for unknown room types', () => {
    render(<ResultBoard prepared={createPreparedResult([createRoomRow('workshop', '未知站点')])} isRotationMode={false} />)

    const card = screen.getByRole('heading', { name: '未知站点' }).closest('article')
    expect(card).toHaveClass('tool-inset', 'border-surface-3', 'bg-surface-2/35')
  })
})

function createPreparedResult(rows: RoomRow[]): PreparedResult {
  return {
    totalEff: 0,
    rawTotalEff: 0,
    hasDailyProduction: false,
    plans: [{ name: '班次 1', rooms: {}, rows }],
    productionStats: {
      manufacturing: {},
      manufacturingTotal: 0,
      lmd: 0,
      orundum: 0,
      goldNet: 0,
      droneGain: { value: '0', suffix: '', note: '' },
    },
    productionSanity: { value: 0, note: '' },
    intermediateDepletion: [],
    detailStats: { planCount: 1, roomCount: rows.length },
  }
}

function createRoomRow(roomType: string, label: string): RoomRow {
  return {
    key: `0-${roomType}-0`,
    label,
    indexLabel: '',
    roomType,
    roomIndex: 0,
    queueLabel: '班次 1',
    product: '-',
    operators: [],
    operatorText: `${label}排班`,
    efficiency: '-',
    speedEfficiency: '-',
    detail: '',
    detailItems: [],
    hasAdjustedSpeed: false,
    isAutofill: true,
  }
}
