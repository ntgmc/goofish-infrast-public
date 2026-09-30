// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig } from '../lib/config'
import ConfigEditor from './ConfigEditor'

afterEach(cleanup)

describe('ConfigEditor facility configuration', () => {
  it('loads confirmed layouts collapsed and requires review again after editing', async () => {
    const config = normalizeConfig(CONFIG_PRESETS['252'])
    config.facility_layout = ['trading_1', 'trading_2', 'manufacture_1', 'manufacture_2', 'manufacture_3', 'manufacture_4', 'manufacture_5', 'power_1', 'power_2']
    const onUpdate = vi.fn((mutate: (next: typeof config) => void) => mutate(config))
    render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
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
  it('invalidates a confirmed layout while preserving the draft through parent updates', async () => {
    function Editor() {
      const [config, setConfig] = useState(normalizeConfig(CONFIG_PRESETS['252']))
      return <ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={(mutate) => setConfig((current) => {
        const next = structuredClone(current)
        mutate(next)
        return next
      })} />
    }
    render(<Editor />)
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(screen.getByText('待确认', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('数量与等级检查通过')
    await userEvent.click(screen.getByRole('button', { name: '确认并收起' }))
    expect(screen.getByText('已确认', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('布局已确认', { exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认布局' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'B1 · 左 · 设施等级' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '修改布局' }))
    expect(screen.getByText('待确认', { exact: true })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'B1 · 左 · 设施等级' })).getByRole('button', { name: '2级' }))
    expect(screen.getByText('待确认', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'B1 · 左 · 贸易站 · 2级' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(screen.getByRole('alert')).toHaveTextContent('需要 1/3 级')
    expect(screen.getByText('待确认', { exact: true })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'B1 · 左 · 设施等级' })).getByRole('button', { name: '3级' }))
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    await userEvent.click(screen.getByRole('button', { name: '确认并收起' }))
    expect(screen.getByText('已确认', { exact: true })).toBeInTheDocument()
  })
  it.each(['252', '252-1', '252-full'])('allows invalid draft levels and checks the %s layout on confirmation', async (preset) => {
    const config = normalizeConfig(CONFIG_PRESETS[preset])
    const onUpdate = vi.fn((mutate: (next: typeof config) => void) => mutate(config))
    render(<ConfigEditor config={config} canEdit={false} validation={{ ok: true }} onUpdate={onUpdate} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const levels = screen.getByRole('group', { name: 'B1 · 左 · 设施等级' })
    expect(within(levels).getByRole('button', { name: '3级' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(levels).getByRole('button', { name: `${config.trading_station_levels![1]}级` }))
    expect(config.facility_layout).toBeUndefined()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
    const view = render(<ConfigEditor config={config} canEdit={false} validation={{ ok: true }} onUpdate={onUpdate} />)
    const card = screen.getByRole('button', { name: 'B1 · 左 · 贸易站 · 3级' })
    await userEvent.click(card)
    const dialog = screen.getByRole('dialog', { name: '选择设施 · B1 · 左' })
    expect(within(dialog).getByRole('button', { name: '贸易站' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(dialog).getByRole('button', { name: '制造站' }))
    expect(config.facility_layout).toBeUndefined()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(card).toHaveFocus()
    view.rerender(<ConfigEditor config={config} canEdit={false} validation={{ ok: true }} onUpdate={onUpdate} />)
    expect(screen.getByRole('button', { name: 'B1 · 左 · 制造站 · 3级' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'B1 · 右 · 制造站 · 2级' })).toBeInTheDocument()
    const levels = screen.getByRole('group', { name: 'B1 · 左 · 设施等级' })
    expect(within(levels).getByRole('button', { name: '1级' })).toBeEnabled()
    await userEvent.click(within(levels).getByRole('button', { name: '1级' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(screen.getByRole('alert')).toHaveTextContent('制造站')
    expect(config.facility_layout).toBeUndefined()
  })
  it('dismisses the facility dialog without changing positions', async () => {
    const onUpdate = vi.fn()
    render(<ConfigEditor config={normalizeConfig(CONFIG_PRESETS['252'])} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    const card = screen.getByRole('button', { name: 'B1 · 左 · 贸易站 · 3级' })
    await userEvent.click(card)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(card).toHaveFocus()
    expect(onUpdate).not.toHaveBeenCalled()
  })
  it('clears restored optimizer policy when applying a preset', async () => {
    const user = userEvent.setup()
    const config = {
      ...cloneConfig(CONFIG_PRESETS['252']),
      optimization_mode: 'fast',
      optimizer_search: { optimization_mode: 'fast', beam: true },
    }
    const onUpdate = vi.fn()
    render(
      <ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />,
    )

    await user.click(screen.getByRole('button', { name: '243 均衡' }))
    const next = cloneConfig(config)
    onUpdate.mock.calls[0][0](next)

    expect(next.layout).toBe('2-4-3')
    expect(next.optimization_mode).toBeUndefined()
    expect(next.optimizer_search).toBeUndefined()
  })
})

describe('ConfigEditor shift patterns', () => {
  it.each([8, 12])('allows restricted profiles to select the %s-hour preset only', async (hours) => {
    const user = userEvent.setup()
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: hours === 8 ? [12, 12, 12] : [8, 8, 8] })
    const onUpdate = vi.fn()
    render(
      <ConfigEditor config={config} canEdit={false} canEditFixedShiftHours validation={{ ok: true }} onUpdate={onUpdate} />,
    )

    expect(screen.getByRole('button', { name: '一天3换（8小时一换）' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '一天2换（12小时一换）' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '一天1换（24小时一换）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '自动变间隔换班' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '自定义' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: hours === 8 ? '一天3换（8小时一换）' : '一天2换（12小时一换）' }))
    const next = cloneConfig(config)
    onUpdate.mock.calls[0][0](next)
    expect(next.shift_hours).toEqual([hours, hours, hours])
  })

  it('defaults to fixed dormitories while keeping both autofill choices available', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    const view = render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    const fixedRule = screen.getByRole('button', { name: /排班表固定.*推荐/ })
    expect(fixedRule).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'MAA 自动填满（保留技能依赖）' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: '纯 MAA 自动填满（效率低）' }))

    const mutate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const next = cloneConfig(config)
    mutate?.(next)
    expect(next.dormitory_rule).toBe('maa_pure_autofill')
    expect(next.Fiammetta?.enable).toBe(true)

    view.rerender(
      <ConfigEditor
        config={next}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )
    expect(screen.getByRole('checkbox', { name: '菲亚梅塔' })).toBeEnabled()
    expect(screen.getByText(/过滤相关生产组合/)).toBeInTheDocument()
    expect(screen.getByText(/菲亚梅塔仍可执行换心情/)).toBeInTheDocument()
    expect(screen.getByText(/启用条件：换班间隔须锁定为8小时（误差需控制在5分钟以内）/)).toBeInTheDocument()
  })

  it('displays and applies a non-uniform 24-hour MAA pattern', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [8, 8, 8] })
    const onUpdate = vi.fn()
    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '自定义' }))
    const input = screen.getByLabelText('MAA 换班间隔')
    expect(input).toHaveValue('8-8-8')
    await user.clear(input)
    await user.type(input, '6-12-6')
    await user.click(screen.getByRole('button', { name: '应用间隔' }))

    const mutate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    expect(mutate).toBeTypeOf('function')
    const next = cloneConfig(config)
    mutate?.(next)
    expect(next.shift_hours).toEqual([12, 6, 6])
    expect(next.schedule_mode).toBe('maa')
    expect(next.Fiammetta?.enable).toBe(true)
    expect(next.variable_shift_schedule).toEqual(expect.objectContaining({ enable: false, enabled: false }))
  })

  it('rejects MAA patterns with fewer than three shifts', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [8, 8, 8] })
    const onUpdate = vi.fn()
    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '自定义' }))
    const input = screen.getByLabelText('MAA 换班间隔')
    await user.clear(input)
    await user.type(input, '12-12')
    await user.click(screen.getByRole('button', { name: '应用间隔' }))

    expect(screen.getByRole('alert')).toHaveTextContent('请输入 3 到 6 班。间隔不同时须合计 24 小时，等长间隔支持 8 或 12 小时。')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('applies the fixed 12-hour MAA interval', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [8, 8, 8] })
    const onUpdate = vi.fn()
    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '一天2换（12小时一换）' }))

    const mutate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const next = cloneConfig(config)
    mutate?.(next)
    expect(next.shift_hours).toEqual([12, 12, 12])
    expect(next.Fiammetta?.enable).toBe(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables one shift per day and recommends in-game queue rotation', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [8, 8, 8] })
    const onUpdate = vi.fn()
    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getByRole('button', { name: '一天3换（8小时一换）' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '一天2换（12小时一换）' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '一天1换（24小时一换）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '自动变间隔换班' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '自定义' })).toBeEnabled()
    expect(screen.getByText('一天一换已停用，建议直接使用游戏内队列轮换。')).toBeInTheDocument()
    expect(screen.queryByLabelText('MAA 换班间隔')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '自动变间隔换班' }))

    const mutate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const next = cloneConfig(config)
    mutate?.(next)
    expect(next.schedule_mode).toBe('variable')
    expect(next.shift_hours).toEqual([8, 8, 8])
    expect(next.Fiammetta?.enable).toBe(false)
    expect(next.variable_shift_schedule).toEqual(expect.objectContaining({
      enable: true,
      enabled: true,
      max_shifts: 4,
      shift_step_minutes: 60,
      min_low_hours: 3,
      beam_width: 4,
    }))
  })

  it('rejects one shift per day entered as a custom pattern', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [8, 8, 8] })
    const onUpdate = vi.fn()
    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '自定义' }))
    const input = screen.getByLabelText('MAA 换班间隔')
    await user.clear(input)
    await user.type(input, '24-24-24')
    await user.click(screen.getByRole('button', { name: '应用间隔' }))

    expect(screen.getByRole('alert')).toHaveTextContent('一天一换已停用，建议直接使用游戏内队列轮换。')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('leaves automatic variable mode when applying a custom pattern', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig({
      ...CONFIG_PRESETS['243'],
      schedule_mode: 'variable',
      shift_hours: [8, 8, 8],
      variable_shift_schedule: { enable: true },
    })
    const onUpdate = vi.fn()
    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    const maaModeButton = screen.getByRole('button', { name: 'MAA 排班表' })
    expect(maaModeButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '自动变间隔换班' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '自定义' }))
    expect(screen.getByLabelText('MAA 换班间隔')).toHaveValue('8-8-8')
    await user.click(screen.getByRole('button', { name: '应用间隔' }))

    const mutate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const next = cloneConfig(config)
    mutate?.(next)
    expect(next.schedule_mode).toBe('maa')
    expect(next.variable_shift_schedule).toEqual(expect.objectContaining({ enable: false, enabled: false }))
  })

  it('disables Fiammetta for unsupported shift patterns', () => {
 const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [10, 10, 4] })

    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: '菲亚梅塔' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '菲亚梅塔' })).not.toBeChecked()
    expect(screen.getByText('启用条件：换班间隔须锁定为8小时/12小时（误差需控制在5分钟以内），否则将引发干员“红脸”状态，导致实际效率低于未启用时的水平。')).toBeInTheDocument()
  })
})

describe('ConfigEditor number inputs', () => {
  it('uses InputNumber controls for room and product counts', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getByRole('spinbutton', { name: '贸易站' })).toHaveValue(2)
    expect(screen.getByRole('button', { name: '减少贸易站' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '增加贸易站' }))

    const updateRoomCounts = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const roomConfig = cloneConfig(config)
    updateRoomCounts?.(roomConfig)
    expect(roomConfig.trading_stations_count).toBe(3)
    expect(roomConfig.manufacturing_stations_count).toBe(3)
    expect(roomConfig.layout).toBe('3-3-3')

    expect(screen.getByRole('spinbutton', { name: '龙门币' })).toHaveValue(2)
    await user.click(screen.getByRole('button', { name: '增加龙门币' }))

    const updateProductCount = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const productConfig = cloneConfig(config)
    updateProductCount?.(productConfig)
    expect(productConfig.product_requirements.trading_stations.LMD).toBe(3)
    expect(screen.getByRole('button', { name: '减少合成玉' })).toBeDisabled()
  })
})

describe('ConfigEditor preset actions', () => {
  it('applies both right-full 252 variants and clears room levels when returning to 243', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    const view = render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '右满252（经验多）' }))
    const apply252 = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const rightFull252 = cloneConfig(config)
    apply252?.(rightFull252)
    expect(rightFull252).toMatchObject({
      layout: '2-5-2',
      desc: '右满252（经验多）',
      trading_stations_count: 2,
      manufacturing_stations_count: 5,
      trading_station_levels: [3, 1],
      manufacturing_station_levels: [2, 2, 3, 3, 2],
    })

    view.rerender(
      <ConfigEditor
        config={rightFull252}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )
    expect(screen.getByRole('region', { name: '房间结构' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '排班模式' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '房间结构' })).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '产物数量' })).queryByRole('spinbutton')).not.toBeInTheDocument()
    onUpdate.mockImplementationOnce((mutate: (value: typeof config) => void) => mutate(rightFull252))
    await user.click(screen.getByRole('checkbox', { name: '无人机' }))
    expect(rightFull252.drones?.enable).toBe(false)
    expect(rightFull252.trading_station_levels).toEqual([3, 1])

    await user.click(screen.getByRole('button', { name: '右满252（赤金多）' }))
    const apply2521 = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    apply2521?.(rightFull252)
    expect(rightFull252).toMatchObject({
      layout: '2-5-2',
      desc: '右满252（赤金多）',
      trading_station_levels: [3, 2],
      manufacturing_station_levels: [3, 2, 3, 2, 2],
    })

    view.rerender(
      <ConfigEditor
        config={rightFull252}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )
    expect(screen.getByRole('region', { name: '房间结构' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '房间结构' })).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '无人机' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '243 均衡' }))
    const apply243 = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    apply243?.(rightFull252)
    expect(rightFull252.layout).toBe('2-4-3')
    expect(rightFull252.trading_station_levels).toBeUndefined()
    expect(rightFull252.manufacturing_station_levels).toBeUndefined()

    view.rerender(
      <ConfigEditor
        config={rightFull252}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )
    expect(screen.getByRole('region', { name: '房间结构' })).toBeInTheDocument()
  })

  it('applies full-blood 252 and explains its irreversible right-side levels', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    const view = render(<ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    await user.click(screen.getByRole('button', { name: '满血252' }))
    const next = cloneConfig(config)
    onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0](next)
    expect(next).toMatchObject({
      layout: '2-5-2',
      desc: '满血252',
      trading_station_levels: [3, 2],
      manufacturing_station_levels: [3, 3, 3, 3, 3],
      product_requirements: {
        trading_stations: { LMD: 2 },
        manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 3 },
      },
    })
    view.rerender(<ConfigEditor config={next} canEdit validation={{ ok: true }} onUpdate={onUpdate} />)
    expect(screen.getByText(/右侧会客室、加工站、办公室、训练室依次为 1\/3\/1\/3/)).toHaveTextContent('游戏内这些设施无法降级')
    expect(within(screen.getByRole('region', { name: '房间结构' })).queryByRole('spinbutton')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '243 均衡' }))
    onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0](next)
    expect(next.trading_station_levels).toBeUndefined()
    expect(next.manufacturing_station_levels).toBeUndefined()
  })

  it('keeps limited configuration options available after selecting right-full 252', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()
    const view = render(
      <ConfigEditor
        config={config}
        canEdit={false}
        canEditIntermediateInventory
        canSelectPreset
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '右满252（经验多）' }))
    const apply252 = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const rightFull252 = cloneConfig(config)
    apply252?.(rightFull252)

    view.rerender(
      <ConfigEditor
        config={rightFull252}
        canEdit={false}
        canEditIntermediateInventory
        canSelectPreset
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )
    expect(screen.getByText('按库存微调产物')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '排班模式' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '宿舍规则' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '243 均衡' })).toBeInTheDocument()

    onUpdate.mockImplementationOnce((mutate: (value: typeof config) => void) => mutate(rightFull252))
    await user.click(screen.getByRole('button', { name: '游戏内轮换' }))
    expect(rightFull252.schedule_mode).toBe('rotation')
    expect(rightFull252.trading_station_levels).toEqual([3, 1])
    expect(rightFull252.manufacturing_station_levels).toEqual([2, 2, 3, 3, 2])
  })

  it('keeps intermediate inventory when applying a preset in auto-balance mode', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig({
      ...CONFIG_PRESETS['243'],
      intermediate_inventory: {
        'Originium Shard': 12,
        'Pure Gold': 34,
        'Orirock Cube': 56,
      },
      auto_balance_source: 'intermediate_inventory',
    })
    const onUpdate = vi.fn()
    render(
      <ConfigEditor
        config={config}
        canEdit={false}
        canEditIntermediateInventory
        canSelectPreset
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '243 搓玉' }))

    const mutate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as
      | ((value: typeof config) => void)
      | undefined
    const next = cloneConfig(config)
    mutate?.(next)

    expect(next.intermediate_inventory).toEqual({
      'Originium Shard': 12,
      'Pure Gold': 34,
      'Orirock Cube': 56,
    })
    expect(next.auto_balance_source).toBe('intermediate_inventory')
    expect(next.product_requirements.trading_stations.Orundum).toBe(1)
  })
})
