import { useEffect, useState } from 'react'
import type { LicenseConfig, PermissionMode } from '../lib/types'

type ProductGroup = 'trading_stations' | 'manufacturing_stations'

export const TRADING_PRODUCTS = ['LMD', 'Orundum']
export const MANUFACTURING_PRODUCTS = ['Pure Gold', 'Battle Record', 'Originium Shard']

export const PRODUCT_LABELS: Record<string, string> = {
  LMD: '龙门币',
  Orundum: '合成玉',
  'Pure Gold': '赤金',
  'Battle Record': '作战记录',
  'Originium Shard': '源石碎片',
}

export const SCHEDULE_MODE_LABELS: Record<string, string> = {
  maa: 'MAA 排班表',
  rotation: '游戏内轮换',
}

const DEFAULT_SHIFT_HOURS = [8, 8, 8]
const SHIFT_PRESETS = [
  { label: '8-8-8', value: [8, 8, 8], note: '24h 固定间隔' },
  { label: '12-12-12', value: [12, 12, 12], note: '12h 固定间隔' },
  { label: '12-6-6', value: [12, 6, 6], note: '24h 非固定间隔' },
]

type IntermediateProduct = 'Originium Shard' | 'Pure Gold'

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  recommended: '单次重置卡',
  growth: '练度提升卡',
  advanced: '单账号终身卡',
  ultimate: 'Admin卡',
  admin: 'Admin卡',
}

export const CONFIG_PRESETS: Record<string, LicenseConfig> = {
  '243': {
    layout: '2-4-3',
    desc: '243 均衡流 (2赤金/2经验)',
    schedule_mode: 'maa',
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
    desc: '243 搓玉 (2赤金/2源石)',
    schedule_mode: 'maa',
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
    desc: '333 搓玉流',
    schedule_mode: 'maa',
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

export function cloneConfig(config: LicenseConfig): LicenseConfig {
  return JSON.parse(JSON.stringify(config)) as LicenseConfig
}

export function normalizeScheduleMode(mode: unknown): 'maa' | 'rotation' {
  const modeText = String(mode ?? 'maa').trim().toLowerCase()
  return ['rotation', 'rotate', 'game_rotation', 'in_game_rotation', '轮换', '轮换模式', '游戏内轮换'].includes(modeText)
    ? 'rotation'
    : 'maa'
}

function parseShiftHours(value: unknown): number[] | null {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[-,，、\s]+/).filter(Boolean)
      : null
  if (!items) return null
  const hours = items.map((item) => Number(item))
  if (hours.length === 0 || hours.length > 6) return null
  if (hours.some((hour) => !Number.isFinite(hour) || hour <= 0)) return null
  return hours.map((hour) => Math.round(hour * 100) / 100)
}

function isFixedShiftHours(hours: number[]): boolean {
  return hours.length > 0 && hours.every((hour) => Math.abs(hour - hours[0]) <= 0.0001)
}

function isValidShiftHours(hours: number[]): boolean {
  const total = hours.reduce((sum, hour) => sum + hour, 0)
  if (Math.abs(total - 24) <= 0.0001) return true
  return isFixedShiftHours(hours) && (Math.abs(hours[0] - 8) <= 0.0001 || Math.abs(hours[0] - 12) <= 0.0001)
}

function formatShiftHours(value: unknown): string {
  if (typeof value === 'string') return value
  const hours = parseShiftHours(value) ?? DEFAULT_SHIFT_HOURS
  return hours.map((hour) => String(hour)).join('-')
}

function sumCounts(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
}

export function normalizeConfig(config: LicenseConfig): LicenseConfig {
  const next = cloneConfig(config)
  next.product_requirements = {
    trading_stations: { ...(next.product_requirements?.trading_stations ?? {}) },
    manufacturing_stations: { ...(next.product_requirements?.manufacturing_stations ?? {}) },
  }
  next.trading_stations_count = Number.isFinite(next.trading_stations_count) ? next.trading_stations_count : 2
  next.manufacturing_stations_count = Number.isFinite(next.manufacturing_stations_count) ? next.manufacturing_stations_count : 4
  next.schedule_mode = normalizeScheduleMode(next.schedule_mode ?? next.mode)
  next.shift_hours = parseShiftHours(next.shift_hours) ?? [...DEFAULT_SHIFT_HOURS]
  next.layout = next.layout || `${next.trading_stations_count}-${next.manufacturing_stations_count}-3`
  next.desc = next.desc || `${next.layout} 基建配置`
  next.Fiammetta = next.Fiammetta ?? { enable: false }
  next.drones = {
    enable: next.drones?.enable ?? false,
    auto: next.drones?.auto ?? false,
    auto_strategy: next.drones?.auto_strategy,
    auto_target_product: next.drones?.auto_target_product,
    order: next.drones?.order ?? 'pre',
    targets: Array.isArray(next.drones?.targets) ? next.drones.targets : [],
  }
  next.intermediate_inventory = normalizeIntermediateInventory(next.intermediate_inventory)
  return next
}

function applyCounts(config: LicenseConfig): LicenseConfig {
  config.layout = `${config.trading_stations_count}-${config.manufacturing_stations_count}-3`
  config.desc = `${config.layout} 自定义配置`
  return config
}

export function validateConfig(config: LicenseConfig): { ok: true } | { ok: false; message: string } {
  const rotationMode = normalizeScheduleMode(config.schedule_mode) === 'rotation'
  const tradingCount = config.trading_stations_count
  const manufacturingCount = config.manufacturing_stations_count
  if (!Number.isInteger(tradingCount) || !Number.isInteger(manufacturingCount)) {
    return { ok: false, message: '贸易站和制造站数量必须是整数。' }
  }
  if (tradingCount < 1 || manufacturingCount < 1 || tradingCount + manufacturingCount !== 6) {
    return { ok: false, message: '当前版本固定 3 个发电站，贸易站 + 制造站需要等于 6。' }
  }
  const tradingTotal = sumCounts(config.product_requirements.trading_stations)
  if (tradingTotal !== tradingCount) {
    return { ok: false, message: `贸易产物数量合计为 ${tradingTotal}，需要等于 ${tradingCount}。` }
  }
  const manufacturingTotal = sumCounts(config.product_requirements.manufacturing_stations)
  if (manufacturingTotal !== manufacturingCount) {
    return { ok: false, message: `制造产物数量合计为 ${manufacturingTotal}，需要等于 ${manufacturingCount}。` }
  }
  const shiftHours = parseShiftHours(config.shift_hours)
  if (!rotationMode && (!shiftHours || !isValidShiftHours(shiftHours))) {
    return { ok: false, message: '换班间隔需填写为 8-8-8、12-12-12，或合计 24 小时的非固定节奏，例如 12-6-6。' }
  }
  if (!rotationMode && config.drones?.enable && !config.drones.auto && (!Array.isArray(config.drones.targets) || config.drones.targets.length === 0)) {
    return { ok: false, message: '启用无人机时至少需要一个加速目标。' }
  }
  return { ok: true }
}

function normalizeIntermediateInventory(value: unknown): Record<IntermediateProduct, number> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const next: Record<IntermediateProduct, number> = {
    'Originium Shard': 0,
    'Pure Gold': 0,
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

function setAutoDroneManufacturing(config: LicenseConfig, product: IntermediateProduct): void {
  bindAutoDrones(config)
  config.drones = {
    ...config.drones!,
    auto_strategy: 'manufacture_product',
    auto_target_product: product,
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
  canEditShiftHours?: boolean;
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
  canEditShiftHours,
  canSelectPreset = false,
  changed = false,
  permission,
  validation,
  onUpdate,
  onReset,
  resetLabel = '恢复授权配置',
  note,
  embedded = false,
  hideHeader = false,
  hidePresetActions = false,
}: ConfigEditorProps) {
  const canUseIntermediateInventory = canEdit || Boolean(canEditIntermediateInventory)
  const autoInventoryOnly = !canEdit && canUseIntermediateInventory
  const tradingProducts = uniqueProducts(TRADING_PRODUCTS, config.product_requirements.trading_stations)
  const manufacturingProducts = uniqueProducts(MANUFACTURING_PRODUCTS, config.product_requirements.manufacturing_stations)
  const droneTargets = (config.drones?.targets ?? []).join(', ')
  const shiftHours = parseShiftHours(config.shift_hours) ?? DEFAULT_SHIFT_HOURS
  const shiftHoursText = formatShiftHours(config.shift_hours ?? shiftHours)
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const rotationMode = scheduleMode === 'rotation'
  const canUseShiftHours = !rotationMode && (canEdit || Boolean(canEditShiftHours))
  const validationMessage = validation.ok === false ? validation.message : null
  const intermediateInventory = normalizeIntermediateInventory(config.intermediate_inventory)

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

  return (
    <section className={embedded ? '' : 'bg-surface-1 rounded-xl p-5 sm:p-6'}>
      {!hideHeader && (
      <div className="flex flex-col gap-4 border-b border-surface-3/60 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">基建配置</h2>
            {changed && (
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                已修改
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            {note ?? (canEdit
              ? '修改配置后重新生成，保存进度文件会保留这次配置。'
              : autoInventoryOnly
? `当前为 ${permission ? PERMISSION_LABELS[permission] : '练度提升卡'} 权限，可通过中间产物库存自动调整推荐配置。`
                : `当前为 ${permission ? PERMISSION_LABELS[permission] : '练度提升卡'} 权限，使用当前套餐提供的固定配置。`)}
          </p>
        </div>
          {!hidePresetActions && (canEdit || (canSelectPreset && !autoInventoryOnly)) && (
          <div className="flex flex-wrap gap-2">
            <PresetButton label="243 均衡" onClick={() => applyPreset(CONFIG_PRESETS['243'])} />
            <PresetButton label="243 搓玉" onClick={() => applyPreset(CONFIG_PRESETS['243-1'])} />
            <PresetButton label="333 搓玉" onClick={() => applyPreset(CONFIG_PRESETS['333'])} />
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                disabled={!changed}
                className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:cursor-not-allowed disabled:text-ink-muted"
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
          <div className="rounded-lg bg-surface-2/60 p-4">
            <h3 className="font-semibold text-ink-primary">按库存微调产物</h3>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              先选择 243 或 333 预设；库存充足时保留原产物消耗，库存较少时只调整一个制造站产物。
            </p>
            {!hidePresetActions && canSelectPreset && (
              <div className="mt-4 flex flex-wrap gap-2">
                <PresetButton label="243 均衡" onClick={() => applyPreset(CONFIG_PRESETS['243'])} />
                <PresetButton label="243 搓玉" onClick={() => applyPreset(CONFIG_PRESETS['243-1'])} />
                <PresetButton label="333 搓玉" onClick={() => applyPreset(CONFIG_PRESETS['333'])} />
              </div>
            )}
            <div className="mt-4">
              <IntermediateInventoryEditor
                canEdit={canUseIntermediateInventory}
                inventory={intermediateInventory}
                onChange={setIntermediateInventory}
              />
            </div>
            <div className="mt-5 border-t border-surface-3/60 pt-4">
              <p className="mb-2 text-xs font-medium text-ink-muted">换班间隔</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {SHIFT_PRESETS.map((preset) => {
                  const active = shiftHoursText === formatShiftHours(preset.value)
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      disabled={!canUseShiftHours}
                      onClick={() => onUpdate((next) => {
                        next.shift_hours = [...preset.value]
                        next.auto_balance_source = 'limited_config'
                        applyCounts(next)
                      })}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed ${
                        active
                          ? 'border-brand-500 bg-brand-500/10 text-brand-300'
                          : 'border-surface-4 bg-surface-1 text-ink-secondary hover:border-surface-5 hover:text-ink-primary disabled:text-ink-muted'
                      }`}
                    >
                      <span className="block text-sm font-semibold">{preset.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">{preset.note}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="grid gap-5 pt-5 lg:grid-cols-[1fr_1fr_0.9fr]">
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="mb-4">
            <h3 className="font-semibold text-ink-primary">房间结构</h3>
            <p className="mt-1 text-xs text-ink-muted">当前: {config.layout}</p>
          </div>
          {canEdit ? (
            <div className="grid grid-cols-2 gap-3">
              <CounterField
                label="贸易站"
                value={config.trading_stations_count}
                min={1}
                max={5}
                onChange={(value) => setStationCounts(value, 6 - value)}
              />
              <CounterField
                label="制造站"
                value={config.manufacturing_stations_count}
                min={1}
                max={5}
                onChange={(value) => setStationCounts(6 - value, value)}
              />
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <ReadOnlyMetric label="贸易站" value={config.trading_stations_count} />
              <ReadOnlyMetric label="制造站" value={config.manufacturing_stations_count} />
            </dl>
          )}
        </div>

        <div className="rounded-lg bg-surface-2/60 p-4">
          <h3 className="font-semibold text-ink-primary">产物数量</h3>
          <div className="mt-4 space-y-4">
            <ProductGroupEditor
              label="贸易"
              products={tradingProducts}
              counts={config.product_requirements.trading_stations}
              canEdit={canEdit}
              onChange={(product, value) => setProductCount('trading_stations', product, value)}
            />
            <ProductGroupEditor
              label="制造"
              products={manufacturingProducts}
              counts={config.product_requirements.manufacturing_stations}
              canEdit={canEdit}
              onChange={(product, value) => setProductCount('manufacturing_stations', product, value)}
            />
            <IntermediateInventoryEditor
              canEdit={canEdit}
              inventory={intermediateInventory}
              onChange={setIntermediateInventory}
            />
          </div>
        </div>

        <div className="rounded-lg bg-surface-2/60 p-4">
          <h3 className="font-semibold text-ink-primary">特殊策略</h3>
          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-ink-muted">排班模式</p>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-1 p-1">
                {(['maa', 'rotation'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!canEdit}
                onClick={() => onUpdate((next) => {
                  next.schedule_mode = mode
                  if (mode === 'rotation') {
                    next.Fiammetta = { ...(next.Fiammetta ?? {}), enable: false }
                      }
                      applyCounts(next)
                    })}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed ${
                      scheduleMode === mode
                        ? 'bg-brand-600 text-white'
                        : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary disabled:text-ink-muted'
                    }`}
                  >
                    {SCHEDULE_MODE_LABELS[mode]}
                  </button>
                ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-muted">
              游戏内轮换会生成两个设施预设队列，按游戏内“队列轮换/快速切换”使用；不会生成 MAA 排班 JSON。
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">换班间隔</p>
            <div className="grid grid-cols-3 gap-2">
              {SHIFT_PRESETS.map((preset) => {
                const active = shiftHoursText === formatShiftHours(preset.value)
                return (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={!canUseShiftHours}
                    onClick={() => onUpdate((next) => {
                      next.shift_hours = [...preset.value]
                      applyCounts(next)
                    })}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed ${
                      active
                        ? 'border-brand-500 bg-brand-500/10 text-brand-300'
                        : 'border-surface-4 bg-surface-1 text-ink-secondary hover:border-surface-5 hover:text-ink-primary disabled:text-ink-muted'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{preset.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">{preset.note}</span>
                  </button>
                )
              })}
            </div>
              <p className="mt-2 text-xs leading-5 text-ink-muted">
                非固定间隔按实际班次计算心情与爆仓；12-6-6 时菲亚梅塔只加速第 1、3 班目标。
              </p>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
            <span>菲亚梅塔</span>
              <input
                type="checkbox"
                checked={!rotationMode && (config.Fiammetta?.enable ?? false)}
                disabled={!canEdit || rotationMode}
                onChange={(event) => onUpdate((next) => {
                  next.Fiammetta = { enable: event.currentTarget.checked }
                  applyCounts(next)
                })}
                className="h-4 w-4 accent-brand-500"
              />
            </label>
            {rotationMode ? (
              <p className="rounded-lg bg-surface-1 px-3 py-2 text-xs leading-5 text-ink-muted">
                游戏内轮换按两班生成，菲亚梅塔不会参与计算。
              </p>
            ) : config.Fiammetta?.enable && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
              菲亚梅塔按换班节奏计算目标；12-6-6 时只加速第 1、3 班。
              </p>
            )}
            <label className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
              <span>无人机</span>
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
              <span>无人机 Auto</span>
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
                无人机顺序
              </label>
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
                className="w-full rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-sm text-ink-primary disabled:text-ink-muted"
              >
                <option value="pre">pre</option>
                <option value="post">post</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-ink-muted" htmlFor="drone-targets">
                加速目标
              </label>
                <DroneTargetsInput
                  id="drone-targets"
                  value={droneTargets}
                disabled={!canEdit || rotationMode || !config.drones?.enable || Boolean(config.drones?.auto)}
                  onChange={(value) => onUpdate((next) => {
                    next.drones = {
                      ...(next.drones ?? { enable: true, order: 'pre' }),
                      targets: value.split(',').map((item) => item.trim()).filter(Boolean),
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
        <p className="mt-4 text-sm text-warning">{validationMessage}</p>
      )}
    </section>
  )
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
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

function formatStockValue(value: number | null): string {
  return value === null ? '' : String(value)
}

function IntermediateInventoryEditor({
  canEdit,
  inventory,
  onChange,
}: {
  canEdit: boolean;
  inventory: Record<IntermediateProduct, number>;
  onChange: (product: IntermediateProduct, value: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-muted">中间产物库存</p>
      <div className="space-y-2">
        <IntermediateInventoryField
          label="源石碎片"
          product="Originium Shard"
          value={inventory['Originium Shard']}
          canEdit={canEdit}
          onChange={onChange}
        />
        <IntermediateInventoryField
          label="赤金"
          product="Pure Gold"
          value={inventory['Pure Gold']}
          canEdit={canEdit}
          onChange={onChange}
        />
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
    <label className="block rounded-lg bg-surface-1 px-3 py-3 text-sm">
      <span className="flex items-center justify-between gap-3">
        <span className="text-ink-secondary">{label}</span>
        <input
          type="number"
          min={0}
          step={1}
          value={draftValue}
          disabled={!canEdit}
          onChange={(event) => setDraftValue(event.currentTarget.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
          className="number-input-clean w-24 rounded-md border border-surface-4 bg-surface-0 px-3 py-1 text-right text-ink-primary disabled:text-ink-muted"
        />
      </span>
    </label>
  )
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
      placeholder="LMD, Pure Gold, LMD"
      className="w-full rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted disabled:text-ink-muted"
    />
  )
}

function CounterField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(() => String(value))

  useEffect(() => {
    setDraftValue(String(value))
  }, [value])

  const commitDraft = () => {
    const nextValue = Number(draftValue)
    if (!Number.isFinite(nextValue)) {
      setDraftValue(String(value))
      return
    }
    const boundedValue = Math.max(min, Math.min(max, Math.round(nextValue)))
    if (boundedValue !== value) {
      onChange(boundedValue)
    } else {
      setDraftValue(String(value))
    }
  }

  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-ink-muted">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draftValue}
        onChange={(event) => setDraftValue(event.currentTarget.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
        className="number-input-clean w-full rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
      />
    </label>
  )
}

function ReadOnlyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-1 px-3 py-2">
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
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {products.map((product) => (
        <label key={product} className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-sm">
          <span className="text-ink-secondary">{PRODUCT_LABELS[product] ?? product}</span>
          {canEdit ? (
            <ProductCountInput
              value={counts[product] ?? 0}
              onChange={(value) => onChange(product, value)}
            />
          ) : (
            <span className="font-semibold text-ink-primary">{counts[product] ?? 0}</span>
          )}
          </label>
        ))}
      </div>
    </div>
  )
}

function ProductCountInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(() => String(value))

  useEffect(() => {
    setDraftValue(String(value))
  }, [value])

  const commitDraft = () => {
    const nextValue = Number(draftValue)
    if (!Number.isFinite(nextValue)) {
      setDraftValue(String(value))
      return
    }
    const boundedValue = Math.max(0, Math.min(6, Math.round(nextValue)))
    if (boundedValue !== value) {
      onChange(boundedValue)
    } else {
      setDraftValue(String(value))
    }
  }

  return (
    <input
      type="number"
      min={0}
      max={6}
      value={draftValue}
      onChange={(event) => setDraftValue(event.currentTarget.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      className="number-input-clean w-16 rounded-md border border-surface-4 bg-surface-0 px-3 py-1 text-right text-ink-primary"
    />
  )
}
