// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import ConfigEditor from './ConfigEditor'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig } from '../lib/config'
import { copy } from '../copy'
import { getFacilityIds } from '../lib/facility-layout'

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

it.each([
  { 'Pure Gold': 9, 'Originium Shard': 8, 'Orirock Cube': 76, LMD: 120000 },
  { 'Pure Gold': 0, 'Originium Shard': 0, 'Orirock Cube': 0, LMD: 0 },
])('imports the full configuration and inventory %j in one update without changing scheduling choices', async (intermediate_inventory) => {
  const { config, update, props } = setup()
  config.allow_product_rebalance = false
  config.recycling_station_level = 3
  const { layout, desc, trading_stations_count, manufacturing_stations_count, product_requirements } = CONFIG_PRESETS['333']
  const fetch = vi.fn().mockResolvedValue(Response.json({ configuration: { layout, desc, trading_stations_count, manufacturing_stations_count, product_requirements, intermediate_inventory }, fetched_at: new Date().toISOString() }))
  vi.stubGlobal('fetch', fetch)
  render(<ConfigEditor {...props} />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.importConfigSuccess)
  expect(update).toHaveBeenCalledTimes(1)
  expect(config).toMatchObject({ layout: '3-3-3', trading_stations_count: 3, manufacturing_stations_count: 3,
    product_requirements, shift_hours: [12, 12, 12], intermediate_inventory, allow_product_rebalance: false, recycling_station_level: 3 })
  expect(config.trading_station_levels).toBeUndefined()
  expect(config.manufacturing_station_levels).toBeUndefined()
  expect(config.facility_layout).toBeUndefined()
  expect(fetch.mock.calls[0][0]).toBe('/api/user/skland/facilities')
})

it('lets V2 users review scheduling choices before opening the imported rooms', async () => {
  const { config, props, update } = setup()
  config.schedule_mode = 'rotation'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ configuration: CONFIG_PRESETS['333-lmd'] })))
  const user = userEvent.setup()
  render(<ConfigEditor {...props} guideSklandImport />)
  const text = copy.v2.configEditor
  const review = copy.skland.configReview
  const inventory = screen.getByRole('tab', { name: text.inventory })
  await user.click(inventory)
  await user.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(review.success)
  expect(inventory).toHaveAttribute('aria-selected', 'true')
  expect(update).toHaveBeenCalledTimes(1)
  expect(config).toMatchObject({ schedule_mode: 'rotation', shift_hours: [12, 12, 12] })

  await user.click(screen.getByRole('button', { name: review.reviewExecution }))
  expect(screen.getByRole('tab', { name: text.common })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: copy.common.components_ConfigEditor_007 })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: review.reviewRooms }))
  expect(screen.getByRole('tab', { name: new RegExp(text.rooms) })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('combobox', { name: copy.domain.recycling.level })).toBeVisible()
})

it('shows the imported position and level in the V2 layout preview before editing', async () => {
  const { config, props } = setup()
  const configuration = { ...CONFIG_PRESETS['252'], facility_layout: [...config.facility_layout!].reverse() }
  const fetch = vi.fn().mockResolvedValue(Response.json({ configuration }))
  vi.stubGlobal('fetch', fetch)
  const user = userEvent.setup()
  render(<ConfigEditor {...props} guideSklandImport />)
  await user.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await user.click(await screen.findByRole('button', { name: copy.skland.configReview.reviewExecution }))
  await user.click(screen.getByRole('button', { name: copy.skland.configReview.reviewRooms }))
  const layout = screen.getByRole('region', { name: copy.common.facilityLayoutTitle })
  expect(layout.querySelector('.facility-layout-floor')).toHaveTextContent(copy.common.facilityLayoutPower)
  expect(screen.queryByRole('button', { name: /^B1 · 左/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: copy.common.facilityLayoutEdit }))
  expect(screen.getByRole('button', { name: `B1 · 左 · ${copy.common.facilityLayoutPower} · 3${copy.common.facilityLayoutLevel}` })).toBeVisible()
})

it.each([undefined, 0, 1, 2, 3])('preserves recycling level %s when importing the last available Skland data', async (level) => {
  const { config, props } = setup()
  config.recycling_station_level = level
  const fetched_at = '2026-11-02T12:00:00.000Z'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ configuration: CONFIG_PRESETS['252'], fetched_at, refresh_warning: '刷新失败' })))
  render(<ConfigEditor {...props} />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.configWarning(new Date(fetched_at).toLocaleString('zh-CN')))
  expect(config.recycling_station_level).toBe(level)
  const recycling = screen.getByRole('combobox', { name: copy.domain.recycling.level })
  expect(recycling).toHaveValue(String(level ?? 0))
  expect(recycling).toHaveAccessibleDescription(expect.stringContaining(copy.skland.configRecyclingManual))
  await userEvent.selectOptions(recycling, '2')
  expect(config.recycling_station_level).toBe(2)
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

it('rejects unavailable or invalid inventory without replacing the existing configuration', async () => {
  const { config, update, props } = setup()
  const before = cloneConfig(config)
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: '库存读取失败，请稍后重试。' }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ configuration: { ...CONFIG_PRESETS['333'], intermediate_inventory: { 'Pure Gold': -1 } } }))
  vi.stubGlobal('fetch', fetch)
  render(<ConfigEditor {...props} />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText('库存读取失败，请稍后重试。')
  expect(update).not.toHaveBeenCalled()
  expect(config).toEqual(before)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.common.facilityLayoutReadFailed)
  expect(update).not.toHaveBeenCalled()
  expect(config).toEqual(before)
})

it('preserves preset permissions while allowing a matching 252 map and inventory to be imported', async () => {
  const { config, props, update } = setup()
  const intermediate_inventory = { 'Pure Gold': 9, 'Originium Shard': 8, 'Orirock Cube': 76, LMD: 120000 }
  const configuration = { ...CONFIG_PRESETS['252'], facility_layout: [...config.facility_layout!].reverse(), intermediate_inventory }
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ configuration, fetched_at: new Date().toISOString() })))
  render(<ConfigEditor {...props} canEdit={false} />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.importConfigSuccess)
  expect(update).toHaveBeenCalledTimes(1)
  expect(config.facility_layout).toEqual(configuration.facility_layout)
  expect(config.intermediate_inventory).toEqual(intermediate_inventory)
  configuration.trading_stations_count = 3
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.configPresetRequired)
  expect(update).toHaveBeenCalledTimes(1)
})

it.each(Object.keys(CONFIG_PRESETS))('selects the %s preset after importing matching production in different positions', async (id) => {
  const { props } = setup()
  const preset = CONFIG_PRESETS[id]
  const config = normalizeConfig({ ...preset, desc: copy.v2.configCustomPreset })
  const configuration = { ...preset, facility_layout: getFacilityIds(preset).reverse() }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ configuration })))
  const onUpdate = vi.fn((mutate: (next: typeof config) => void) => mutate(config))
  render(<ConfigEditor {...props} config={config} onUpdate={onUpdate} guideSklandImport />)
  expect(screen.getByRole('button', { name: copy.v2.configCustomPreset })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.configReview.success)
  const labels: Record<string, string> = { '243': '243 均衡', '243-1': '243 搓玉', '333': '333 搓玉', '333-lmd': '333 纯钱' }
  expect(screen.getByRole('button', { name: labels[id] ?? preset.desc })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: copy.v2.configCustomPreset })).toHaveAttribute('aria-pressed', 'false')
  expect(config.facility_layout).toEqual(configuration.facility_layout)
  expect(onUpdate).toHaveBeenCalledOnce()
})

it('keeps imported production custom when only its room counts match a preset', async () => {
  const { config, props } = setup()
  const configuration = { ...CONFIG_PRESETS['243'], desc: copy.skland.importedConfig,
    facility_layout: getFacilityIds(CONFIG_PRESETS['243']).reverse(),
    product_requirements: { trading_stations: { LMD: 2 }, manufacturing_stations: { 'Pure Gold': 1, 'Battle Record': 3 } } }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ configuration })))
  render(<ConfigEditor {...props} guideSklandImport />)
  await userEvent.click(screen.getByRole('button', { name: copy.skland.importConfig }))
  await screen.findByText(copy.skland.configReview.success)
  expect(screen.getByRole('button', { name: copy.v2.configCustomPreset })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '243 均衡' })).toHaveAttribute('aria-pressed', 'false')
  expect(config.product_requirements).toEqual(configuration.product_requirements)
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
