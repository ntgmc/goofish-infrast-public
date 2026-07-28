// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig } from '../lib/config'
import ConfigEditor from './ConfigEditor'

afterEach(cleanup)

describe('ConfigEditor shift patterns', () => {
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
    expect(screen.getByText('菲亚梅塔仅支持固定 8-8-8 或 12-12-12 换班节奏。')).toBeInTheDocument()
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
