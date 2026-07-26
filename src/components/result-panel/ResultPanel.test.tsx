// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizeResult } from '../../lib/types'
import ResultPanel from './ResultPanel'

afterEach(cleanup)

describe('ResultPanel tabs', () => {
  it('places office cards before dormitory cards in the preview', () => {
    render(<ResultPanel result={createPreviewOrderResult()} />)

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      '办公室',
      '宿舍',
    ])
  })

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

  it('keeps the full result download available for rotation results while hiding MAA download', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    const onDownloadFullResult = vi.fn()
    render(
      <ResultPanel
        result={{ ...createResult(), schedule_mode: 'rotation' }}
        onDownload={onDownload}
        onDownloadFullResult={onDownloadFullResult}
      />,
    )

    expect(screen.queryByRole('button', { name: '下载 MAA JSON' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下载完整计算数据' }))
    expect(onDownload).not.toHaveBeenCalled()
    expect(onDownloadFullResult).toHaveBeenCalledTimes(1)
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

function createPreviewOrderResult(): OptimizeResult {
  return {
    ...createResult(),
    plans: [{
      name: '班次 1',
      rooms: {
        dormitory: [{ operators: ['宿舍干员'] }],
        hire: [{ operators: ['办公室干员'] }],
      },
    }],
  }
}
