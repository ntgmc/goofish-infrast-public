// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig } from '../lib/config'
import ConfigEditor from './ConfigEditor'

afterEach(cleanup)

describe('ConfigEditor shift patterns', () => {
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
    expect(within(fixedRule).getByText('推荐')).toHaveClass('text-brand-600')
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

  it('shows the selected 12-hour interval in the Fiammetta warning', () => {
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [12, 12, 12] })

    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.getByText(/启用条件：换班间隔须锁定为12小时（误差需控制在5分钟以内）/)).toBeInTheDocument()
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
    expect(next.Fiammetta?.enable).toBe(false)
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

    expect(screen.getByRole('alert')).toHaveTextContent('请输入 3–6 班；非等长间隔需总计 24 小时，等长间隔支持 8、12 或 24 小时。')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['一天2换（12小时一换）', [12, 12, 12], true],
    ['一天1换（24小时一换）', [24, 24, 24], false],
  ] as const)('applies the fixed MAA interval %s', async (optionLabel, expectedHours, fiammettaEnabled) => {
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

    await user.click(screen.getByRole('button', { name: optionLabel }))

    const mutate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]?.[0] as ((value: typeof config) => void) | undefined
    const next = cloneConfig(config)
    mutate?.(next)
    expect(next.shift_hours).toEqual(expectedHours)
    expect(next.Fiammetta?.enable).toBe(fiammettaEnabled)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers five schedule choices and enables automatic variable shifts', async () => {
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
    expect(screen.getByRole('button', { name: '一天1换（24小时一换）' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '自动变间隔换班' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '自定义' })).toBeEnabled()
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

  it('explains how to use an MAA schedule without installing MAA', () => {
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    const onUpdate = vi.fn()

    const { rerender } = render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getByText('未安装或不想安装 MAA？可生成 MAA 排班表后，手动在游戏内设置队列，再定时执行全部轮换。')).toBeInTheDocument()
    expect(screen.queryByText(/游戏内轮换会生成两个设施预设队列/)).not.toBeInTheDocument()

    rerender(
      <ConfigEditor
        config={normalizeConfig({ ...CONFIG_PRESETS['243'], schedule_mode: 'rotation' })}
        canEdit
        validation={{ ok: true }}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getByText(/游戏内轮换会生成两个设施预设队列/)).toBeInTheDocument()
    expect(screen.queryByText(/未安装或不想安装 MAA/)).not.toBeInTheDocument()
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
    expect(maaModeButton).toHaveClass('tool-option-selected')
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
    const config = normalizeConfig({ ...CONFIG_PRESETS['243'], shift_hours: [12, 6, 6] })

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

  it('keeps the orundum budget explanation collapsed until requested', async () => {
    const user = userEvent.setup()
    const config = normalizeConfig(CONFIG_PRESETS['243-1'])

    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.getByText('搓玉理智预算')).toBeInTheDocument()
    expect(screen.getByText('每日投入搓玉的理智')).toBeInTheDocument()

    const summary = screen.getByText('展开预算说明')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')
    await user.click(summary)
    expect(details).toHaveAttribute('open')
    expect(screen.getByText(/当前可用理智预算为/)).toBeInTheDocument()
  })
})

describe('ConfigEditor number inputs', () => {
  it('groups room and product settings in one responsive workbench region', () => {
    const config = normalizeConfig(CONFIG_PRESETS['243'])
    render(
      <ConfigEditor
        config={config}
        canEdit
        validation={{ ok: true }}
        onUpdate={vi.fn()}
      />,
    )

    const roomRegion = screen.getByRole('region', { name: '房间结构' })
    const productRegion = screen.getByRole('region', { name: '产物数量' })
    expect(roomRegion.parentElement).toBe(productRegion.parentElement)
    expect(productRegion).toHaveClass('lg:border-l')
    expect(within(roomRegion).getByRole('note')).toHaveTextContent('暂不支持 2 发电站。')
  })

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
