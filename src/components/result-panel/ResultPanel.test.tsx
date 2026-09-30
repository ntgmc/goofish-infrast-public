// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizeResult } from '../../lib/types'
import ResultPanel from './ResultPanel'

afterEach(cleanup)

describe('ResultPanel overview v2', () => {
  it('keeps v1 as the default and shows one shift with larger portraits in v2', async () => {
    const user = userEvent.setup()
    const { container } = render(<ResultPanel result={createThreeShiftResult()} operators={[
      { id: 'char_103_angel', name: '贸易1', own: true, elite: 2, rarity: 6 },
    ]} />)
    expect(screen.getByRole('tab', { name: '总览图' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('贸易2')).toBeInTheDocument()
    expect(screen.getByText('贸易3')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('width', '32')

    await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
    const board = screen.getByRole('region', { name: '总览图 v2' })
    expect(within(board).getAllByRole('tab')).toHaveLength(3)
    expect(within(board).getByText('贸易1')).toBeInTheDocument()
    expect(within(board).queryByText('贸易2')).not.toBeInTheDocument()
    expect(within(board).queryByText('贸易3')).not.toBeInTheDocument()
    const portrait = board.querySelector('img')
    expect(portrait).toHaveAttribute('width', '72')
    fireEvent.error(portrait!)
    expect(board.querySelector('img')).toBeNull()
    expect(within(board).getByText('贸易1')).toBeInTheDocument()

    await user.click(within(board).getByRole('tab', { name: /第2班.*6h/ }))
    expect(within(board).getByText('贸易2')).toBeInTheDocument()
    expect(within(board).queryByText('贸易1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '总览图' }))
    const original = screen.getByRole('tabpanel')
    expect(within(original).getByText('贸易1')).toBeInTheDocument()
    expect(within(original).getByText('贸易2')).toBeInTheDocument()
    expect(within(original).getByText('贸易3')).toBeInTheDocument()
  })

  it('supports arrow, Home and End keys and labels the current shift panel', async () => {
    const user = userEvent.setup()
    render(<ResultPanel result={createThreeShiftResult()} />)
    await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
    const board = within(screen.getByRole('region', { name: '总览图 v2' }))
    const tabs = board.getAllByRole('tab')
    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(board.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[1].id)
    expect(board.getByText('贸易2')).toBeInTheDocument()
    await user.keyboard('{Home}{ArrowLeft}')
    expect(tabs[2]).toHaveFocus()
    expect(board.getByText('贸易3')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(tabs[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(tabs[2]).toHaveFocus()
    expect(tabs[0]).toHaveAttribute('tabindex', '-1')
  })

  it('shows empty rooms and only the current shift Fiammetta target and drone assignment', async () => {
    const user = userEvent.setup()
    const result = createThreeShiftResult()
    result.plans[0].Fiammetta = { enable: true, target: '目标1', order: 'pre' }
    result.plans[1].Fiammetta = { enable: true, target: '目标2', order: 'pre' }
    result.plans[0].drones = { enable: true, room: 'trading', index: 1, order: 'pre', mode: 'auto' }
    render(<ResultPanel result={result} />)
    await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
    const board = within(screen.getByRole('region', { name: '总览图 v2' }))
    expect(board.getByRole('heading', { name: /办公室.*Lv\.3/ })).toBeInTheDocument()
    expect(board.getByText('本班暂无干员安排')).toBeInTheDocument()
    expect(board.getByText('菲亚梅塔 → 目标1')).toBeInTheDocument()
    expect(board.queryByText(/目标2/)).not.toBeInTheDocument()
    expect(board.getByText('自动无人机')).toBeInTheDocument()
    await user.click(board.getByRole('tab', { name: /第2班/ }))
    expect(board.getByText('菲亚梅塔 → 目标2')).toBeInTheDocument()
    expect(board.queryByText(/目标1/)).not.toBeInTheDocument()
    expect(board.queryByText('自动无人机')).not.toBeInTheDocument()
  })

  it.each(['maa_autofill', 'maa_pure_autofill', 'rotation'] as const)(
    'preserves dormitory behavior in %s mode',
    async (mode) => {
      const user = userEvent.setup()
      const result = createPreviewOrderResult()
      result.plans[0].rooms.dormitory.push({ operators: ['宿舍干员2'] })
      if (mode === 'rotation') result.schedule_mode = mode
      else result.dormitory_rule = mode
      render(<ResultPanel result={result} />)
      await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
      const board = within(screen.getByRole('region', { name: '总览图 v2' }))
      if (mode === 'maa_autofill') {
        expect(board.getByText('宿舍干员')).toBeInTheDocument()
        expect(board.getByText('宿舍干员2')).toBeInTheDocument()
      } else if (mode === 'maa_pure_autofill') {
        expect(board.getAllByText('宿舍由 MAA 自动填满')).toHaveLength(1)
        expect(board.queryByText('宿舍干员')).not.toBeInTheDocument()
      } else {
        expect(board.queryByRole('heading', { name: /宿舍/ })).not.toBeInTheDocument()
        expect(board.queryByText('宿舍干员')).not.toBeInTheDocument()
      }
    },
  )

  it('falls back to the first shift for shorter results and handles empty results', async () => {
    const user = userEvent.setup()
    const view = render(<ResultPanel result={createThreeShiftResult()} />)
    await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
    const board = within(screen.getByRole('region', { name: '总览图 v2' }))
    await user.click(board.getByRole('tab', { name: /第3班/ }))
    const shorter = createThreeShiftResult()
    shorter.plans = shorter.plans.slice(0, 1)
    shorter.plans[0].name = ' '
    view.rerender(<ResultPanel result={shorter} />)
    expect(board.getByRole('tab', { name: /第 1 班.*12h/ })).toHaveAttribute('aria-selected', 'true')
    expect(board.getByText('贸易1')).toBeInTheDocument()
    view.rerender(<ResultPanel result={createResult()} />)
    expect(board.queryByRole('tab')).not.toBeInTheDocument()
    expect(board.getByText('暂无可展示的排班总览。')).toBeInTheDocument()
  })
})

function createThreeShiftResult(): OptimizeResult {
  return {
    ...createResult(),
    plans: [12, 6, 6].map((shift_hours, index) => ({
      name: `第${index + 1}班`,
      shift_hours,
      rooms: {
        trading: [{ operators: [`贸易${index + 1}`], level: 3, product: 'LMD', efficiency: 200 }],
        hire: [{ operators: [], level: 3 }],
      },
    })),
  }
}

describe('ResultPanel tabs', () => {
  it.each(['maa', 'rotation'])('shows room levels in preview and data in %s mode', async (scheduleMode) => {
    const user = userEvent.setup()
    const result = createResult()
    result.schedule_mode = scheduleMode
    result.plans = [{ name: 'Plan 1', rooms: {
      trading: [{ operators: ['贸易干员'], level: 1 }],
      manufacture: [{ operators: ['制造干员'], level: 2 }],
    } }]
    render(<ResultPanel result={result} />)
    expect(screen.getByRole('heading', { name: /贸易站.*Lv\.1/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /制造站.*Lv\.2/ })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '数据' }))
    expect(screen.getAllByText('Lv.1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Lv.2').length).toBeGreaterThan(0)
  })
  it.each(['maa', 'rotation', 'variable'] as const)('shows search states outside restricted tabs in %s mode', (scheduleMode) => {
    render(<ResultPanel
      result={{ ...createResult(), schedule_mode: scheduleMode, searched_state_count: 123456 }}
      fullDataAvailable={false}
      previewLimit={{ mode: 'full_rotation_without_export', hidden_room_count: 0, notice: 'Preview' }}
    />)
    expect(screen.getByText('已记录搜索状态：')).toBeInTheDocument()
    expect(screen.getByText('123,456 次')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '数据' })).toBeInTheDocument()
  })

  it.each([0, 1234567890123])('shows the full recorded integer %s', (count) => {
    render(<ResultPanel result={{ ...createResult(), searched_state_count: count }} />)
    expect(screen.getByText(`${count.toLocaleString('zh-CN')} 次`)).toBeInTheDocument()
  })

  it.each([undefined, -1, 1.5, NaN, Infinity])('omits unavailable or invalid search count %s', (count) => {
    render(<ResultPanel result={{ ...createResult(), searched_state_count: count, search_nodes: 42 }} />)
    expect(screen.queryByText('已记录搜索状态：')).not.toBeInTheDocument()
  })

  it('places office cards before dormitory cards in the preview', () => {
    render(<ResultPanel result={createPreviewOrderResult()} />)

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      '办公室',
      '宿舍',
    ])
  })

  it('shows dependency anchors for regular autofill and collapses dormitories only for pure autofill', () => {
    const regular = createPreviewOrderResult()
    regular.dormitory_rule = 'maa_autofill'
    const view = render(<ResultPanel result={regular} />)

    expect(screen.getByText('宿舍干员')).toBeInTheDocument()
    expect(screen.queryByText('宿舍由 MAA 自动填满')).not.toBeInTheDocument()

    view.rerender(
      <ResultPanel result={{ ...createPreviewOrderResult(), dormitory_rule: 'maa_pure_autofill' }} />,
    )
    expect(screen.queryByText('宿舍干员')).not.toBeInTheDocument()
    expect(screen.getByText('宿舍由 MAA 自动填满')).toBeInTheDocument()
    expect(screen.getByText('纯 MAA 自动填满')).toBeInTheDocument()
  })

  it('explains that requested Fiammetta has no target instead of showing it as disabled', () => {
    render(
      <ResultPanel
        result={{
          ...createResult(),
          plans: [{
            name: '班次 1',
            rooms: {},
            Fiammetta: {
              enable: false,
              requested: true,
              available: true,
              target: '',
              order: 'pre',
              status: 'no_target',
            },
          }],
        }}
      />,
    )

    expect(screen.getByText('已启用但无目标')).toBeInTheDocument()
    expect(screen.getByText('优化器未找到收益达到阈值的换心情目标')).toBeInTheDocument()
    expect(screen.queryByText('未启用')).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('tab', { name: '数据' }))
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

  it('shows a read-only data preview when the profile lacks the view capability', async () => {
    render(<ResultPanel result={createResult()} fullDataAvailable={false} />)
    await userEvent.setup().click(screen.getByRole('tab', { name: '数据' }))
    expect(screen.getByRole('button', { name: '下载完整计算 JSON' })).toBeDisabled()
    expect(screen.getAllByText('生成并完成分析后可查看测算数值')).toHaveLength(2)
    expect(screen.getByRole('link', { name: '比较价格与权益' })).toHaveAttribute('href', '/pricing')
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
