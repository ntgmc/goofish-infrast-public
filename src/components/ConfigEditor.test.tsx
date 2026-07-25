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

    const input = screen.getByLabelText('MAA 换班间隔')
    await user.clear(input)
    await user.type(input, '12-12')
    await user.click(screen.getByRole('button', { name: '应用间隔' }))

    expect(screen.getByRole('alert')).toHaveTextContent('请输入 3–6 个正数，并确保总计为 24 小时。')
    expect(onUpdate).not.toHaveBeenCalled()
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
