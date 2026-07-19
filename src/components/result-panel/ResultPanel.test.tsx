// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { OptimizeResult } from '../../lib/types'
import ResultPanel from './ResultPanel'

afterEach(cleanup)

describe('ResultPanel tabs', () => {
  it('keeps aria controls and the latest panel synchronized during rapid switching', async () => {
    const user = userEvent.setup()
    render(<ResultPanel result={createResult()} />)
    const tabs = screen.getAllByRole('tab')
    const boardTab = tabs[0]
    const detailTab = tabs[1]
    const dataTab = tabs[2]

    expect(boardTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', boardTab.getAttribute('aria-controls'))

    await user.click(detailTab)
    await user.click(dataTab)
    await user.click(detailTab)

    expect(detailTab).toHaveAttribute('aria-selected', 'true')
    expect(boardTab).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', detailTab.getAttribute('aria-controls'))
  })
})

function createResult(): OptimizeResult {
  return {
    author: 'test',
    title: '测试排班',
    description: '测试结果',
    buildingType: 243,
    planTimes: '单班',
    plans: [],
    raw_results: [],
  }
}
