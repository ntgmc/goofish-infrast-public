import { useEffect, useState } from 'react'
import {
  isFiammettaShiftHoursSupported,
  isValidShiftHours,
  isVariableShiftScheduleEnabled,
  normalizeConfig,
  normalizeDormitoryRule,
  normalizeScheduleMode,
  parseShiftHours,
} from '../lib/config'
import { BASE_DAILY_SANITY_BUDGET, MONTHLY_CARD_DAILY_SANITY_BONUS, normalizeOrundumPlanning } from '../lib/orundum-economy'
import type { IntermediateProduct, LicenseConfig, PermissionMode } from '../lib/types'
import { copy } from '../copy/index'
import InputNumber from './InputNumber'


type ProductGroup = 'trading_stations' | 'manufacturing_stations'

export const TRADING_PRODUCTS = ['LMD', 'Orundum']
export const MANUFACTURING_PRODUCTS = ['Pure Gold', 'Battle Record', 'Originium Shard']

export const PRODUCT_LABELS: Record<string, string> = {
  LMD: copy.common.components_ConfigEditor_001,
  Orundum: copy.common.components_ConfigEditor_002,
  'Pure Gold': copy.common.components_ConfigEditor_003,
  'Battle Record': copy.common.components_ConfigEditor_004,
  'Originium Shard': copy.common.components_ConfigEditor_005,
}

export const SCHEDULE_MODE_LABELS: Record<string, string> = {
  maa: copy.common.components_ConfigEditor_006,
  rotation: copy.common.components_ConfigEditor_007,
  variable: copy.common.components_ConfigEditor_008,
}

export const DORMITORY_RULE_LABELS: Record<string, string> = {
  fixed: copy.common.components_ConfigEditor_009,
  maa_autofill: copy.common.components_ConfigEditor_010,
}

const VARIABLE_SHIFT_SCHEDULE_DEFAULTS = {
  enable: true,
  enabled: true,
  max_shifts: 4,
  shift_step_minutes: 60,
  min_low_hours: 3,
  beam_width: 4,
  trace_variable_shifts: false,
  trace_mood_cycle: false,
} satisfies NonNullable<LicenseConfig['variable_shift_schedule']>

const SHIFT_SCHEDULE_OPTIONS = [
  { id: '8x3', label: copy.common.components_ConfigEditor_087, hours: [8, 8, 8] },
  { id: '12x3', label: copy.common.components_ConfigEditor_088, hours: [12, 12, 12] },
  { id: '24x3', label: copy.common.components_ConfigEditor_089, hours: [24, 24, 24] },
  { id: 'variable', label: copy.common.components_ConfigEditor_090 },
  { id: 'custom', label: copy.common.components_ConfigEditor_091 },
] as const

type ShiftScheduleChoice = typeof SHIFT_SCHEDULE_OPTIONS[number]['id']

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  recommended: copy.common.components_ConfigEditor_011,
  growth: copy.common.components_ConfigEditor_012,
  advanced: copy.common.components_ConfigEditor_013,
  metered_advanced: copy.metered.permission_label,
  ultimate: copy.common.components_ConfigEditor_014,
  admin: copy.common.components_ConfigEditor_015,
}

export const CONFIG_PRESETS: Record<string, LicenseConfig> = {
  '243': {
    layout: '2-4-3',
    desc: copy.common.components_ConfigEditor_016,
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: {
      trading_stations: { LMD: 2 },
      manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 2 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
  '243-1': {
    layout: '2-4-3',
    desc: copy.common.components_ConfigEditor_017,
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: {
      trading_stations: { LMD: 1, Orundum: 1 },
      manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 2 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
  '333': {
    layout: '3-3-3',
    desc: copy.common.components_ConfigEditor_018,
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 3,
    manufacturing_stations_count: 3,
    product_requirements: {
      trading_stations: { LMD: 2, Orundum: 1 },
      manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 1 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
}

function applyCounts(config: LicenseConfig): LicenseConfig {
  config.layout = `${config.trading_stations_count}-${config.manufacturing_stations_count}-3`
  config.desc = `${config.layout}${copy.common.components_ConfigEditor_019}`
  return config
}

function normalizeIntermediateInventory(value: unknown): Record<IntermediateProduct, number> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const next: Record<IntermediateProduct, number> = {
    'Originium Shard': 0,
    'Pure Gold': 0,
    'Orirock Cube': 0,
  }
  for (const product of Object.keys(next) as IntermediateProduct[]) {
    const count = Number(source[product])
    next[product] = Number.isFinite(count) ? Math.max(0, Math.round(count * 100) / 100) : 0
  }
  return next
}

function bindAutoDrones(config: LicenseConfig): void {
  config.drones = {
    ...(config.drones ?? { order: 'pre', targets: [] }),
    enable: true,
    auto: true,
    auto_strategy: config.drones?.auto_strategy ?? 'trading_priority',
    auto_target_product: config.drones?.auto_target_product,
    order: config.drones?.order ?? 'pre',
    targets: Array.isArray(config.drones?.targets) ? config.drones.targets : [],
  }
}

function setAutoDroneTradingPriority(config: LicenseConfig): void {
  bindAutoDrones(config)
  config.drones = {
    ...config.drones!,
    auto_strategy: 'trading_priority',
    auto_target_product: undefined,
  }
}

function markIntermediateInventoryForOptimizer(config: LicenseConfig): void {
  config.auto_balance_source = 'intermediate_inventory'
  setAutoDroneTradingPriority(config)
}

interface ConfigEditorProps {
  config: LicenseConfig;
  canEdit: boolean;
  canEditIntermediateInventory?: boolean;
  canSelectPreset?: boolean;
  changed?: boolean;
  permission?: PermissionMode;
  validation: { ok: true } | { ok: false; message: string };
  onUpdate: (mutate: (config: LicenseConfig) => void) => void;
  onReset?: () => void;
  resetLabel?: string;
  note?: string;
  embedded?: boolean;
  hideHeader?: boolean;
  hidePresetActions?: boolean;
}

export default function ConfigEditor({
  config,
  canEdit,
  canEditIntermediateInventory,
  canSelectPreset = false,
  changed = false,
  permission,
  validation,
  onUpdate,
  onReset,
  resetLabel = copy.common.components_ConfigEditor_020,
  note,
  embedded = false,
  hideHeader = false,
  hidePresetActions = false,
}: ConfigEditorProps) {
  const canUseIntermediateInventory = canEdit || Boolean(canEditIntermediateInventory)
  const autoInventoryOnly = !canEdit && canUseIntermediateInventory
  const tradingProducts = uniqueProducts(TRADING_PRODUCTS, config.product_requirements.trading_stations)
  const manufacturingProducts = uniqueProducts(MANUFACTURING_PRODUCTS, config.product_requirements.manufacturing_stations)
  const droneTargets = formatDroneTargetsInput(config.drones?.targets ?? [])
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const rotationMode = scheduleMode === 'rotation'
  const isScheduleModeSelected = (mode: 'maa' | 'rotation') => mode === 'maa' ? !rotationMode : scheduleMode === mode
  const variableShiftMode = isVariableShiftScheduleEnabled(config)
  const fiammettaShiftHoursSupported = !variableShiftMode && isFiammettaShiftHoursSupported(config.shift_hours)
  const validationMessage = validation.ok === false ? validation.message : null
  const intermediateInventory = normalizeIntermediateInventory(config.intermediate_inventory)
  const orundumPlanning = normalizeOrundumPlanning(config)
  const showOrundumPlanning =
    (config.product_requirements.trading_stations.Orundum ?? 0) > 0 ||
    (config.product_requirements.manufacturing_stations['Originium Shard'] ?? 0) > 0

  const applyPreset = (preset: LicenseConfig) => {
    onUpdate((next) => {
      const copy = normalizeConfig(preset)
      Object.assign(next, copy)
      delete next.auto_balance_source
    })
  }

  const setStationCounts = (tradingCount: number, manufacturingCount: number) => {
    onUpdate((next) => {
      next.trading_stations_count = tradingCount
      next.manufacturing_stations_count = manufacturingCount
      next.product_requirements.trading_stations = fitProductCounts(
        next.product_requirements.trading_stations,
        tradingProducts,
        tradingCount,
        'LMD'
      )
      next.product_requirements.manufacturing_stations = fitProductCounts(
        next.product_requirements.manufacturing_stations,
        manufacturingProducts,
        manufacturingCount,
        'Pure Gold'
      )
      applyCounts(next)
    })
  }

  const setProductCount = (group: ProductGroup, product: string, value: number) => {
    onUpdate((next) => {
      next.product_requirements[group][product] = Math.max(0, Math.min(6, value))
      applyCounts(next)
    })
  }

  const setIntermediateInventory = (product: IntermediateProduct, value: number) => {
    onUpdate((next) => {
      const stock = Number.isFinite(value) ? Math.max(0, value) : 0
      next.intermediate_inventory = {
        ...normalizeIntermediateInventory(next.intermediate_inventory),
        [product]: stock,
      }
      markIntermediateInventoryForOptimizer(next)
      applyCounts(next)
    })
  }

  const setOrundumDailySanityBudget = (value: number) => {
    onUpdate((next) => {
      next.orundum_planning = {
        ...(next.orundum_planning ?? {}),
        daily_sanity_budget: Number.isFinite(value) ? Math.max(0, value) : BASE_DAILY_SANITY_BUDGET,
      }
      applyCounts(next)
    })
  }

  const setOrundumMonthlyCard = (enabled: boolean) => {
    onUpdate((next) => {
      next.orundum_planning = {
        ...(next.orundum_planning ?? {}),
        daily_sanity_budget: normalizeOrundumPlanning(next).daily_sanity_budget,
        monthly_card: enabled,
      }
      applyCounts(next)
    })
  }

  return (
    <section className={embedded ? '' : 'tool-panel p-5 sm:p-6'}>
      {!hideHeader && (
      <div className="flex flex-col gap-4 border-b border-surface-3/60 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">{copy.common.components_ConfigEditor_021}</h2>
            {changed && (
              <span className="tool-status tool-status--warning">
                {copy.common.components_ConfigEditor_022}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            {note ?? (canEdit
              ? copy.common.components_ConfigEditor_023
              : autoInventoryOnly
                ? `${copy.common.components_ConfigEditor_024}${permission ? PERMISSION_LABELS[permission] : copy.common.components_ConfigEditor_026}${copy.common.components_ConfigEditor_025}`
                : `${copy.common.components_ConfigEditor_027}${permission ? PERMISSION_LABELS[permission] : copy.common.components_ConfigEditor_029}${copy.common.components_ConfigEditor_028}`)}
          </p>
        </div>
          {!hidePresetActions && (canEdit || (canSelectPreset && !autoInventoryOnly)) && (
          <div className="flex flex-wrap gap-2" data-tour-target="config-preset-actions">
            <PresetButton label={copy.common.components_ConfigEditor_030} onClick={() => applyPreset(CONFIG_PRESETS['243'])} />
            <PresetButton label={copy.common.components_ConfigEditor_031} onClick={() => applyPreset(CONFIG_PRESETS['243-1'])} />
            <PresetButton label={copy.common.components_ConfigEditor_032} onClick={() => applyPreset(CONFIG_PRESETS['333'])} />
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                disabled={!changed}
                className="tool-secondary-action px-3 py-2 text-sm"
              >
                {resetLabel}
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {autoInventoryOnly ? (
        <div className="pt-5">
          <div className="tool-inset p-4">
            <h3 className="font-semibold text-ink-primary">{copy.common.components_ConfigEditor_033}</h3>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {copy.common.components_ConfigEditor_034}</p>
            {!hidePresetActions && canSelectPreset && (
              <div className="mt-4 flex flex-wrap gap-2" data-tour-target="config-preset-actions">
                <PresetButton label={copy.common.components_ConfigEditor_035} onClick={() => applyPreset(CONFIG_PRESETS['243'])} />
                <PresetButton label={copy.common.components_ConfigEditor_036} onClick={() => applyPreset(CONFIG_PRESETS['243-1'])} />
                <PresetButton label={copy.common.components_ConfigEditor_037} onClick={() => applyPreset(CONFIG_PRESETS['333'])} />
              </div>
            )}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-ink-muted">{copy.common.components_ConfigEditor_038}</p>
                <div className="tool-inset grid grid-cols-2 gap-2 p-1" role="group" aria-label={copy.common.components_ConfigEditor_039}>
                  {(['maa', 'rotation'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={isScheduleModeSelected(mode)}
                      onClick={() => onUpdate((next) => {
                        next.schedule_mode = mode
                        applyCounts(next)
                      })}
                      className={`tool-secondary-action min-h-11 px-3 text-sm ${
                        isScheduleModeSelected(mode)
                          ? 'tool-option-selected'
                          : 'border-transparent bg-transparent text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary'
                      }`}
                    >
                      {SCHEDULE_MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-5 text-ink-muted">
                  {rotationMode
                    ? copy.common.components_ConfigEditor_062
                    : copy.common.components_ConfigEditor_095}
                </p>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-ink-muted">{copy.common.components_ConfigEditor_040}</p>
                <div className="tool-inset grid grid-cols-2 gap-2 p-1" role="group" aria-label={copy.common.components_ConfigEditor_041}>
                  {(['fixed', 'maa_autofill'] as const).map((rule) => (
                    <button
                      key={rule}
                      type="button"
                      aria-pressed={normalizeDormitoryRule(config.dormitory_rule) === rule}
                      disabled={rotationMode}
                      onClick={() => onUpdate((next) => {
                        next.dormitory_rule = rule
                        applyCounts(next)
                      })}
                      className={`tool-secondary-action min-h-11 px-3 text-sm disabled:cursor-not-allowed ${
                        normalizeDormitoryRule(config.dormitory_rule) === rule
                          ? 'tool-option-selected'
                          : 'border-transparent bg-transparent text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary disabled:text-ink-muted'
                      }`}
                    >
                      {DORMITORY_RULE_LABELS[rule]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <IntermediateInventoryEditor
                canEdit={canUseIntermediateInventory}
                inventory={intermediateInventory}
                showOrirock={showOrundumPlanning}
                onChange={setIntermediateInventory}
              />
            </div>
          </div>
        </div>
      ) : (
      <div className="space-y-5 pt-5">
        <div className="tool-inset bg-surface-2/60 p-4">
          <div className="grid gap-5 lg:grid-cols-[minmax(14rem,0.85fr)_minmax(0,2.15fr)]">
            <section aria-labelledby="config-room-layout-heading">
              <div className="mb-4">
                <h3 id="config-room-layout-heading" className="font-semibold text-ink-primary">{copy.common.components_ConfigEditor_042}</h3>
                <p className="mt-1 text-xs text-ink-muted">{copy.common.components_ConfigEditor_043}{config.layout}</p>
                <p className="tool-alert tool-alert--warning mt-3 px-3 py-2 text-xs leading-5" role="note">
                  {copy.common.components_ConfigEditor_094}
                </p>
              </div>
              {canEdit ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <CounterField
                    id="trading-stations-count"
                    label={copy.common.components_ConfigEditor_044}
                    value={config.trading_stations_count}
                    min={1}
                    max={5}
                    onChange={(value) => setStationCounts(value, 6 - value)}
                  />
                  <CounterField
                    id="manufacturing-stations-count"
                    label={copy.common.components_ConfigEditor_045}
                    value={config.manufacturing_stations_count}
                    min={1}
                    max={5}
                    onChange={(value) => setStationCounts(6 - value, value)}
                  />
                </div>
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
                  <ReadOnlyMetric label={copy.common.components_ConfigEditor_046} value={config.trading_stations_count} />
                  <ReadOnlyMetric label={copy.common.components_ConfigEditor_047} value={config.manufacturing_stations_count} />
                </dl>
              )}
            </section>

            <section
              aria-labelledby="config-product-counts-heading"
              className="border-t border-surface-3/60 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"
            >
              <h3 id="config-product-counts-heading" className="font-semibold text-ink-primary">{copy.common.components_ConfigEditor_048}</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ProductGroupEditor
                  label={copy.common.components_ConfigEditor_049}
                  products={tradingProducts}
                  counts={config.product_requirements.trading_stations}
                  canEdit={canEdit}
                  onChange={(product, value) => setProductCount('trading_stations', product, value)}
                />
                <ProductGroupEditor
                  label={copy.common.components_ConfigEditor_050}
                  products={manufacturingProducts}
                  counts={config.product_requirements.manufacturing_stations}
                  canEdit={canEdit}
                  onChange={(product, value) => setProductCount('manufacturing_stations', product, value)}
                />
              </div>
            </section>
          </div>

          <div className="mt-5 border-t border-surface-3/60 pt-5">
            <IntermediateInventoryEditor
              canEdit={canEdit}
              inventory={intermediateInventory}
              showOrirock={showOrundumPlanning}
              onChange={setIntermediateInventory}
            />
          </div>
        </div>

        <div className="tool-inset bg-surface-2/60 p-4">
          <h3 className="font-semibold text-ink-primary">{copy.common.components_ConfigEditor_051}</h3>
          <div className="mt-4 space-y-4">
            {showOrundumPlanning && (
              <div className="tool-inset px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-medium text-ink-primary">{copy.common.components_ConfigEditor_052}</p>
                  <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink-secondary sm:min-w-36">
                    <span>{copy.common.components_ConfigEditor_056}</span>
                    <input
                      type="checkbox"
                      checked={orundumPlanning.monthly_card}
                      disabled={!canEdit}
                      onChange={(event) => setOrundumMonthlyCard(event.currentTarget.checked)}
                      className="h-4 w-4 accent-brand-500"
                    />
                  </label>
                </div>
                <label className="mt-2 flex min-h-11 items-center justify-between gap-3 text-sm text-ink-secondary">
                  <span>{copy.common.components_ConfigEditor_057}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={orundumPlanning.daily_sanity_budget}
                    disabled={!canEdit}
                    onChange={(event) => setOrundumDailySanityBudget(Number(event.currentTarget.value))}
                    className="number-input-clean tool-field w-24 px-3 py-1 text-right disabled:text-ink-muted"
                  />
                </label>
                <details className="mt-2 border-t border-surface-3/60">
                  <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium leading-5 text-ink-secondary">
                    {copy.common.components_ConfigEditor_059_details_summary}
                  </summary>
                  <div className="space-y-1 pb-3 text-xs leading-5 text-ink-muted">
                    <p>{copy.common.components_ConfigEditor_053}{BASE_DAILY_SANITY_BUDGET}{copy.common.components_ConfigEditor_054}{MONTHLY_CARD_DAILY_SANITY_BONUS}{copy.common.components_ConfigEditor_055}</p>
                    <p>{copy.common.components_ConfigEditor_058}{orundumPlanning.total_daily_sanity_budget}{copy.common.components_ConfigEditor_059}</p>
                  </div>
                </details>
              </div>
            )}
              <div>
              <p className="mb-2 text-xs font-medium text-ink-muted">{copy.common.components_ConfigEditor_060}</p>
              <div className="tool-inset grid grid-cols-2 gap-2 p-1" role="group" aria-label={copy.common.components_ConfigEditor_061}>
                {(['maa', 'rotation'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={isScheduleModeSelected(mode)}
                    disabled={false}
                    onClick={() => onUpdate((next) => {
                      next.schedule_mode = mode
                      applyCounts(next)
                    })}
                    className={`tool-secondary-action min-h-11 px-3 text-sm ${
                      isScheduleModeSelected(mode)
                        ? 'tool-option-selected'
                        : 'border-transparent bg-transparent text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary'
                    }`}
                  >
                    {SCHEDULE_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-muted">
                {rotationMode
                  ? copy.common.components_ConfigEditor_062
                  : copy.common.components_ConfigEditor_095}
              </p>
            </div>
            {!rotationMode && (
              <ShiftHoursEditor
                value={config.shift_hours}
                variableMode={variableShiftMode}
                canEdit={canEdit}
                onSelectVariable={() => onUpdate((next) => {
                  next.schedule_mode = 'variable'
                  next.shift_hours = [8, 8, 8]
                  next.Fiammetta = { ...(next.Fiammetta ?? { enable: false }), enable: false }
                  next.variable_shift_schedule = {
                    ...(next.variable_shift_schedule ?? {}),
                    ...VARIABLE_SHIFT_SCHEDULE_DEFAULTS,
                  }
                  applyCounts(next)
                })}
                onChange={(hours) => onUpdate((next) => {
                  next.schedule_mode = 'maa'
                  next.shift_hours = hours
                  if (!isFiammettaShiftHoursSupported(hours)) {
                    next.Fiammetta = { ...(next.Fiammetta ?? { enable: false }), enable: false }
                  }
                  next.variable_shift_schedule = {
                    ...(next.variable_shift_schedule ?? {}),
                    enable: false,
                    enabled: false,
                  }
                  applyCounts(next)
                })}
              />
            )}
            <div>
              <p className="mb-2 text-xs font-medium text-ink-muted">{copy.common.components_ConfigEditor_063}</p>
              <div className="tool-inset grid grid-cols-2 gap-2 p-1" role="group" aria-label={copy.common.components_ConfigEditor_064}>
                {(['fixed', 'maa_autofill'] as const).map((rule) => (
                  <button
                    key={rule}
                    type="button"
                    aria-pressed={normalizeDormitoryRule(config.dormitory_rule) === rule}
                    disabled={rotationMode}
                    onClick={() => onUpdate((next) => {
                      next.dormitory_rule = rule
                      applyCounts(next)
                    })}
                    className={`tool-secondary-action min-h-11 px-3 text-sm disabled:cursor-not-allowed ${
                      normalizeDormitoryRule(config.dormitory_rule) === rule
                        ? 'tool-option-selected'
                        : 'border-transparent bg-transparent text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary disabled:text-ink-muted'
                    }`}
                  >
                    {DORMITORY_RULE_LABELS[rule]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-muted">
                {rotationMode
                  ? copy.common.components_ConfigEditor_065
                  : normalizeDormitoryRule(config.dormitory_rule) === 'maa_autofill'
                    ? copy.common.components_ConfigEditor_066
                    : copy.common.components_ConfigEditor_067}
              </p>
            </div>
          <label className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
            <span>{copy.common.components_ConfigEditor_068}</span>
              <input
                type="checkbox"
                checked={!rotationMode && fiammettaShiftHoursSupported && (config.Fiammetta?.enable ?? false)}
                disabled={!canEdit || rotationMode || !fiammettaShiftHoursSupported}
                onChange={(event) => onUpdate((next) => {
                  next.Fiammetta = { enable: event.currentTarget.checked }
                  applyCounts(next)
                })}
                className="h-4 w-4 accent-brand-500"
              />
            </label>
            {rotationMode ? (
              <p className="tool-inset px-3 py-2 text-xs leading-5 text-ink-muted">
                {copy.common.components_ConfigEditor_069}</p>
            ) : (!fiammettaShiftHoursSupported || config.Fiammetta?.enable) && (
              <p className="tool-alert tool-alert--warning px-3 py-2 text-xs leading-5">
                {copy.common.components_ConfigEditor_070}</p>
            )}
            <label className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
              <span>{copy.common.components_ConfigEditor_071}</span>
              <input
                type="checkbox"
                  checked={!rotationMode && (config.drones?.enable ?? false)}
                  disabled={!canEdit || rotationMode}
                onChange={(event) => onUpdate((next) => {
                  next.drones = {
                    ...(next.drones ?? { order: 'pre', targets: [] }),
                    enable: event.currentTarget.checked,
                    auto: next.drones?.auto ?? true,
                  }
                  applyCounts(next)
                })}
                className="h-4 w-4 accent-brand-500"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
              <span>{copy.common.components_ConfigEditor_072}</span>
              <input
                type="checkbox"
                  checked={!rotationMode && (config.drones?.auto ?? false)}
                  disabled={!canEdit || rotationMode || !config.drones?.enable}
                onChange={(event) => onUpdate((next) => {
                  next.drones = {
                    ...(next.drones ?? { enable: true, order: 'pre', targets: [] }),
                    auto: event.currentTarget.checked,
                  }
                  applyCounts(next)
                })}
                className="h-4 w-4 accent-brand-500"
              />
            </label>
            <div>
              <label className="mb-2 block text-xs font-medium text-ink-muted" htmlFor="drone-order">
                {copy.common.components_ConfigEditor_073}</label>
              <select
                id="drone-order"
                value={config.drones?.order ?? 'pre'}
                disabled={!canEdit || rotationMode || !config.drones?.enable}
                onChange={(event) => onUpdate((next) => {
                  next.drones = {
                    ...(next.drones ?? { enable: true, targets: [] }),
                    order: event.currentTarget.value,
                  }
                  applyCounts(next)
                })}
                className="tool-field disabled:text-ink-muted"
              >
                <option value="pre">{copy.common.components_ConfigEditor_074}</option>
                <option value="post">{copy.common.components_ConfigEditor_075}</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-ink-muted" htmlFor="drone-targets">
                {copy.common.components_ConfigEditor_076}</label>
                <DroneTargetsInput
                  id="drone-targets"
                  value={droneTargets}
                disabled={!canEdit || rotationMode || !config.drones?.enable || Boolean(config.drones?.auto)}
                  onChange={(value) => onUpdate((next) => {
                    next.drones = {
                      ...(next.drones ?? { enable: true, order: 'pre' }),
                    targets: parseDroneTargetsInput(value),
                    }
                    applyCounts(next)
                  })}
                />
            </div>
          </div>
        </div>
      </div>
      )}
      {validationMessage && (
        <p className="tool-alert tool-alert--warning mt-4" role="alert">{validationMessage}</p>
      )}
    </section>
  )
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tool-secondary-action px-3 py-2 text-sm"
    >
      {label}
    </button>
  )
}

function uniqueProducts(defaults: string[], counts: Record<string, number>): string[] {
  return Array.from(new Set([...defaults, ...Object.keys(counts ?? {})]))
}

function fitProductCounts(
  current: Record<string, number>,
  products: string[],
  total: number,
  fallbackProduct: string
): Record<string, number> {
  const next: Record<string, number> = {}
  let remaining = total
  for (const product of products) {
    const count = Math.max(0, Math.min(remaining, current[product] ?? 0))
    if (count > 0) {
      next[product] = count
      remaining -= count
    }
  }
  if (remaining > 0) {
    next[fallbackProduct] = (next[fallbackProduct] ?? 0) + remaining
  }
  return next
}

function formatProductName(product: string): string {
  return PRODUCT_LABELS[product] ?? product
}

function parseProductName(value: string): string {
  const text = value.trim()
  if (!text) return ''
  const matched = Object.entries(PRODUCT_LABELS).find(([key, label]) => key === text || label === text)
  return matched?.[0] ?? text
}

function formatDroneTargetsInput(targets: string[]): string {
  return targets.map(formatProductName).join('，')
}

function parseDroneTargetsInput(value: string): string[] {
  return value.split(/[，,]/).map(parseProductName).filter(Boolean)
}

function formatStockValue(value: number | null): string {
  return value === null ? '' : String(value)
}

function IntermediateInventoryEditor({
  canEdit,
  inventory,
  showOrirock,
  onChange,
}: {
  canEdit: boolean;
  inventory: Record<IntermediateProduct, number>;
  showOrirock: boolean;
  onChange: (product: IntermediateProduct, value: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-muted">{copy.common.components_ConfigEditor_077}</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <IntermediateInventoryField
          label={copy.common.components_ConfigEditor_078}
          product="Originium Shard"
          value={inventory['Originium Shard']}
          canEdit={canEdit}
          onChange={onChange}
        />
        <IntermediateInventoryField
          label={copy.common.components_ConfigEditor_079}
          product="Pure Gold"
          value={inventory['Pure Gold']}
          canEdit={canEdit}
          onChange={onChange}
        />
        {showOrirock && (
          <IntermediateInventoryField
            label={copy.common.components_ConfigEditor_080}
            product="Orirock Cube"
            value={inventory['Orirock Cube']}
            canEdit={canEdit}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  )
}

function IntermediateInventoryField({
  label,
  product,
  value,
  canEdit,
  onChange,
}: {
  label: string;
  product: IntermediateProduct;
  value: number;
  canEdit: boolean;
  onChange: (product: IntermediateProduct, value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(() => formatStockValue(value))

  useEffect(() => {
    setDraftValue(formatStockValue(value))
  }, [value])

  const commitDraft = () => {
    if (!canEdit) return
    const nextValue = draftValue.trim() === '' ? 0 : Number(draftValue)
    if (Number.isFinite(nextValue) && nextValue !== value) {
      onChange(product, nextValue)
    } else {
      setDraftValue(formatStockValue(value))
    }
  }

  return (
    <label className="tool-inset block px-3 py-3 text-sm">
      <span className="flex items-center justify-between gap-3">
        <span className="text-ink-secondary">{label}</span>
        <input
          type="number"
          min={0}
          step={1}
          value={draftValue}
          disabled={!canEdit}
          onChange={(event) => {
            const nextDraftValue = event.currentTarget.value
            setDraftValue(nextDraftValue)
            if (!canEdit || nextDraftValue.trim() === '') return
            const nextValue = Number(nextDraftValue)
            if (Number.isFinite(nextValue) && nextValue !== value) onChange(product, nextValue)
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
          className="number-input-clean tool-field w-24 px-3 py-1 text-right disabled:text-ink-muted"
        />
      </span>
    </label>
  )
}

function ShiftHoursEditor({
  value,
  variableMode,
  canEdit,
  onSelectVariable,
  onChange,
}: {
  value: LicenseConfig['shift_hours'];
  variableMode: boolean;
  canEdit: boolean;
  onSelectVariable: () => void;
  onChange: (hours: number[]) => void;
}) {
  const normalized = parseShiftHours(value) ?? [8, 8, 8]
  const formatted = normalized.join('-')
  const [draftValue, setDraftValue] = useState(formatted)
  const [error, setError] = useState<string | null>(null)
  const [customSelected, setCustomSelected] = useState(false)
  const inferredChoice = variableMode ? 'variable' : inferShiftScheduleChoice(normalized)
  const selectedChoice: ShiftScheduleChoice = customSelected ? 'custom' : inferredChoice

  useEffect(() => {
    setDraftValue(formatted)
    setError(null)
  }, [formatted])

  const commitDraft = () => {
    if (!canEdit) return
    const parsed = parseShiftHours(draftValue)
    if (!parsed || !isValidShiftHours(parsed)) {
      setError(copy.common.components_ConfigEditor_081)
      return
    }
    setError(null)
    setDraftValue(parsed.join('-'))
    if (variableMode
      || parsed.some((hours, index) => Math.abs(hours - (normalized[index] ?? -1)) > 0.0001)
      || parsed.length !== normalized.length) {
      onChange(parsed)
    }
  }

  const selectChoice = (choice: typeof SHIFT_SCHEDULE_OPTIONS[number]) => {
    if (!canEdit) return
    if (choice.id === 'custom') {
      setCustomSelected(true)
      return
    }
    setCustomSelected(false)
    if (choice.id === 'variable') {
      onSelectVariable()
      return
    }
    onChange([...choice.hours])
  }

  return (
    <div>
      <p id="config-shift-schedule-label" className="mb-2 text-xs font-medium text-ink-muted">{copy.common.components_ConfigEditor_086}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5" role="group" aria-labelledby="config-shift-schedule-label">
        {SHIFT_SCHEDULE_OPTIONS.map((choice) => (
          <button
            key={choice.id}
            type="button"
            aria-pressed={selectedChoice === choice.id}
            disabled={!canEdit}
            onClick={() => selectChoice(choice)}
            className={`tool-secondary-action min-h-11 whitespace-normal px-2 py-2 text-xs leading-5 disabled:cursor-not-allowed disabled:text-ink-muted sm:text-sm ${
              selectedChoice === choice.id
                ? 'tool-option-selected'
                : 'border-transparent bg-transparent text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary'
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {selectedChoice === 'custom' && (
        <div className="mt-3">
          <label htmlFor="config-shift-hours" className="mb-2 block text-xs font-medium text-ink-muted">{copy.common.components_ConfigEditor_082}</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="config-shift-hours"
              type="text"
              inputMode="decimal"
              value={draftValue}
              disabled={!canEdit}
              aria-invalid={Boolean(error)}
              aria-describedby="config-shift-hours-help"
              onChange={(event) => setDraftValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitDraft()
              }}
              className="tool-field min-w-0 flex-1 tabular-nums"
            />
            {canEdit && (
              <button
                type="button"
                onClick={commitDraft}
                className="tool-secondary-action"
              >
                {copy.common.components_ConfigEditor_083}</button>
            )}
          </div>
          <p id="config-shift-hours-help" role={error ? 'alert' : undefined} className={`mt-2 text-xs leading-5 ${error ? 'text-error' : 'text-ink-muted'}`}>
            {error ?? copy.common.components_ConfigEditor_084}
          </p>
        </div>
      )}
      {selectedChoice !== 'custom' && (
        <p className="mt-2 text-xs leading-5 text-ink-muted">
          {selectedChoice === 'variable'
            ? copy.common.components_ConfigEditor_092
            : copy.common.components_ConfigEditor_093}
        </p>
      )}
    </div>
  )
}

function inferShiftScheduleChoice(hours: number[]): ShiftScheduleChoice {
  for (const choice of SHIFT_SCHEDULE_OPTIONS) {
    if (!('hours' in choice)) continue
    if (choice.hours.length === hours.length
      && choice.hours.every((value, index) => Math.abs(value - hours[index]!) <= 0.0001)) {
      return choice.id
    }
  }
  return 'custom'
}

function DroneTargetsInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(value)

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  const commitDraft = () => {
    if (disabled) return
    if (draftValue !== value) {
      onChange(draftValue)
    }
  }

  return (
    <input
      id={id}
      type="text"
      value={draftValue}
      disabled={disabled}
      onChange={(event) => setDraftValue(event.currentTarget.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      placeholder={copy.common.components_ConfigEditor_085}
      className="tool-field placeholder:text-ink-muted disabled:text-ink-muted"
    />
  )
}

function CounterField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-medium text-ink-muted">{label}</label>
      <InputNumber
        id={id}
        label={label}
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        className="w-full"
      />
    </div>
  )
}

function ReadOnlyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="tool-inset px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-ink-primary">{value}</dd>
    </div>
  )
}

function ProductGroupEditor({
  label,
  products,
  counts,
  canEdit,
  onChange,
}: {
  label: string;
  products: string[];
  counts: Record<string, number>;
  canEdit: boolean;
  onChange: (product: string, value: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-muted">{label}</p>
      <div className="grid gap-2">
        {products.map((product) => (
        <div key={product} className="tool-inset flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="text-ink-secondary">{PRODUCT_LABELS[product] ?? product}</span>
          {canEdit ? (
            <ProductCountInput
              label={PRODUCT_LABELS[product] ?? product}
              value={counts[product] ?? 0}
              onChange={(value) => onChange(product, value)}
            />
          ) : (
            <span className="font-semibold text-ink-primary">{counts[product] ?? 0}</span>
          )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ProductCountInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <InputNumber
      label={label}
      value={value}
      min={0}
      max={6}
      onChange={onChange}
      className="w-36 max-w-full shrink-0"
    />
  )
}
