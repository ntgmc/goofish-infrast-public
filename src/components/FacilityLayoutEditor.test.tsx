// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../lib/config'
import { FACILITY_IDS } from '../lib/facility-layout'
import FacilityLayoutEditor from './FacilityLayoutEditor'

const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }))
vi.mock('../lib/api-client', () => ({ apiJson }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('Skland facility import', () => {
  it('fills a draft for the requested profile and still requires confirmation', async () => {
    const config = structuredClone(CONFIG_PRESETS['252'])
    config.facility_layout = [...FACILITY_IDS]
    const rooms = [
      { type: 'trading', level: 1 }, { type: 'trading', level: 3 }, { type: 'manufacture', level: 2 },
      { type: 'manufacture', level: 2 }, { type: 'manufacture', level: 3 }, { type: 'manufacture', level: 3 },
      { type: 'manufacture', level: 2 }, { type: 'power', level: 3 }, { type: 'power', level: 3 },
    ]
    apiJson.mockResolvedValue({ rooms })
    render(<FacilityLayoutEditor profileId="profile-1" config={config} onUpdate={(mutate) => mutate(config)} />)
    await userEvent.click(screen.getByRole('button', { name: '从森空岛读取设施' }))
    expect(await screen.findByRole('button', { name: 'B1 · 左 · 贸易站 · 1级' })).toBeInTheDocument()
    expect(apiJson).toHaveBeenCalledWith('/api/user/skland/facilities', expect.objectContaining({ json: { profile_id: 'profile-1' } }))
    expect(config.facility_layout).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: '确认布局' }))
    expect(config.facility_layout).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: '确认并收起' }))
    expect(config.facility_layout?.slice(0, 2)).toEqual(['trading_2', 'trading_1'])
  })
  it.each(['failure', 'invalid'])('preserves the confirmed layout on %s', async (mode) => {
    const config = { ...structuredClone(CONFIG_PRESETS['252']), facility_layout: [...FACILITY_IDS] }
    const onUpdate = vi.fn()
    if (mode === 'failure') apiJson.mockRejectedValue(new Error('请先绑定森空岛'))
    else apiJson.mockResolvedValue({ rooms: [] })
    render(<FacilityLayoutEditor profileId="profile-1" config={config} onUpdate={onUpdate} />)
    await userEvent.click(screen.getByRole('button', { name: '从森空岛读取设施' }))
    expect(await screen.findByText(mode === 'failure' ? '请先绑定森空岛' : '读取设施失败，请稍后重试。')).toBeInTheDocument()
    expect(screen.getByText('布局已确认')).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
  })
  it('cancels a pending facility read when configuration becomes read-only and preserves the confirmed layout', async () => {
    let finishRead!: (response: { rooms: unknown[] }) => void
    apiJson.mockReturnValue(new Promise((resolve) => { finishRead = resolve }))
    const config = { ...structuredClone(CONFIG_PRESETS['252']), facility_layout: [...FACILITY_IDS] }
    const onUpdate = vi.fn()
    const view = render(<FacilityLayoutEditor profileId="profile-1" config={config} onUpdate={onUpdate} />)
    await userEvent.click(screen.getByRole('button', { name: '从森空岛读取设施' }))
    const signal = apiJson.mock.calls[0][1].signal as AbortSignal
    view.rerender(<FacilityLayoutEditor profileId="profile-1" config={config} readOnly onUpdate={onUpdate} />)
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: '从森空岛读取设施' })).toBeDisabled()
    await act(async () => finishRead({ rooms: [
      ...config.trading_station_levels!.map((level) => ({ type: 'trading', level })),
      ...config.manufacturing_station_levels!.map((level) => ({ type: 'manufacture', level })),
      { type: 'power', level: 3 }, { type: 'power', level: 3 },
    ] }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByText('布局已确认')).toBeInTheDocument()
    view.rerender(<FacilityLayoutEditor profileId="profile-1" config={config} onUpdate={onUpdate} />)
    expect(screen.getByRole('button', { name: '修改布局' })).toBeEnabled()
  })

  it('cancels a pending read when the editor unmounts', async () => {
    apiJson.mockReturnValue(new Promise(() => {}))
    const onUpdate = vi.fn()
    const view = render(<FacilityLayoutEditor profileId="profile-1" config={CONFIG_PRESETS['252']} onUpdate={onUpdate} />)
    await userEvent.click(screen.getByRole('button', { name: '从森空岛读取设施' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '正在读取设施…' })).toBeDisabled())
    const signal = apiJson.mock.calls[0][1].signal as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
