// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizeResult } from '../../lib/types'
import ResultPanel from './ResultPanel'

afterEach(cleanup)

describe('manual schedule access and recovery', () => {
  it('uses unlocked skill upgrades for candidate effects and facility filtering while preserving locked assignments', async () => {
    const user = userEvent.setup()
    const result = createThreeShiftResult()
    result.plans[0].rooms.trading[0].operators = ['能天使', '德克萨斯']
    result.plans[0].Fiammetta = { enable: true, target: '德克萨斯', order: 'pre' }
    const operators = [
      { id: 'char_103_angel', name: '能天使', elite: 0, level: 40 },
      { id: 'char_102_texas', name: '德克萨斯', elite: 2, level: 90 },
      { id: 'char_002_amiya', name: '阿米娅', elite: 2, level: 80 },
      { id: 'char_285_medic2', name: 'Lancet-2', elite: 0, level: 20 },
      { id: 'char_151_myrtle', name: '桃金娘', elite: 2, level: 80 },
    ].map((operator) => ({ ...operator, own: true, rarity: 6 }))
    const props = { result, operators, manualEditProfile: { id: 'skills', kind: 'cdk' as const, permission: 'advanced' as const } }
    const view = render(<ResultPanel {...props} />)
    await user.click(screen.getByRole('tab', { name: '手动排班' }))
    const editor = within(await screen.findByRole('region', { name: '手动调整排班' }))
    await user.hover(editor.getByRole('button', { name: /编辑 贸易站.*能天使/ }).querySelector('[data-operator-name]')!)
    const preview = await screen.findByRole('tooltip')
    expect(within(preview).getByText('企鹅物流·α')).toBeInTheDocument()
    expect(within(preview).getByText(/订单获取效率\+20%/)).toBeInTheDocument()
    expect(within(preview).getByText(/未解锁/)).toBeInTheDocument()
    await user.click(editor.getByRole('button', { name: /编辑 贸易站.*空位 3/ }))
    const dialog = within(screen.getByRole('dialog'))
    const grid = within(dialog.getByLabelText('选择进驻干员'))
    const candidate = await grid.findByRole('button', { name: '能天使' })
    expect(within(candidate).getByRole('img', { name: '企鹅物流·α' })).toBeInTheDocument()
    expect(within(candidate).getByText(/订单获取效率\+20%/)).toBeInTheDocument()
    expect(grid.queryByRole('button', { name: '德克萨斯' })).not.toBeInTheDocument()
    expect(grid.queryByRole('button', { name: '阿米娅' })).not.toBeInTheDocument()
    view.rerender(<ResultPanel {...props} operators={operators.map((operator) => operator.name === '能天使' ? { ...operator, elite: 2 } : operator)} />)
    expect(await within(candidate).findByRole('img', { name: '物流专家' })).toBeInTheDocument()
    expect(within(candidate).getByText(/订单获取效率\+35%/)).toBeInTheDocument()
    expect(within(candidate).queryByRole('img', { name: '企鹅物流·α' })).not.toBeInTheDocument()
    act(() => candidate.focus())
    fireEvent.pointerOut(candidate, { relatedTarget: document.body, pointerType: 'mouse' })
    expect(within(await screen.findByRole('tooltip')).getByText('物流专家')).toBeInTheDocument()
    expect(candidate).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.selectOptions(dialog.getByRole('combobox', { name: '技能适用设施' }), 'dormitory')
    expect(await grid.findByRole('button', { name: '阿米娅' })).toBeInTheDocument()
    expect(grid.queryByRole('button', { name: 'Lancet-2' })).not.toBeInTheDocument()
    await user.selectOptions(dialog.getByRole('combobox', { name: '技能适用设施' }), '')
    expect(await grid.findByRole('button', { name: 'Lancet-2' })).toBeInTheDocument()
    await user.click(grid.getByRole('button', { name: '阿米娅' }))
    await user.click(dialog.getByRole('button', { name: '完成' }))
    await user.click(editor.getByRole('button', { name: '保存本地草稿' }))
    expect(JSON.parse(localStorage.getItem('manual-schedule:skills')!).plans[0].rooms.trading[0]).toEqual(['能天使', '德克萨斯', '阿米娅'])
    expect(result.plans[0].rooms.trading[0].operators).toEqual(['能天使', '德克萨斯'])
    localStorage.removeItem('manual-schedule:skills')
  })

  it('keeps later candidates reachable by keyboard, scrolling and search and saves their assignment', async () => {
    const user = userEvent.setup()
    const result = createThreeShiftResult()
    const operators = Array.from({ length: 70 }, (_, index) => ({
      id: `candidate-${index}`, name: index === 69 ? '阿米娅' : `候选${index + 1}`, own: true, elite: 2, rarity: 6,
    }))
    render(<ResultPanel result={result} operators={operators}
      manualEditProfile={{ id: 'large-picker', kind: 'cdk', permission: 'advanced' }} />)
    await user.click(screen.getByRole('tab', { name: '手动排班' }))
    const editor = within(await screen.findByRole('region', { name: '手动调整排班' }))
    await user.click(editor.getByRole('button', { name: /编辑 贸易站.*空位 2/ }))
    const dialog = within(screen.getByRole('dialog'))
    const grid = dialog.getByLabelText('选择进驻干员')
    await user.selectOptions(dialog.getByRole('combobox', { name: '技能适用设施' }), '')
    const visible = within(grid).getAllByRole('button')
    const lastVisible = visible[visible.length - 1]
    act(() => lastVisible.focus())
    await user.tab()
    expect(document.activeElement).not.toBe(lastVisible)
    expect(grid).toContainElement(document.activeElement as HTMLElement)
    fireEvent.scroll(grid)
    await user.click(within(grid).getByRole('button', { name: '阿米娅' }))
    await user.type(dialog.getByRole('searchbox'), 'amy')
    await waitFor(() => expect(within(grid).queryByRole('button', { name: '候选1' })).not.toBeInTheDocument())
    expect(within(grid).getByRole('button', { name: '阿米娅' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(dialog.getByRole('button', { name: '完成' }))
    await user.click(editor.getByRole('button', { name: '保存本地草稿' }))
    expect(JSON.parse(localStorage.getItem('manual-schedule:large-picker')!).plans[0].rooms.trading[0]).toEqual(['贸易1', '阿米娅', ''])
    expect(result.plans[0].rooms.trading[0].operators).toEqual(['贸易1'])
    localStorage.removeItem('manual-schedule:large-picker')
  })

  it('debounces the latest pinyin query and waits for Chinese composition to finish', async () => {
    const user = userEvent.setup()
    const operators = ['能天使', '阿米娅', '德克萨斯'].map((name) => ({ id: name, name, own: true, elite: 2, rarity: 6 }))
    render(<ResultPanel result={createThreeShiftResult()} operators={operators}
      manualEditProfile={{ id: 'search-profile', kind: 'cdk', permission: 'advanced' }} />)
    await user.click(screen.getByRole('tab', { name: '手动排班' }))
    const editor = await screen.findByRole('region', { name: '手动调整排班' })
    await user.click(within(editor).getByRole('button', { name: /编辑 贸易站.*空位 2/ }))
    const dialog = within(screen.getByRole('dialog'))
    const input = dialog.getByRole('searchbox')
    await user.selectOptions(dialog.getByRole('combobox', { name: '技能适用设施' }), '')
    vi.useFakeTimers()
    try {
      fireEvent.change(input, { target: { value: 'n' } })
      act(() => { vi.advanceTimersByTime(150) })
      fireEvent.change(input, { target: { value: 'nts' } })
      act(() => { vi.advanceTimersByTime(150) })
      expect(dialog.getByRole('button', { name: '阿米娅' })).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(50) })
      expect(dialog.getByRole('button', { name: '能天使' })).toBeInTheDocument()
      expect(dialog.queryByRole('button', { name: '阿米娅' })).not.toBeInTheDocument()

      fireEvent.change(input, { target: { value: 'AMiY' } })
      act(() => { vi.advanceTimersByTime(200) })
      expect(dialog.getByRole('button', { name: '阿米娅' })).toBeInTheDocument()
      expect(dialog.queryByRole('button', { name: '能天使' })).not.toBeInTheDocument()

      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: '能天' } })
      act(() => { vi.advanceTimersByTime(300) })
      expect(dialog.getByRole('button', { name: '阿米娅' })).toBeInTheDocument()
      fireEvent.compositionEnd(input)
      act(() => { vi.advanceTimersByTime(200) })
      expect(dialog.getByRole('button', { name: '能天使' })).toBeInTheDocument()
      expect(dialog.queryByRole('button', { name: '阿米娅' })).not.toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })

  it('opens advanced editing, locks targets, edits and restores a separate draft', async () => {
    localStorage.clear()
    const user = userEvent.setup()
    const result = createThreeShiftResult()
    result.plans[0].Fiammetta = { enable: true, target: '贸易1', order: 'pre' }
    result.plans[0].drones = { enable: true, room: 'trading', index: 1, order: 'pre' }
    const operators = ['贸易1', '贸易2', '贸易3', '新干员'].map((name) => ({ id: name, name, own: true, elite: 2, rarity: 6 }))
    const profile = { id: 'manual-profile', kind: 'cdk' as const, permission: 'advanced' as const }
    const view = render(<ResultPanel result={result} operators={operators} manualEditProfile={profile} />)
    await user.click(screen.getByRole('tab', { name: '手动排班' }))
    const editor = await screen.findByRole('region', { name: '手动调整排班' })
    expect(within(editor).getByText(/修改干员或无人机目标/)).toBeInTheDocument()
    expect(within(editor).queryByText('200.0%')).not.toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: /编辑 贸易站.*空位 3/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '贸易1' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '贸易1' }).querySelector('img')).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: '空位 3' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(dialog).getByRole('button', { name: '新干员' }))
    await user.click(within(dialog).getByRole('button', { name: '完成' }))
    expect(within(editor).getByText('新干员')).toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: /编辑 贸易站.*新干员/ }))
    const reopened = screen.getByRole('dialog')
    expect(within(reopened).getAllByRole('button', { name: '新干员' })[0]).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(reopened).getByRole('button', { name: '完成' }))
    await user.click(within(editor).getByRole('button', { name: '保存本地草稿' }))
    expect(JSON.parse(localStorage.getItem('manual-schedule:manual-profile')!).plans[0].rooms.trading[0]).toEqual(['贸易1', '', '新干员'])
    expect(result.plans[0].rooms.trading[0].operators).toEqual(['贸易1'])
    await user.click(screen.getByRole('tab', { name: '详情' }))
    const detail = within(screen.getByRole('tabpanel'))
    expect(detail.getByText('贸易1')).toBeInTheDocument()
    expect(detail.queryByText('新干员')).not.toBeInTheDocument()
    expect(detail.getAllByText('200.0%').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
    await user.click(screen.getByRole('tab', { name: '手动排班' }))
    expect(within(editor).getByText('新干员')).toBeInTheDocument()
    view.unmount()
    render(<ResultPanel result={result} operators={operators} manualEditProfile={profile} />)
    await user.click(screen.getByRole('tab', { name: '手动排班' }))
    const restored = await screen.findByRole('region', { name: '手动调整排班' })
    await user.click(within(restored).getByRole('button', { name: '恢复已保存草稿' }))
    expect(within(restored).getByText('新干员')).toBeInTheDocument()
    localStorage.clear()
  })

  it.each([
    ['free_preview', 'advanced'],
    ['cdk', 'recommended'],
    ['cdk', 'growth'],
  ] as const)('denies manual editing for %s / %s', (kind, permission) => {
    render(<ResultPanel result={createThreeShiftResult()} manualEditProfile={{ id: 'limited', kind, permission }} />)
    expect(screen.queryByRole('tab', { name: '手动排班' })).not.toBeInTheDocument()
  })

  it('denies editing a projected preview result even when the profile has advanced access', () => {
    const result = createThreeShiftResult()
    result.preview_limit = { hidden_room_count: 1, notice: 'preview' }
    render(<ResultPanel result={result} manualEditProfile={{ id: 'advanced', kind: 'cdk', permission: 'advanced' }} />)
    expect(screen.queryByRole('tab', { name: '手动排班' })).not.toBeInTheDocument()
  })
})

describe('ResultPanel overview v2', () => {
  it('toggles profession badges across shifts and exports while leaving v1 unchanged', async () => {
    const user = userEvent.setup()
    const result = createThreeShiftResult()
    result.plans[0].rooms.trading[0].operators = ['能天使', '德克萨斯', '未知干员']
    result.plans[1].rooms.trading[0].operators = ['阿米娅']
    const exporter = await import('./schedule-image')
    const download = vi.spyOn(exporter, 'downloadScheduleImage').mockResolvedValue()
    try {
      render(<ResultPanel result={result} operators={[
        { id: 'char_103_angel', name: '能天使', own: true, elite: 2, rarity: 6 },
      ]} />)
      await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
      const option = screen.getByRole('checkbox', { name: '显示干员职业' })
      const board = within(screen.getByRole('region', { name: '总览图 v2' }))
      expect(option).not.toBeChecked()
      expect(board.queryByRole('img', { name: '狙击' })).not.toBeInTheDocument()
      await user.click(option)
      expect(board.getByRole('img', { name: '狙击' })).toHaveAttribute('src', '/operator-professions/SNIPER.png')
      expect(board.getByRole('img', { name: '先锋' })).toHaveAttribute('src', '/operator-professions/PIONEER.png')
      expect(board.getAllByRole('img')).toHaveLength(2)
      await user.click(board.getByRole('tab', { name: /第2班/ }))
      expect(board.getByRole('img', { name: '术师' })).toHaveAttribute('src', '/operator-professions/CASTER.png')
      await user.click(screen.getByRole('button', { name: '导出当前班次' }))
      await waitFor(() => expect(download).toHaveBeenLastCalledWith(expect.objectContaining({ version: 'v2', planIndex: 1, showProfession: true })))
      await user.click(screen.getByRole('button', { name: '导出全部班次长图' }))
      await waitFor(() => expect(download).toHaveBeenLastCalledWith(expect.objectContaining({ version: 'v2', planIndex: undefined, showProfession: true })))
      await user.click(screen.getByRole('tab', { name: '总览图' }))
      expect(screen.queryByRole('checkbox', { name: '显示干员职业' })).not.toBeInTheDocument()
      expect(screen.queryByRole('img', { name: '狙击' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
      expect(screen.getByRole('checkbox', { name: '显示干员职业' })).toBeChecked()
      await user.click(screen.getByRole('checkbox', { name: '显示干员职业' }))
      expect(screen.queryByRole('img', { name: '术师' })).not.toBeInTheDocument()
    } finally {
      download.mockRestore()
    }
  })

  it('shows both product icons beside the v1 label when a facility changes product between shifts', () => {
    const result = createThreeShiftResult()
    result.plans[1].rooms.trading[0].product = 'Orundum'
    render(<ResultPanel result={result} />)
    const product = screen.getByText('龙门币 / 合成玉').parentElement!
    const icons = product.querySelectorAll('img')
    expect(icons).toHaveLength(2)
    expect(icons[0]).toHaveAttribute('src', '/assets/products/GOLD.png')
    expect(icons[1]).toHaveAttribute('src', '/assets/products/DIAMOND_SHD.png')
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('贸易1')).toBeInTheDocument()
    expect(screen.getByText('贸易2')).toBeInTheDocument()
    expect(screen.getByText('贸易3')).toBeInTheDocument()
  })

  it('keeps v1 as the default and shows one shift with larger portraits in v2', async () => {
    const user = userEvent.setup()
    const { container } = render(<ResultPanel result={createThreeShiftResult()} operators={[
      { id: 'char_103_angel', name: '贸易1', own: true, elite: 2, rarity: 6 },
    ]} />)
    expect(screen.getByRole('tab', { name: '总览图' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('贸易2')).toBeInTheDocument()
    expect(screen.getByText('贸易3')).toBeInTheDocument()
    expect(container.querySelector('img[src^="/webp96/"]')).toHaveAttribute('width', '32')
    expect(container.querySelector('img[src="/assets/products/GOLD.png"]')).toHaveAttribute('width', '16')

    await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
    const board = screen.getByRole('region', { name: '总览图 v2' })
    expect(within(board).getAllByRole('tab')).toHaveLength(3)
    expect(within(board).getByText('贸易1')).toBeInTheDocument()
    expect(within(board).queryByText('贸易2')).not.toBeInTheDocument()
    expect(within(board).queryByText('贸易3')).not.toBeInTheDocument()
    const productIcon = within(board).getByText('龙门币').parentElement?.querySelector('img')
    expect(productIcon).toHaveAttribute('src', '/assets/products/GOLD.png')
    expect(productIcon).toHaveAttribute('width', '20')
    expect(productIcon).toHaveAttribute('aria-hidden', 'true')
    const portrait = board.querySelector('img[src^="/webp96/"]')
    expect(portrait).toHaveAttribute('width', '72')
    fireEvent.error(portrait!)
    expect(board.querySelector('img[src^="/webp96/"]')).toBeNull()
    expect(within(board).getByText('龙门币')).toBeInTheDocument()
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

  it.each(['maa_autofill', 'maa_pure_autofill'] as const)('marks explicitly placed dormitory recovery support in %s', async (mode) => {
    const user = userEvent.setup()
    const result = createPreviewOrderResult()
    result.dormitory_rule = mode
    result.plans[0].rooms.dormitory = [{
      operators: ['杜林', '恢复目标'], recovery_support_operators: ['杜林'], autofill: false,
    }]
    render(<ResultPanel result={result} />)
    await user.click(screen.getByRole('tab', { name: '总览图 v2' }))
    const board = within(screen.getByRole('region', { name: '总览图 v2' }))
    expect(board.getByText('杜林')).toBeInTheDocument()
    expect(board.getByText('恢复目标')).toBeInTheDocument()
    expect(board.getByRole('img', { name: '恢复支援' })).toHaveAttribute('src', '/building-skills/bskill_dorm_all&one1.png')
    expect(board.getByRole('img', { name: '恢复支援' })).toHaveAttribute('title', '专门进驻宿舍，加速同宿舍干员恢复心情')
    expect(board.queryByText('恢复支援')).not.toBeInTheDocument()
    expect(board.queryByText('宿舍由 MAA 自动填满')).not.toBeInTheDocument()
  })

  it('shows cross-station markers from optimizer fields in both overview boards', async () => {
    const user = userEvent.setup()
    const result = createPreviewOrderResult()
    result.plans[0].rooms.hire = [{ operators: ['凯尔希·思衡托'], cross_station_operators: ['凯尔希·思衡托'] }]
    result.plans[0].rooms.processing = [{ operators: ['煌'], cross_station_operators: ['煌'] }]
    result.plans[0].rooms.dormitory = [{
      operators: ['逻各斯', '乌尔比安'],
      cross_station_operators: ['逻各斯', '乌尔比安'],
      recovery_support_operators: ['逻各斯'],
    }]
    result.plans[0].rooms.trading = [{ operators: ['深巡', '能天使'], cross_station_operators: ['深巡'] }]
    result.plans[0].rooms.control = [{ operators: ['阿米娅'] }]
    render(<ResultPanel result={result} />)
    for (const tab of ['总览图', '总览图 v2']) {
      await user.click(screen.getByRole('tab', { name: tab }))
      const board = within(screen.getByRole('tabpanel', { name: tab }))
      expect(board.getAllByRole('img', { name: '跨站联动' })).toHaveLength(5)
      for (const name of ['凯尔希·思衡托', '煌', '逻各斯', '乌尔比安', '深巡']) {
        const tile = board.getByText(name, { selector: 'span' }).closest('[data-operator-name]')!
        expect(within(tile as HTMLElement).getByRole('img', { name: '跨站联动' }))
          .toHaveAttribute('title', '与其他房间的干员配合生效，换班时请一并保留配套安排')
      }
      const support = board.getByText('逻各斯').closest('[data-operator-name]')!
      expect(within(support as HTMLElement).getByRole('img', { name: '恢复支援' })).toBeInTheDocument()
    }
  })

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
  it('identifies opened manual history and its potential mood cycle failure', () => {
    render(<ResultPanel result={{ ...createThreeShiftResult(), schedule_source: 'manual' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('手动排班')
    expect(screen.getByRole('status')).toHaveTextContent('心情可能无法持续循环')
  })

  it.each(['maa', 'rotation'] as const)('keeps product icons and labels together in %s details', async (mode) => {
    const result = createThreeShiftResult()
    result.schedule_mode = mode
    result.plans = result.plans.slice(0, 2)
    result.plans[1].rooms.trading[0].product = 'Orundum'
    render(<ResultPanel result={result} />)
    await userEvent.setup().click(screen.getByRole('tab', { name: mode === 'maa' ? '详情' : '预设队列' }))
    const panel = screen.getByRole('tabpanel')
    const icons = panel.querySelectorAll('img[src^="/assets/products/"]')
    expect(icons).toHaveLength(mode === 'maa' ? 4 : 2)
    expect(panel.querySelector('img[src="/assets/products/GOLD.png"]')).toBeInTheDocument()
    expect(panel.querySelector('img[src="/assets/products/DIAMOND_SHD.png"]')).toBeInTheDocument()
    expect(within(panel).getAllByText(mode === 'maa' ? '龙门币' : '龙门币 / 合成玉').length).toBeGreaterThan(0)
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

  it('shows free-preview totals without detailed sanity calculations or exports', async () => {
    const result = createResult()
    result.preview_limit = { hidden_room_count: 0, notice: 'preview' }
    result.daily_production = { manufacturing: { 'Pure Gold': 100 }, trading: { LMD: 50000 }, consumption: { 'Pure Gold': 100 } }
    render(<ResultPanel result={result} fullDataAvailable={false} />)
    await userEvent.setup().click(screen.getByRole('tab', { name: '数据' }))
    expect(await screen.findByText('50,000')).toBeInTheDocument()
    expect(screen.getByText(/赤金 100/)).toBeInTheDocument()
    expect(screen.queryByText(/制造折算/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载完整计算数据' })).not.toBeInTheDocument()
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
