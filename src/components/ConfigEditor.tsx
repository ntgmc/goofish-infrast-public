import { useEffect, useId, useRef, useState } from 'react'
import { DormitoryIcon as BedDouble, ManufactureIcon as Factory, FiammettaIcon as Flame, TradingStationIcon as Store, PowerPlantIcon as Zap, DroneIcon } from './icons'
import { Tabs } from './ui/tabs'
import {
  CONFIG_PRESETS,
  allowsInventoryProductRebalance,
  getRightFull252Variant,
  isFullBlood252Config,
  isFiammettaShiftHoursSupported,
  isValidShiftHours,
  isVariableShiftScheduleEnabled,
  normalizeConfig,
  normalizeDroneAutoStrategy,
  normalizeDormitoryRule,
  normalizeScheduleMode,
  parseShiftHours,
  resolveConfigLayout,
} from '../lib/config'
import { facilityLayoutSchema } from '../lib/facility-layout'
import { BASE_DAILY_SANITY_BUDGET, MONTHLY_CARD_DAILY_SANITY_BONUS, normalizeOrundumPlanning } from '../lib/orundum-economy'
import type { IntermediateProduct, LicenseConfig, PermissionMode } from '../lib/types'
import { useSiteFeatures } from '../lib/site-feature-context'
import { copy } from '../copy/index'
import InputNumber from './InputNumber'
import FacilityLayoutEditor from './FacilityLayoutEditor'
import ProductIcon from './ProductIcon'
import { Switch } from './ui/switch'
import './ConfigEditor.css'

const text = copy.v2.configEditor
const TRADING_PRODUCTS = ['LMD', 'Orundum']
const MANUFACTURING_PRODUCTS = ['Pure Gold', 'Battle Record', 'Originium Shard']
const STATION_ICONS = { trading: Store, manufacturing: Factory }
const PRODUCT_LABELS: Record<string, string> = {
  LMD: copy.common.components_ConfigEditor_001,
  Orundum: copy.common.components_ConfigEditor_002,
  'Pure Gold': copy.common.components_ConfigEditor_003,
  'Battle Record': copy.common.components_ConfigEditor_004,
  'Originium Shard': copy.common.components_ConfigEditor_005,
}
const SCHEDULE_MODE_LABELS = {
  maa: copy.common.components_ConfigEditor_006,
  rotation: copy.common.components_ConfigEditor_007,
}
const DORMITORY_RULE_LABELS = {
  fixed: copy.common.components_ConfigEditor_009,
  maa_autofill: copy.common.components_ConfigEditor_010,
  maa_pure_autofill: copy.common.components_ConfigEditor_097,
}
const SHIFT_SCHEDULE_OPTIONS = [
  { id: '8x3', label: copy.common.components_ConfigEditor_087, hours: [8, 8, 8] },
  { id: '12x3', label: copy.common.components_ConfigEditor_088, hours: [12, 12, 12] },
  { id: '24x3', label: copy.common.components_ConfigEditor_089, hours: [24, 24, 24] },
  { id: 'variable', label: copy.common.components_ConfigEditor_090 },
  { id: 'custom', label: copy.common.components_ConfigEditor_091 },
] as const
const PERMISSION_LABELS: Record<PermissionMode, string> = {
  recommended: copy.common.components_ConfigEditor_011,
  growth: copy.common.components_ConfigEditor_012,
  advanced: copy.common.components_ConfigEditor_013,
  metered_advanced: copy.metered.permission_label,
  ultimate: copy.common.components_ConfigEditor_014,
  admin: copy.common.components_ConfigEditor_015,
}
const PRESET_GROUPS = [
  { label: copy.common.components_ConfigEditor_110, presets: [
    ['243', copy.common.components_ConfigEditor_030, 'balanced', ['Pure Gold', 'Battle Record']],
    ['243-1', copy.common.components_ConfigEditor_031, 'orundum', ['Orundum']],
    ['333-lmd', copy.common.components_ConfigEditor_107, 'gold', ['LMD']],
    ['333', copy.common.components_ConfigEditor_032, 'orundum', ['Orundum']],
  ] },
  { label: copy.common.components_ConfigEditor_111, presets: [
    ['252', copy.common.components_ConfigEditor_103, 'experience', ['Battle Record']],
    ['252-1', copy.common.components_ConfigEditor_105, 'gold', ['Pure Gold']],
    ['252-full', copy.common.components_ConfigEditor_108, 'balanced', ['Pure Gold', 'Battle Record']],
  ] },
] as const

function applyCounts(config: LicenseConfig): void {
  const variant = getRightFull252Variant(config)
  config.layout = resolveConfigLayout(config)
  config.desc = isFullBlood252Config(config)
    ? copy.common.components_ConfigEditor_108
    : variant
      ? CONFIG_PRESETS[variant].desc
      : `${config.layout}${copy.common.components_ConfigEditor_019}`
}

function normalizeIntermediateInventory(value: LicenseConfig['intermediate_inventory']): Record<IntermediateProduct, number> {
  const next: Record<IntermediateProduct, number> = { 'Originium Shard': 0, 'Pure Gold': 0, 'Orirock Cube': 0 }
  for (const product of Object.keys(next) as IntermediateProduct[]) {
    const count = Number(value?.[product])
    next[product] = Number.isFinite(count) ? Math.max(0, Math.round(count * 100) / 100) : 0
  }
  return next
}

function bindAutoDrones(config: LicenseConfig): void {
  config.drones = {
    ...config.drones,
    enable: true,
    auto: true,
    auto_strategy: normalizeDroneAutoStrategy(config.drones?.auto_strategy),
    order: config.drones?.order ?? 'pre',
    targets: Array.isArray(config.drones?.targets) ? config.drones.targets : [],
  }
  delete config.drones.auto_target_product
}

interface ConfigEditorProps {
  profileId?: string
  config: LicenseConfig
  canEdit: boolean
  readOnly?: boolean
  readOnlyMessage?: string
  canEditIntermediateInventory?: boolean
  canSelectPreset?: boolean
  canEditFixedShiftHours?: boolean
  changed?: boolean
  permission?: PermissionMode
  validation: { ok: true } | { ok: false; message: string }
  onUpdate: (mutate: (config: LicenseConfig) => void) => void
  note?: string
  embedded?: boolean
  hideHeader?: boolean
  hidePresetActions?: boolean
  hideValidation?: boolean
}

export default function ConfigEditor({
  profileId, config, canEdit, readOnly = false, readOnlyMessage = copy.common.configGenerationReadOnly, canEditIntermediateInventory,
  canSelectPreset = false, canEditFixedShiftHours = false, changed = false, permission,
  validation, onUpdate, note, embedded = false, hideHeader = false,
  hidePresetActions = false, hideValidation = false,
}: ConfigEditorProps) {
  const [section, setSection] = useState('common')
  const roomsTabRef = useRef<HTMLButtonElement>(null)
  const canUseIntermediateInventory = canEdit || Boolean(canEditIntermediateInventory)
  const supported252 = getRightFull252Variant(config) !== null || isFullBlood252Config(config)
  const needsLayout = supported252 && !facilityLayoutSchema.safeParse(config.facility_layout).success
  const tradingProducts = [...new Set([...TRADING_PRODUCTS, ...Object.keys(config.product_requirements.trading_stations)])]
  const manufacturingProducts = [...new Set([...MANUFACTURING_PRODUCTS, ...Object.keys(config.product_requirements.manufacturing_stations)])]
  const rotationMode = normalizeScheduleMode(config.schedule_mode) === 'rotation'
  const variableShiftMode = isVariableShiftScheduleEnabled(config)
  const dormitoryRule = normalizeDormitoryRule(config.dormitory_rule)
  const fiammettaSupported = !variableShiftMode && isFiammettaShiftHoursSupported(config.shift_hours)
  const fiammettaInterval = fiammettaSupported
    ? `${Math.max(...(parseShiftHours(config.shift_hours) ?? [8]))}${copy.common.components_ConfigEditor_099}`
    : copy.common.components_ConfigEditor_100
  const inventory = normalizeIntermediateInventory(config.intermediate_inventory)
  const orundumPlanning = normalizeOrundumPlanning(config)
  const showOrundum = (config.product_requirements.trading_stations.Orundum ?? 0) > 0
    || (config.product_requirements.manufacturing_stations['Originium Shard'] ?? 0) > 0
  const presetId = Object.keys(CONFIG_PRESETS).find((id) => presetMatches(config, CONFIG_PRESETS[id])) ?? ''

  const update = (mutate: (next: LicenseConfig) => void) => {
    if (!readOnly) onUpdate(mutate)
  }
  const showRooms = () => {
    setSection('rooms')
    requestAnimationFrame(() => {
      const tab = roomsTabRef.current
      if (tab?.getAttribute('aria-selected') === 'true') tab.focus({ preventScroll: true })
    })
  }
  const applyPreset = (id: string) => {
    const preset = CONFIG_PRESETS[id]
    if (!preset) return
    update((next) => {
      const stock = normalizeIntermediateInventory(next.intermediate_inventory)
      const autoBalanceEnabled = next.allow_product_rebalance !== undefined
        || next.auto_balance_source === 'intermediate_inventory' || next.auto_balance_source === 'limited_config'
      const droneStrategy = normalizeDroneAutoStrategy(next.drones?.auto_strategy)
      const normalized = normalizeConfig(preset)
      normalized.drones!.auto_strategy = droneStrategy
      delete next.trading_station_levels
      delete next.manufacturing_station_levels
      delete next.facility_layout
      delete next.optimization_mode
      delete next.optimizer_search
      Object.assign(next, normalized)
      next.intermediate_inventory = stock
      if (autoBalanceEnabled) {
        next.auto_balance_source = 'intermediate_inventory'
        bindAutoDrones(next)
      }
    })
    if (preset.layout === '2-5-2') showRooms()
  }
  const setStationCounts = (trading: number, manufacturing: number) => update((next) => {
    next.trading_stations_count = trading
    next.manufacturing_stations_count = manufacturing
    delete next.trading_station_levels
    delete next.manufacturing_station_levels
    next.product_requirements.trading_stations = fitProductCounts(next.product_requirements.trading_stations, tradingProducts, trading, 'LMD')
    next.product_requirements.manufacturing_stations = fitProductCounts(next.product_requirements.manufacturing_stations, manufacturingProducts, manufacturing, 'Pure Gold')
    applyCounts(next)
  })
  const changeHours = (hours: number[]) => update((next) => {
    next.schedule_mode = 'maa'
    next.shift_hours = hours
    if (!isFiammettaShiftHoursSupported(hours)) next.Fiammetta = { ...(next.Fiammetta ?? {}), enable: false }
    next.variable_shift_schedule = { ...next.variable_shift_schedule, enable: false, enabled: false }
    applyCounts(next)
  })

  return (
    <Tabs.Root value={section} onValueChange={setSection} className={`config-editor min-w-0 ${embedded ? '' : 'tool-panel p-5 sm:p-6'}`}>
      {!hideHeader && <header className="config-editor-header">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">{copy.common.components_ConfigEditor_021}</h2>
          {changed && <span className="tool-status tool-status--warning">{copy.common.components_ConfigEditor_022}</span>}
        </div>
        <p>{note ?? (canEdit ? copy.common.components_ConfigEditor_023
          : canUseIntermediateInventory
            ? `${copy.common.components_ConfigEditor_024}${permission ? PERMISSION_LABELS[permission] : copy.common.components_ConfigEditor_026}${copy.common.components_ConfigEditor_025}`
            : `${copy.common.components_ConfigEditor_027}${permission ? PERMISSION_LABELS[permission] : copy.common.components_ConfigEditor_029}${copy.common.components_ConfigEditor_028}`)}</p>
      </header>}
      {hideHeader && note && <p className="config-help">{note}</p>}
      {readOnly && <p className="tool-alert tool-alert--info" role="status">{readOnlyMessage}</p>}
      <Tabs.List className="config-task-tabs" aria-label={text.navigation}>
        <Tabs.Trigger value="common">{text.common}</Tabs.Trigger>
        <Tabs.Trigger ref={roomsTabRef} value="rooms">{text.rooms}{needsLayout && <span className="config-task-pending" aria-label={text.needsLayout} />}</Tabs.Trigger>
        <Tabs.Trigger value="inventory">{text.inventory}</Tabs.Trigger>
        <Tabs.Trigger value="strategy">{text.strategy}</Tabs.Trigger>
      </Tabs.List>
      <fieldset disabled={readOnly} className="config-editor-fields" aria-label={copy.common.components_ConfigEditor_021}>
        <Tabs.Content value="common" forceMount hidden={section !== 'common'} className="config-task-panel config-task-panel--common">
          <h3 className="sr-only">{text.commonTitle}</h3>
          {!hidePresetActions && <section className="config-field config-preset-section" data-tour-target="config-preset-actions" aria-label={copy.v2.configPreset}>
            <h4>{copy.v2.configPreset}</h4>
            <div className="config-preset-groups">
              {PRESET_GROUPS.map((group) => <div key={group.label} className="config-preset-group" role="group" aria-label={group.label}>
                <span>{group.label}</span>
                <div>{group.presets.map(([id, label, tone, products]) => <button key={id} type="button"
                  className={`tool-secondary-action config-preset config-preset--${tone}`} aria-pressed={presetId === id}
                  disabled={!canEdit && !canSelectPreset} onClick={() => applyPreset(id)}>
                  <span className="config-preset-icons">{products.map((product) => <ProductIcon key={product} product={product} size={20} />)}</span>
                  {label}
                </button>)}</div>
              </div>)}
            </div>
            {!presetId && <p className="config-help">{copy.v2.configCustomPreset}</p>}
          </section>}
          <section aria-labelledby="config-schedule-heading" className="config-field config-execution-field">
            <h4 id="config-schedule-heading">{copy.v2.configExecution}</h4>
            <div className="config-execution-options" role="group" aria-label={copy.common.components_ConfigEditor_061}>
              {(['maa', 'rotation'] as const).map((mode) => <button key={mode} type="button"
                aria-pressed={mode === 'rotation' ? rotationMode : !rotationMode}
                className={`tool-secondary-action ${rotationMode === (mode === 'rotation') ? 'tool-option-selected' : ''}`}
                onClick={() => update((next) => { next.schedule_mode = mode; applyCounts(next) })}>
                {SCHEDULE_MODE_LABELS[mode]}
              </button>)}
            </div>
            <p className="config-help">{rotationMode ? copy.common.components_ConfigEditor_062 : text.maaHelp}</p>
          </section>
          {!rotationMode && <ShiftHoursEditor value={config.shift_hours} variableMode={variableShiftMode} canEdit={canEdit}
            canEditFixedShiftHours={canEditFixedShiftHours} onChange={changeHours}
            onSelectVariable={() => update((next) => {
              next.schedule_mode = 'variable'
              next.shift_hours = [8, 8, 8]
              next.Fiammetta = { ...next.Fiammetta, enable: false }
              next.variable_shift_schedule = {
                ...next.variable_shift_schedule, enable: true, enabled: true, max_shifts: 4,
                shift_step_minutes: 60, min_low_hours: 3, beam_width: 4,
                trace_variable_shifts: false, trace_mood_cycle: false,
              }
              applyCounts(next)
            })} />}
          {needsLayout && <button type="button" className="tool-secondary-action config-layout-notice" onClick={showRooms}>
            {text.confirmLayout}
          </button>}
        </Tabs.Content>
        <Tabs.Content value="rooms" forceMount hidden={section !== 'rooms'} className="config-task-panel">
          {supported252 ? <>
            <FacilityLayoutEditor key={JSON.stringify([profileId, config.trading_station_levels, config.manufacturing_station_levels])}
              profileId={profileId} config={config} readOnly={readOnly} onUpdate={update} />
            <p className="tool-alert tool-alert--warning text-xs leading-5" role="note">{copy.common.components_ConfigEditor_109}</p>
          </> : <section aria-labelledby="config-room-layout-heading">
            <h3 id="config-room-layout-heading" className="config-section-title">{copy.common.components_ConfigEditor_042}</h3>
            <div className="config-room-counts">
              <CounterField station="trading" id="trading-stations-count" label={copy.common.components_ConfigEditor_044} value={config.trading_stations_count}
                canEdit={canEdit} onChange={(value) => setStationCounts(value, 6 - value)} />
              <CounterField station="manufacturing" id="manufacturing-stations-count" label={copy.common.components_ConfigEditor_045} value={config.manufacturing_stations_count}
                canEdit={canEdit} onChange={(value) => setStationCounts(6 - value, value)} />
              <div className="config-field config-station config-station--power">
                <span className="config-station-heading"><Zap aria-hidden="true" />{copy.common.components_ConfigEditor_094}</span>
                <strong className="config-station-count">{config.layout.split('-')[2]}</strong>
              </div>
            </div>
          </section>}
          <section aria-labelledby="config-product-counts-heading">
            <h3 id="config-product-counts-heading" className="config-section-title">{copy.common.components_ConfigEditor_048}</h3>
            <div className="config-product-groups">
              <ProductGroupEditor station="trading" label={copy.common.components_ConfigEditor_049} products={tradingProducts}
                counts={config.product_requirements.trading_stations} canEdit={canEdit && !supported252}
                onChange={(product, value) => update((next) => { next.product_requirements.trading_stations[product] = value; applyCounts(next) })} />
              <ProductGroupEditor station="manufacturing" label={copy.common.components_ConfigEditor_050} products={manufacturingProducts}
                counts={config.product_requirements.manufacturing_stations} canEdit={canEdit && !supported252}
                onChange={(product, value) => update((next) => { next.product_requirements.manufacturing_stations[product] = value; applyCounts(next) })} />
            </div>
          </section>
        </Tabs.Content>
        <Tabs.Content value="inventory" forceMount hidden={section !== 'inventory'} className="config-task-panel">
          <section aria-labelledby="config-inventory-heading">
            <h3 id="config-inventory-heading" className="config-section-title">{copy.common.components_ConfigEditor_077}</h3>
            <div className="config-inventory-grid">
              {(['Originium Shard', 'Pure Gold', ...(showOrundum ? ['Orirock Cube'] as const : [])] as const).map((product) => <IntermediateInventoryField
                key={product} product={product} label={product === 'Orirock Cube' ? copy.common.components_ConfigEditor_080 : PRODUCT_LABELS[product]}
                value={inventory[product]} canEdit={canUseIntermediateInventory}
                onChange={(product, value) => update((next) => {
                  next.intermediate_inventory = { ...normalizeIntermediateInventory(next.intermediate_inventory), [product]: Number.isFinite(value) ? Math.max(0, value) : 0 }
                  next.allow_product_rebalance = allowsInventoryProductRebalance(next, canEdit)
                  next.auto_balance_source = 'intermediate_inventory'
                  bindAutoDrones(next)
                  applyCounts(next)
                })} />)}
            </div>
            <label className="config-switch-row">
              <span>{copy.common.inventoryProductRebalanceLabel}</span>
              <Switch checked={allowsInventoryProductRebalance(config, canEdit)} disabled={!canUseIntermediateInventory || rotationMode}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked
                  update((next) => {
                    next.allow_product_rebalance = enabled
                    next.auto_balance_source = enabled ? 'intermediate_inventory' : 'limited_config'
                    next.intermediate_inventory = normalizeIntermediateInventory(next.intermediate_inventory)
                    applyCounts(next)
                  })
                }} />
            </label>
            <p className="config-help">{rotationMode ? copy.common.inventoryProductRebalanceRotation : copy.common.inventoryProductRebalanceHelp}</p>
          </section>
          {showOrundum && <section aria-labelledby="config-orundum-heading" className="config-section-divider">
            <h3 id="config-orundum-heading" className="config-section-title">{copy.common.components_ConfigEditor_052}</h3>
            <label className="config-switch-row"><span>{copy.common.components_ConfigEditor_056}</span>
              <Switch checked={orundumPlanning.monthly_card} disabled={!canEdit} onChange={(event) => {
                const enabled = event.currentTarget.checked
                update((next) => {
                  next.orundum_planning = { ...next.orundum_planning, daily_sanity_budget: normalizeOrundumPlanning(next).daily_sanity_budget, monthly_card: enabled }
                  applyCounts(next)
                })
              }} />
            </label>
            <label className="config-switch-row"><span>{copy.common.components_ConfigEditor_057}</span>
              <input type="number" min={0} step={1} value={orundumPlanning.daily_sanity_budget} disabled={!canEdit}
                className="number-input-clean tool-field w-24 text-right" onChange={(event) => {
                  const value = Number(event.currentTarget.value)
                  update((next) => {
                    next.orundum_planning = { ...next.orundum_planning, daily_sanity_budget: Number.isFinite(value) ? Math.max(0, value) : BASE_DAILY_SANITY_BUDGET }
                    applyCounts(next)
                  })
                }} />
            </label>
            <details className="config-explanation"><summary>{copy.common.components_ConfigEditor_059_details_summary}</summary>
              <p>{copy.common.components_ConfigEditor_053}{BASE_DAILY_SANITY_BUDGET}{copy.common.components_ConfigEditor_054}{MONTHLY_CARD_DAILY_SANITY_BONUS}{copy.common.components_ConfigEditor_055}</p>
              <p>{copy.common.components_ConfigEditor_058}{orundumPlanning.total_daily_sanity_budget}{copy.common.components_ConfigEditor_059}</p>
            </details>
          </section>}
        </Tabs.Content>
        <Tabs.Content value="strategy" forceMount hidden={section !== 'strategy'} className="config-task-panel config-strategy-panel">
          <section aria-labelledby="config-dormitory-heading" className="config-field config-strategy-section config-strategy-section--dormitory">
            <h3 id="config-dormitory-heading" className="config-strategy-heading"><BedDouble aria-hidden="true" />{copy.common.components_ConfigEditor_063}</h3>
            <select className="tool-field" aria-label={copy.common.components_ConfigEditor_063} value={dormitoryRule}
              disabled={rotationMode || (!canEdit && !canUseIntermediateInventory)} onChange={(event) => {
                const rule = normalizeDormitoryRule(event.currentTarget.value)
                update((next) => { next.dormitory_rule = rule; applyCounts(next) })
              }}>
              {Object.entries(DORMITORY_RULE_LABELS).map(([rule, label]) => <option key={rule} value={rule}>{label}</option>)}
            </select>
            <p className="config-help">{rotationMode ? copy.common.components_ConfigEditor_065
              : dormitoryRule === 'maa_pure_autofill' ? copy.common.components_ConfigEditor_098
                : dormitoryRule === 'maa_autofill' ? copy.common.components_ConfigEditor_066 : copy.common.components_ConfigEditor_067}</p>
          </section>
          <section aria-labelledby="config-fiammetta-heading" className="config-strategy-section config-strategy-section--fiammetta">
            <div className="config-switch-row">
              <h3 id="config-fiammetta-heading"><label htmlFor="config-fiammetta-enabled" className="config-strategy-heading"><Flame aria-hidden="true" />{copy.common.components_ConfigEditor_068}</label></h3>
              <Switch id="config-fiammetta-enabled" checked={!rotationMode && fiammettaSupported && (config.Fiammetta?.enable ?? false)}
                disabled={!canEdit || rotationMode || !fiammettaSupported} onChange={(event) => {
                  const enabled = event.currentTarget.checked
                  update((next) => { next.Fiammetta = { enable: enabled }; applyCounts(next) })
                }} />
            </div>
            {rotationMode ? <p className="config-help">{copy.common.components_ConfigEditor_069}</p>
              : (!fiammettaSupported || config.Fiammetta?.enable) && <p className="tool-alert tool-alert--error mt-2 text-xs leading-5" role="note">{copy.common.components_ConfigEditor_070(fiammettaInterval)}</p>}
          </section>
          <section aria-labelledby="config-drones-heading" className="config-strategy-section config-strategy-section--drones">
            <div className="config-switch-row">
              <h3 id="config-drones-heading"><label htmlFor="config-drones-enabled" className="config-strategy-heading"><DroneIcon aria-hidden="true" />{copy.common.components_ConfigEditor_071}</label></h3>
              <Switch id="config-drones-enabled" checked={!rotationMode && (config.drones?.enable ?? false)} disabled={!canEdit || rotationMode}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked
                  update((next) => {
                    next.drones = { ...next.drones, order: next.drones?.order ?? 'pre', targets: next.drones?.targets ?? [], enable: enabled, auto: next.drones?.auto ?? true }
                    applyCounts(next)
                  })
                }} />
            </div>
            {rotationMode ? <p className="config-help">{copy.common.components_ConfigEditor_065}</p> : config.drones?.enable && <div className="config-drone-fields">
              <label className="config-switch-row config-drone-auto-row"><span>{copy.common.components_ConfigEditor_072}</span>
                <Switch checked={config.drones.auto ?? false} disabled={!canEdit} onChange={(event) => {
                  const auto = event.currentTarget.checked
                  update((next) => { next.drones = { ...next.drones!, auto }; applyCounts(next) })
                }} />
              </label>
              {config.drones.auto && <div className="config-field">
                <label htmlFor="drone-auto-strategy">{copy.common.droneAutoStrategyLabel}</label>
                <select id="drone-auto-strategy" className="tool-field" value={normalizeDroneAutoStrategy(config.drones.auto_strategy)} disabled={!canEdit}
                  onChange={(event) => {
                    const strategy = event.currentTarget.value
                    update((next) => { bindAutoDrones(next); next.drones!.auto_strategy = strategy; applyCounts(next) })
                  }}>
                  <option value="efficiency">{copy.common.droneAutoEfficiency}</option>
                  <option value="inventory_balance">{copy.common.droneAutoInventoryBalance}</option>
                </select>
                <p className="config-help">{normalizeDroneAutoStrategy(config.drones.auto_strategy) === 'inventory_balance'
                  ? copy.common.droneAutoInventoryBalanceHelp : copy.common.droneAutoEfficiencyHelp}</p>
              </div>}
              <div className="config-field"><label htmlFor="drone-order">{copy.common.components_ConfigEditor_073}</label>
                <select id="drone-order" className="tool-field" value={config.drones.order ?? 'pre'} disabled={!canEdit} onChange={(event) => {
                  const order = event.currentTarget.value
                  update((next) => { next.drones = { ...next.drones!, order }; applyCounts(next) })
                }}>
                  <option value="pre">{copy.common.components_ConfigEditor_074}</option>
                  <option value="post">{copy.common.components_ConfigEditor_075}</option>
                </select>
              </div>
              {!config.drones.auto && <div className="config-field"><label htmlFor="drone-targets">{copy.common.components_ConfigEditor_076}</label>
                <DroneTargetsInput value={(config.drones.targets ?? []).map((product) => PRODUCT_LABELS[product] ?? product).join('，')} disabled={!canEdit}
                  onChange={(value) => update((next) => {
                    next.drones = { ...next.drones!, targets: value.split(/[，,]/).map((item) => {
                      const name = item.trim()
                      return Object.entries(PRODUCT_LABELS).find(([key, label]) => key === name || label === name)?.[0] ?? name
                    }).filter(Boolean) }
                    applyCounts(next)
                  })} />
              </div>}
            </div>}
          </section>
        </Tabs.Content>
      </fieldset>
      {!hideValidation && !validation.ok && <p className="tool-alert tool-alert--warning" role="alert">{validation.message}</p>}
    </Tabs.Root>
  )
}

function presetMatches(config: LicenseConfig, preset: LicenseConfig): boolean {
  const arraysMatch = (actual: number[] | undefined, expected: number[] | undefined) =>
    !actual && !expected || actual?.length === expected?.length && actual?.every((value, index) => value === expected?.[index]) === true
  const countsMatch = (actual: Record<string, number>, expected: Record<string, number>) =>
    [...new Set([...Object.keys(actual), ...Object.keys(expected)])].every((key) => (actual[key] ?? 0) === (expected[key] ?? 0))
  return config.layout === preset.layout
    && config.trading_stations_count === preset.trading_stations_count
    && config.manufacturing_stations_count === preset.manufacturing_stations_count
    && arraysMatch(config.trading_station_levels, preset.trading_station_levels)
    && arraysMatch(config.manufacturing_station_levels, preset.manufacturing_station_levels)
    && countsMatch(config.product_requirements.trading_stations, preset.product_requirements.trading_stations)
    && countsMatch(config.product_requirements.manufacturing_stations, preset.product_requirements.manufacturing_stations)
}

function fitProductCounts(current: Record<string, number>, products: string[], total: number, fallbackProduct: string): Record<string, number> {
  const next: Record<string, number> = {}
  let remaining = total
  for (const product of products) {
    const count = Math.max(0, Math.min(remaining, current[product] ?? 0))
    if (count > 0) { next[product] = count; remaining -= count }
  }
  if (remaining > 0) next[fallbackProduct] = (next[fallbackProduct] ?? 0) + remaining
  return next
}

function IntermediateInventoryField({ label, product, value, canEdit, onChange }: {
  label: string; product: IntermediateProduct; value: number; canEdit: boolean
  onChange: (product: IntermediateProduct, value: number) => void
}) {
  const [draftValue, setDraftValue] = useState(String(value))
  useEffect(() => { setDraftValue(String(value)) }, [value])
  const commitDraft = () => {
    if (!canEdit) return
    const next = draftValue.trim() === '' ? 0 : Number(draftValue)
    if (Number.isFinite(next) && next !== value) onChange(product, next)
    else setDraftValue(String(value))
  }
  return <label className="config-stock-field">
    <span><ProductIcon product={product} />{label}</span>
    <input type="number" min={0} step={1} value={draftValue} disabled={!canEdit}
      className="number-input-clean tool-field" onChange={(event) => {
        const draft = event.currentTarget.value
        setDraftValue(draft)
        if (!canEdit || !draft.trim()) return
        const next = Number(draft)
        if (Number.isFinite(next) && next !== value) onChange(product, next)
      }} onBlur={commitDraft} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
  </label>
}

function ShiftHoursEditor({ value, variableMode, canEdit, canEditFixedShiftHours, onSelectVariable, onChange }: {
  value: LicenseConfig['shift_hours']; variableMode: boolean; canEdit: boolean; canEditFixedShiftHours: boolean
  onSelectVariable: () => void; onChange: (hours: number[]) => void
}) {
  const { features } = useSiteFeatures()
  const id = useId()
  const normalized = parseShiftHours(value) ?? [8, 8, 8]
  const formatted = normalized.join('-')
  const [draftValue, setDraftValue] = useState(formatted)
  const [error, setError] = useState<string | null>(null)
  const [customSelected, setCustomSelected] = useState(false)
  const inferred = variableMode ? 'variable' : SHIFT_SCHEDULE_OPTIONS.find((choice) => 'hours' in choice
    && choice.hours.length === normalized.length && choice.hours.every((hours, index) => Math.abs(hours - normalized[index]!) <= 0.0001))?.id ?? 'custom'
  const selected = customSelected ? 'custom' : inferred
  useEffect(() => { setDraftValue(formatted); setError(null) }, [formatted])
  const commitDraft = () => {
    if (!canEdit) return
    const parsed = parseShiftHours(draftValue)
    if (!features.one_shift_per_day && parsed?.every((hours) => Math.abs(hours - 24) <= 0.0001)) {
      setError(copy.common.components_ConfigEditor_101)
      return
    }
    if (!parsed || !isValidShiftHours(parsed)) { setError(copy.common.components_ConfigEditor_081); return }
    setError(null)
    setDraftValue(parsed.join('-'))
    if (variableMode || parsed.length !== normalized.length || parsed.some((hours, index) => Math.abs(hours - normalized[index]!) > 0.0001)) onChange(parsed)
  }
  return <div className="config-field config-shift-field">
    <label htmlFor={id}>{copy.v2.configShiftFrequency}</label>
    <select id={id} className="tool-field" value={selected} disabled={!canEdit && !canEditFixedShiftHours} onChange={(event) => {
      const choice = SHIFT_SCHEDULE_OPTIONS.find((choice) => choice.id === event.currentTarget.value)
      if (!choice) return
      setCustomSelected(choice.id === 'custom')
      setError(null)
      if (choice.id === 'variable') onSelectVariable()
      else if ('hours' in choice) onChange([...choice.hours])
    }}>
      {SHIFT_SCHEDULE_OPTIONS.map((choice) => <option key={choice.id} value={choice.id}
        disabled={choice.id === '24x3' ? !canEdit || !features.one_shift_per_day : !canEdit && !(canEditFixedShiftHours && 'hours' in choice)}>
        {choice.id === '24x3' && !features.one_shift_per_day ? text.oneShiftDisabled : choice.label}
      </option>)}
    </select>
    {selected === 'custom' ? <div className="config-field">
      <label htmlFor={`${id}-custom`}>{copy.common.components_ConfigEditor_082}</label>
      <div className="config-custom-hours">
        <input id={`${id}-custom`} type="text" inputMode="decimal" value={draftValue} disabled={!canEdit} aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help`} className="tool-field" onChange={(event) => setDraftValue(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') commitDraft() }} />
        {canEdit && <button type="button" className="tool-secondary-action" onClick={commitDraft}>{copy.common.components_ConfigEditor_083}</button>}
      </div>
      <p id={`${id}-help`} role={error ? 'alert' : undefined} className={`config-help ${error ? 'text-error' : ''}`}>{error ?? copy.common.components_ConfigEditor_084}</p>
    </div> : selected === 'variable' && <p className="config-help">{copy.common.components_ConfigEditor_092}</p>}
  </div>
}

function DroneTargetsInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [draftValue, setDraftValue] = useState(value)
  useEffect(() => { setDraftValue(value) }, [value])
  return <>
    <input id="drone-targets" type="text" list="drone-targets-options" value={draftValue} disabled={disabled}
      onChange={(event) => setDraftValue(event.currentTarget.value)} onBlur={() => { if (!disabled && draftValue !== value) onChange(draftValue) }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      placeholder={copy.common.components_ConfigEditor_085} className="tool-field" />
    <datalist id="drone-targets-options">{[...TRADING_PRODUCTS, ...MANUFACTURING_PRODUCTS].map((product) => <option key={product} value={PRODUCT_LABELS[product]} />)}</datalist>
  </>
}

function CounterField({ station, id, label, value, canEdit, onChange }: {
  station: keyof typeof STATION_ICONS; id: string; label: string; value: number; canEdit: boolean; onChange: (value: number) => void
}) {
  const Icon = STATION_ICONS[station]
  return <div className={`config-field config-station config-station--${station}`}>
    <label htmlFor={id} className="config-station-heading"><Icon aria-hidden="true" />{label}</label>
    {canEdit ? <InputNumber id={id} label={label} value={value} min={1} max={5} onChange={onChange} /> : <strong className="config-station-count">{value}</strong>}
  </div>
}

function ProductGroupEditor({ station, label, products, counts, canEdit, onChange }: {
  station: keyof typeof STATION_ICONS; label: string; products: string[]; counts: Record<string, number>; canEdit: boolean; onChange: (product: string, value: number) => void
}) {
  const Icon = STATION_ICONS[station]
  return <div className={`config-product-group config-station config-station--${station}`}>
    <h4 className="config-station-heading"><Icon aria-hidden="true" />{label}</h4>
    {products.filter((product) => canEdit || (counts[product] ?? 0) > 0).map((product) => <div key={product} className="config-product-row">
      <span><ProductIcon product={product} />{PRODUCT_LABELS[product] ?? product}</span>
      {canEdit ? <InputNumber label={PRODUCT_LABELS[product] ?? product} value={counts[product] ?? 0} min={0} max={6}
        className="config-product-count" onChange={(value) => onChange(product, Math.max(0, Math.min(6, value)))} /> : <strong>{counts[product]}</strong>}
    </div>)}
  </div>
}
