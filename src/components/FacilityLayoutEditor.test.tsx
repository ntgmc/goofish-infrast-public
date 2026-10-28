// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import ConfigEditor from './ConfigEditor'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig } from '../lib/config'
import { copy } from '../copy'

vi.mock('../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: { one_shift_per_day: false } }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup() {
  const config = normalizeConfig(CONFIG_PRESETS['252'])
  config.facility_layout = ['trading_1', 'trading_2', 'manufacture_1', 'manufacture_2', 'manufacture_3', 'manufacture_4', 'manufacture_5', 'power_1', 'power_2']
  config.shift_hours = [12, 12, 12]
  config.intermediate_inventory = { 'Pure Gold': 123 }
  const update = vi.fn((mutate: (next: typeof config) => void) => mutate(config))
  const props = { profileId: 'profile', config, canEdit: true, validation: { ok: true } as const, onUpdate: update }
  return { config, update, props }
}

it('imports the full configuration in one update and removes obsolete 252 levels without changing scheduling choices or stock', async () => {
  const { config, update, props } = setup()
  const { layout, desc, trading_stations_count, manufacturing_stations_count, product_requirements } = CONFIG_PRESETS['333']
  const fetch = vi.fn().mockResolvedValue(Response.json({ configuration: { layout, desc, trading_stations_count, manufacturing_stations_count, product_requirements }, fetched_at: new Date().toISOString() }))
  vi.stubGlobal('fetch', fetch)
  render(<ConfigEditor {...props} />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.importConfigSuccess)
  expect(update).toHaveBeenCalledTimes(1)
  expect(config).toMatchObject({ layout: '3-3-3', trading_stations_count: 3, manufacturing_stations_count: 3,
    product_requirements, shift_hours: [12, 12, 12], intermediate_inventory: { 'Pure Gold': 123 } })
  expect(config.trading_station_levels).toBeUndefined()
  expect(config.manufacturing_station_levels).toBeUndefined()
  expect(config.facility_layout).toBeUndefined()
  expect(fetch.mock.calls[0][0]).toBe('/api/user/skland/facilities')
})

it('leaves the existing configuration intact when the layout or product is unsupported', async () => {
  const { config, update, props } = setup()
  const before = cloneConfig(config)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ configuration: null, configuration_error: copy.skland.configUnknownProduct })))
  render(<ConfigEditor {...props} />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.configUnknownProduct)
  expect(update).not.toHaveBeenCalled()
  expect(config).toEqual(before)
})

it('preserves preset permissions while allowing a matching 252 map to be imported', async () => {
  const { config, props, update } = setup()
  const configuration = { ...CONFIG_PRESETS['252'], facility_layout: [...config.facility_layout!].reverse() }
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ configuration, fetched_at: new Date().toISOString() })))
  render(<ConfigEditor {...props} canEdit={false} />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.importConfigSuccess)
  expect(update).toHaveBeenCalledTimes(1)
  expect(config.facility_layout).toEqual(configuration.facility_layout)
  configuration.trading_stations_count = 3
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.configPresetRequired)
  expect(update).toHaveBeenCalledTimes(1)
})

it('aborts an in-flight import on profile change and ignores its late response', async () => {
  const { props, update } = setup()
  let finish!: (response: Response) => void
  const fetch = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve }))
  vi.stubGlobal('fetch', fetch)
  const view = render(<ConfigEditor {...props} />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  const signal = fetch.mock.calls[0][1].signal as AbortSignal
  view.rerender(<ConfigEditor {...props} profileId="other-profile" />)
  expect(signal.aborted).toBe(true)
  finish(Response.json({ configuration: CONFIG_PRESETS['243'] }))
  await waitFor(() => expect(screen.getByRole('button', { name: copy.skland.importConfig })).toBeEnabled())
  expect(update).not.toHaveBeenCalled()
})
