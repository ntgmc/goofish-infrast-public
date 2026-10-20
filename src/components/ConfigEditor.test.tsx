// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig } from '../lib/config'
import { copy } from '../copy'
import ConfigEditor from './ConfigEditor'

const { featureSwitches } = vi.hoisted(() => ({ featureSwitches: { one_shift_per_day: false } }))
vi.mock('../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: featureSwitches }) }))
const labels = copy.v2.configEditor
const openSection = (name: string) => userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))
const selectPreset = async (id: string) => {
  await openSection(labels.common)
  const names: Record<string, string> = { '243': '243 均衡', '243-1': '243 搓玉', '333': '333 搓玉', '333-lmd': '333 纯钱' }
  await userEvent.click(screen.getByRole('button', { name: names[id] ?? CONFIG_PRESETS[id].desc }))
}
const selectShift = (id: string) => userEvent.selectOptions(screen.getByRole('combobox', { name: copy.v2.configShiftFrequency }), id)

afterEach(() => { cleanup(); featureSwitches.one_shift_per_day = false })

describe('ConfigEditor facility configuration', () => {
  it('loads confirmed layouts collapsed and requires review again after editing', async () => {
    const config = normalizeConfig(CONFIG_PRESETS['252'])
    config.facility_layout = ['trading_1', 'trading_2', 'manufacture_1', 'manufacture_2', 'manufacture_3', 'manufacture_4', 'manufacture_5', 'power_1', 'power_2']
    const onUpdate = vi.fn((mutate: (next: typeof config) => void) => mutate(config))
    render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    await openSection(labels.rooms)
    expect(screen.getByText('布局已确认', { exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认布局' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '修改布局' }))
    expect(config.facility_layout).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(screen.getByRole('button', { name: '确认并收起' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'B1 · 左 · 设施等级' })).getByRole('button', { name: '2级' }))
    expect(screen.queryByRole('button', { name: '确认并收起' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(config.facility_layout).toBeUndefined()
  })

  it('preserves the facility draft through parent updates and task switches', async () => {
    function Editor() {
      const [config, setConfig] = useState(normalizeConfig(CONFIG_PRESETS['252']))
      return <ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={(mutate) => setConfig((current) => {
        const next = cloneConfig(current); mutate(next); return next
      })} />
    }
    render(<Editor />)
    await userEvent.click(screen.getByRole('button', { name: labels.confirmLayout }))
    await userEvent.click(within(screen.getByRole('group', { name: 'B1 · 左 · 设施等级' })).getByRole('button', { name: '2级' }))
    await openSection(labels.common)
    await openSection(labels.rooms)
    expect(screen.getByRole('button', { name: 'B1 · 左 · 贸易站 · 2级' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(screen.getByRole('alert')).toHaveTextContent('需要 1/3 级')
    await userEvent.click(within(screen.getByRole('group', { name: 'B1 · 左 · 设施等级' })).getByRole('button', { name: '3级' }))
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    await userEvent.click(screen.getByRole('button', { name: '确认并收起' }))
    expect(screen.getByText('布局已确认', { exact: true })).toBeInTheDocument()
  })

  it.each(['252', '252-1', '252-full'])('validates %s room levels before saving', async (preset) => {
    const config = normalizeConfig(CONFIG_PRESETS[preset])
    const onUpdate = vi.fn((mutate: (next: typeof config) => void) => mutate(config))
    render(<ConfigEditor config={config} canEdit={false} validation={{ ok: true }} onUpdate={onUpdate} />)
    await openSection(labels.rooms)
    const levels = screen.getByRole('group', { name: 'B1 · 左 · 设施等级' })
    await userEvent.click(within(levels).getByRole('button', { name: `${config.trading_station_levels![1]}级` }))
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(screen.getByRole('alert')).toHaveTextContent('贸易站')
    expect(config.facility_layout).toBeUndefined()
    await userEvent.click(within(screen.getByRole('group', { name: 'B1 · 中 · 设施等级' })).getByRole('button', { name: '3级' }))
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(config.facility_layout).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: '确认并收起' }))
    expect(config.facility_layout?.slice(0, 2)).toEqual(['trading_2', 'trading_1'])
    expect(new Set(config.facility_layout).size).toBe(9)
  })

  it('selects a facility in the dialog and restores focus to its card', async () => {
    const config = normalizeConfig(CONFIG_PRESETS['252'])
    const onUpdate = vi.fn((mutate: (next: typeof config) => void) => mutate(config))
    render(<ConfigEditor config={config} canEdit={false} validation={{ ok: true }} onUpdate={onUpdate} />)
    await openSection(labels.rooms)
    const card = screen.getByRole('button', { name: 'B1 · 左 · 贸易站 · 3级' })
    await userEvent.click(card)
    const dialog = screen.getByRole('dialog', { name: '选择设施 · B1 · 左' })
    expect(within(dialog).getByRole('button', { name: '贸易站' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(dialog).getByRole('button', { name: '制造站' }))
    expect(config.facility_layout).toBeUndefined()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(card).toHaveFocus()
    expect(screen.getByRole('button', { name: 'B1 · 左 · 制造站 · 3级' })).toBeInTheDocument()
  })

  it('dismisses the facility dialog without changing positions', async () => {
    const onUpdate = vi.fn()
    render(<ConfigEditor config={normalizeConfig(CONFIG_PRESETS['252'])} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    await openSection(labels.rooms)
    const card = screen.getByRole('button', { name: 'B1 · 左 · 贸易站 · 3级' })
    await userEvent.click(card)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(card).toHaveFocus()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('keeps read-only tasks browsable while preventing every configuration change', async () => {
    const onUpdate = vi.fn()
    render(<ConfigEditor config={normalizeConfig(CONFIG_PRESETS['243'])} canEdit readOnly validation={{ ok: true }} onUpdate={onUpdate} />)
    expect(screen.getByRole('button', { name: '243 均衡' })).toBeDisabled()
    await openSection(labels.strategy)
    expect(screen.getByRole('switch', { name: '无人机' })).toBeDisabled()
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('ConfigEditor shift patterns', () => {
  it.each([8, 12])('restricts free profiles to fixed %s-hour shifts', async (hours) => {
    featureSwitches.one_shift_per_day = true
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: hours === 8 ? [12, 12, 12] : [8, 8, 8] })
    const onUpdate = vi.fn()
    render(<ConfigEditor config={config} canEdit={false} canEditIntermediateInventory canEditFixedShiftHours validation={{ ok: true }} onUpdate={onUpdate} />)
    const select = screen.getByRole('combobox', { name: copy.v2.configShiftFrequency })
    for (const id of ['24x3', 'variable', 'custom']) expect(select.querySelector(`option[value="${id}"]`)).toBeDisabled()
    await selectShift(hours === 8 ? '8x3' : '12x3')
    const next = cloneConfig(config)
    onUpdate.mock.calls[0][0](next)
    expect(next.shift_hours).toEqual([hours, hours, hours])
  })

  it('keeps dormitory and Fiammetta policies independent', async () => {
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    const view = render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    await openSection(labels.strategy)
    const rule = screen.getByRole('combobox', { name: '宿舍规则' })
    expect(rule).toHaveValue('fixed')
    await userEvent.selectOptions(rule, 'maa_pure_autofill')
    const next = cloneConfig(config)
    onUpdate.mock.lastCall![0](next)
    expect(next.dormitory_rule).toBe('maa_pure_autofill')
    expect(next.Fiammetta?.enable).toBe(true)
    view.rerender(<ConfigEditor config={next} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    expect(screen.getByRole('switch', { name: '菲亚梅塔' })).toBeEnabled()
    expect(screen.getByText(/过滤相关生产组合/)).toBeInTheDocument()
    expect(screen.getByText(/菲亚梅塔仍可执行换心情/)).toBeInTheDocument()
  })

  it('applies a non-uniform 24-hour MAA pattern and retains the custom draft across tasks', async () => {
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    await selectShift('custom')
    const input = screen.getByLabelText('MAA 换班间隔')
    await userEvent.clear(input)
    await userEvent.type(input, '6-12-6')
    await openSection(labels.inventory)
    await openSection(labels.common)
    expect(screen.getByLabelText('MAA 换班间隔')).toHaveValue('6-12-6')
    await userEvent.click(screen.getByRole('button', { name: '应用间隔' }))
    const next = cloneConfig(config)
    onUpdate.mock.lastCall![0](next)
    expect(next.shift_hours).toEqual([12, 6, 6])
    expect(next.schedule_mode).toBe('maa')
    expect(next.variable_shift_schedule).toEqual(expect.objectContaining({ enable: false, enabled: false }))
  })

  it.each([
    ['12-12', '请输入 3 到 6 班'],
    ['24-24-24', '一天一换已停用'],
  ])('rejects unsupported custom pattern %s', async (hours, message) => {
    const onUpdate = vi.fn()
    render(<ConfigEditor config={normalizeConfig(CONFIG_PRESETS['243'])} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    await selectShift('custom')
    const input = screen.getByLabelText('MAA 换班间隔')
    await userEvent.clear(input)
    await userEvent.type(input, hours)
    await userEvent.click(screen.getByRole('button', { name: '应用间隔' }))
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('applies fixed 12-hour shifts', async () => {
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    await selectShift('12x3')
    const next = cloneConfig(config)
    onUpdate.mock.lastCall![0](next)
    expect(next.shift_hours).toEqual([12, 12, 12])
    expect(next.Fiammetta?.enable).toBe(true)
  })

  it('disables one shift per day and supports automatic variable shifts', async () => {
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    expect(screen.getByRole('option', { name: labels.oneShiftDisabled })).toBeDisabled()
    await selectShift('variable')
    const next = cloneConfig(config)
    onUpdate.mock.lastCall![0](next)
    expect(next.schedule_mode).toBe('variable')
    expect(next.Fiammetta?.enable).toBe(false)
    expect(next.variable_shift_schedule).toEqual(expect.objectContaining({ enable: true, enabled: true, max_shifts: 4, shift_step_minutes: 60, min_low_hours: 3, beam_width: 4 }))
  })

  it.each(['preset', 'custom'])('allows one shift per day through %s when enabled', async (selection) => {
    featureSwitches.one_shift_per_day = true
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    if (selection === 'custom') {
      await selectShift('custom')
      const input = screen.getByLabelText('MAA 换班间隔')
      await userEvent.clear(input)
      await userEvent.type(input, '24-24-24')
      await userEvent.click(screen.getByRole('button', { name: '应用间隔' }))
    } else await selectShift('24x3')
    expect(onUpdate).toHaveBeenCalledOnce()
    const next = cloneConfig(config)
    onUpdate.mock.lastCall![0](next)
    expect(next.shift_hours).toEqual([24, 24, 24])
    expect(next.Fiammetta?.enable).toBe(false)
  })

  it('leaves automatic mode when applying a custom pattern', async () => {
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], schedule_mode: 'variable', variable_shift_schedule: { enable: true } })
    const onUpdate = vi.fn()
    render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    expect(screen.getByRole('combobox', { name: copy.v2.configShiftFrequency })).toHaveValue('variable')
    await selectShift('custom')
    await userEvent.click(screen.getByRole('button', { name: '应用间隔' }))
    const next = cloneConfig(config)
    onUpdate.mock.lastCall![0](next)
    expect(next.schedule_mode).toBe('maa')
    expect(next.variable_shift_schedule).toEqual(expect.objectContaining({ enable: false, enabled: false }))
  })

  it('disables Fiammetta for unsupported shift patterns', async () => {
    render(<ConfigEditor config={normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [10, 10, 4] })} canEdit validation={{ ok: true }} onUpdate={vi.fn()} />)
    await openSection(labels.strategy)
    expect(screen.getByRole('switch', { name: '菲亚梅塔' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: '菲亚梅塔' })).not.toBeChecked()
  })
})

describe('ConfigEditor inventory and presets', () => {
  function setup(initial = normalizeConfig(CONFIG_PRESETS['243']), props: Partial<ComponentProps<typeof ConfigEditor>> = {}) {
    let latest = initial
    function Editor() {
      const [config, setConfig] = useState(initial)
      return <ConfigEditor canEdit canSelectPreset validation={{ ok: true }} {...props} config={config} onUpdate={(mutate) => setConfig((current) => {
        const next = cloneConfig(current); mutate(next); latest = next; return next
      })} />
    }
    render(<Editor />)
    return () => latest
  }

  it.each(['efficiency', 'inventory_balance'])('preserves %s through stock and preset changes', async (strategy) => {
    const latest = setup()
    await openSection(labels.strategy)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '无人机自动模式' }), strategy)
    await openSection(labels.inventory)
    const stock = screen.getByRole('spinbutton', { name: '赤金' })
    await userEvent.clear(stock)
    await userEvent.type(stock, '100')
    await selectPreset('243-1')
    expect(latest().drones?.auto_strategy).toBe(strategy)
    expect(latest().intermediate_inventory?.['Pure Gold']).toBe(100)
    expect(latest().drones?.auto_target_product).toBeUndefined()
  })

  it.each([true, false])('preserves an explicit balance choice with canEdit=%s', async (canEdit) => {
    const latest = setup(normalizeConfig({ ...CONFIG_PRESETS['243'], intermediate_inventory: { 'Pure Gold': 50 }, auto_balance_source: 'intermediate_inventory' }), { canEdit, canEditIntermediateInventory: true })
    await openSection(labels.inventory)
    const balance = screen.getByRole('switch', { name: '按库存自动调整产物数量' })
    expect(balance).toHaveProperty('checked', !canEdit)
    await userEvent.click(balance)
    const stock = screen.getByRole('spinbutton', { name: '赤金' })
    await userEvent.clear(stock)
    await userEvent.type(stock, '0')
    await selectPreset('243-1')
    expect(latest().allow_product_rebalance).toBe(canEdit)
    expect(latest().intermediate_inventory?.['Pure Gold']).toBe(0)
  })

  it('keeps room and product counters coupled to the layout', async () => {
    const latest = setup()
    await openSection(labels.rooms)
    await userEvent.click(screen.getByRole('button', { name: '增加贸易站' }))
    expect(latest()).toMatchObject({ layout: '3-3-3', trading_stations_count: 3, manufacturing_stations_count: 3 })
    await userEvent.click(screen.getByRole('button', { name: '增加龙门币' }))
    expect(latest().product_requirements.trading_stations.LMD).toBe(4)
    expect(screen.getByRole('button', { name: '减少合成玉' })).toBeDisabled()
  })

  it.each(['252', '252-1', '252-full'])('applies %s, opens required layout review and clears levels when returning to 243', async (id) => {
    const latest = setup(normalizeConfig({ ...CONFIG_PRESETS['243'], optimization_mode: 'fast', optimizer_search: { optimization_mode: 'fast', beam: true } }))
    await selectPreset(id)
    expect(screen.getByRole('tab', { name: /房间/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '确认布局' })).toBeInTheDocument()
    expect(latest().trading_station_levels).toEqual(CONFIG_PRESETS[id].trading_station_levels)
    expect(latest().manufacturing_station_levels).toEqual(CONFIG_PRESETS[id].manufacturing_station_levels)
    expect(latest().optimization_mode).toBeUndefined()
    expect(latest().optimizer_search).toBeUndefined()
    expect(within(screen.getByRole('region', { name: '产物数量' })).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByText(/游戏内这些设施无法降级/)).toBeInTheDocument()
    await openSection(labels.strategy)
    await userEvent.click(screen.getByRole('switch', { name: '无人机' }))
    expect(latest().drones?.enable).toBe(false)
    await selectPreset('243')
    expect(latest().trading_station_levels).toBeUndefined()
    expect(latest().manufacturing_station_levels).toBeUndefined()
    expect(latest().layout).toBe('2-4-3')
  })

  it('does not return to rooms when delayed preset focus runs after switching tasks', async () => {
    setup()
    const callbacks: FrameRequestCallback[] = []
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => callbacks.push(callback))
    try {
      await selectPreset('252')
      expect(callbacks).toHaveLength(1)
      await openSection(labels.strategy)
      act(() => callbacks.forEach((callback) => callback(performance.now())))
      expect(screen.getByRole('tab', { name: labels.strategy })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('combobox', { name: '宿舍规则' })).toBeInTheDocument()
    } finally {
      frame.mockRestore()
    }
  })

  it('keeps limited configuration options available with 252', async () => {
    const latest = setup(undefined, { canEdit: false, canEditIntermediateInventory: true })
    await selectPreset('252')
    await openSection(labels.strategy)
    expect(screen.getByRole('combobox', { name: '宿舍规则' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: '无人机' })).toBeDisabled()
    await openSection(labels.common)
    await userEvent.click(screen.getByRole('button', { name: '游戏内轮换' }))
    expect(latest().schedule_mode).toBe('rotation')
    expect(latest().trading_station_levels).toEqual([3, 1])
    await openSection(labels.strategy)
    expect(screen.getByRole('combobox', { name: '宿舍规则' })).toBeDisabled()
  })
})
