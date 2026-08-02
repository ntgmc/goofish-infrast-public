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
    expect(screen.queryByText('开发者与排障')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('tab')[2])
    const disclosureLabel = screen.getByText('开发者与排障')
    const disclosure = disclosureLabel.closest('details')
    expect(disclosure).not.toHaveAttribute('open')

    await user.click(disclosureLabel)
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByText(/不应导入 MAA/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下载完整计算数据' }))
    expect(onDownload).not.toHaveBeenCalled()
    expect(onDownloadFullResult).toHaveBeenCalledTimes(1)
  })

  it('hides the full-data tab when the profile lacks the view capability', () => {
    render(<ResultPanel result={createResult()} fullDataAvailable={false} />)

    expect(screen.queryByRole('tab', { name: '产出数据' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '导入' })).toBeInTheDocument()
  })

  it('disables the MAA download while the request is in flight', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    render(<ResultPanel result={createResult()} onDownload={onDownload} downloadBusy />)

    const button = screen.getByRole('button', { name: '正在准备下载…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    expect(onDownload).not.toHaveBeenCalled()
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
