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
const INVENTORY_AUTO_BALANCE_DAYS = 7
const ORUNDUM_SHARD_DAILY_CONSUMPTION = 24
const SHARD_DAILY_PRODUCTION = 24
const GOLD_DAILY_PRODUCTION = 20
const LMD_EXPECTED_GOLD_DAILY_CONSUMPTION =
  (24 * 60 * (2 * 0.3 + 3 * 0.5 + 4 * 0.2)) / (144 * 0.3 + 210 * 0.5 + 276 * 0.2)

type IntermediateProduct = 'Originium Shard' | 'Pure Gold'

interface IntermediateEstimate {
  stock: number | null;
  producedPerDay: number;
  consumedPerDay: number;
  netPerDay: number;
  depletionDays: number | null;
  autoBalance: boolean;
}

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  recommended: '推荐版',
  growth: '成长版',
  advanced: '进阶版',
  ultimate: '尊享版',
  admin: 'Admin',
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
  if (!shiftHours || !isValidShiftHours(shiftHours)) {
    return { ok: false, message: '换班间隔需填写为 8-8-8、12-12-12，或合计 24 小时的非固定节奏，例如 12-6-6。' }
  }
  if (config.drones?.enable && !config.drones.auto && (!Array.isArray(config.drones.targets) || config.drones.targets.length === 0)) {
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

function calculateIntermediateEstimate(config: LicenseConfig, product: IntermediateProduct): IntermediateEstimate {
  const inventory = normalizeIntermediateInventory(config.intermediate_inventory)
  const stock = inventory[product]
  const trading = config.product_requirements.trading_stations
  const manufacturing = config.product_requirements.manufacturing_stations
  const producedPerDay = product === 'Originium Shard'
    ? (manufacturing['Originium Shard'] ?? 0) * SHARD_DAILY_PRODUCTION
    : (manufacturing['Pure Gold'] ?? 0) * GOLD_DAILY_PRODUCTION
  const consumedPerDay = product === 'Originium Shard'
    ? (trading.Orundum ?? 0) * ORUNDUM_SHARD_DAILY_CONSUMPTION
    : (trading.LMD ?? 0) * LMD_EXPECTED_GOLD_DAILY_CONSUMPTION
  const netPerDay = producedPerDay - consumedPerDay
  const depletionDays = netPerDay < 0 ? stock / Math.abs(netPerDay) : null
  const autoBalance = consumedPerDay > 0 && netPerDay <= 0 && depletionDays !== null && depletionDays <= INVENTORY_AUTO_BALANCE_DAYS

  return {
    stock,
    producedPerDay,
    consumedPerDay,
    netPerDay,
    depletionDays,
    autoBalance,
  }
}

function bindAutoDrones(config: LicenseConfig): void {
  config.drones = {
    ...(config.drones ?? { order: 'pre', targets: [] }),
    enable: true,
    auto: true,
    order: config.drones?.order ?? 'pre',
    targets: Array.isArray(config.drones?.targets) ? config.drones.targets : [],
  }
}

function setRoomCounts(config: LicenseConfig, tradingCount: number, manufacturingCount: number): void {
  config.trading_stations_count = Math.max(1, Math.min(5, tradingCount))
  config.manufacturing_stations_count = Math.max(1, Math.min(5, manufacturingCount))
}

function applyIntermediateAutoBalance(config: LicenseConfig, product: IntermediateProduct): void {
  bindAutoDrones(config)

  if (product === 'Originium Shard') {
    const currentOrundum = config.product_requirements.trading_stations.Orundum ?? 0
    const orundumCount = Math.max(1, Math.min(currentOrundum || 1, config.trading_stations_count))
    const requiredManufacturing = Math.min(5, orundumCount + 1)
    if (config.manufacturing_stations_count < requiredManufacturing) {
      setRoomCounts(config, 6 - requiredManufacturing, requiredManufacturing)
    }
    const tradingOrundum = Math.min(orundumCount, config.trading_stations_count)
    const shardCount = Math.min(config.manufacturing_stations_count, tradingOrundum + 1)
    config.product_requirements.trading_stations = {
      ...(config.trading_stations_count - tradingOrundum > 0 ? { LMD: config.trading_stations_count - tradingOrundum } : {}),
      Orundum: tradingOrundum,
    }
    config.product_requirements.manufacturing_stations = {
      ...(config.manufacturing_stations_count - shardCount > 0 ? { 'Pure Gold': config.manufacturing_stations_count - shardCount } : {}),
      'Originium Shard': shardCount,
    }
    return
  }

  const lmdCount = config.trading_stations_count
  const requiredManufacturing = Math.min(5, lmdCount + 1)
  if (config.manufacturing_stations_count < requiredManufacturing) {
    setRoomCounts(config, 6 - requiredManufacturing, requiredManufacturing)
  }
  const finalLmdCount = config.trading_stations_count
  const goldCount = Math.min(config.manufacturing_stations_count, finalLmdCount + 1)
  config.product_requirements.trading_stations = { LMD: finalLmdCount }
  config.product_requirements.manufacturing_stations = {
    'Pure Gold': goldCount,
    ...(config.manufacturing_stations_count - goldCount > 0
      ? { 'Battle Record': config.manufacturing_stations_count - goldCount }
      : {}),
  }
}

interface ConfigEditorProps {
  config: LicenseConfig;
  canEdit: boolean;
  canSelectPreset?: boolean;
  changed?: boolean;
  permission?: PermissionMode;
  validation: { ok: true } | { ok: false; message: string };
  onUpdate: (mutate: (config: LicenseConfig) => void) => void;
  onReset?: () => void;
  resetLabel?: string;
  note?: string;
  embedded?: boolean;
}

export default function ConfigEditor({
  config,
  canEdit,
  canSelectPreset = false,
  changed = false,
  permission,
  validation,
  onUpdate,
  onReset,
  resetLabel = '恢复授权配置',
  note,
  embedded = false,
}: ConfigEditorProps) {
  const tradingProducts = uniqueProducts(TRADING_PRODUCTS, config.product_requirements.trading_stations)
  const manufacturingProducts = uniqueProducts(MANUFACTURING_PRODUCTS, config.product_requirements.manufacturing_stations)
  const droneTargets = (config.drones?.targets ?? []).join(', ')
  const shiftHours = parseShiftHours(config.shift_hours) ?? DEFAULT_SHIFT_HOURS
  const shiftHoursText = formatShiftHours(config.shift_hours ?? shiftHours)
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const rotationMode = scheduleMode === 'rotation'
  const validationMessage = validation.ok === false ? validation.message : null
  const shardEstimate = calculateIntermediateEstimate(config, 'Originium Shard')
  const goldEstimate = calculateIntermediateEstimate(config, 'Pure Gold')

  const applyPreset = (preset: LicenseConfig) => {
    onUpdate((next) => {
      const copy = normalizeConfig(preset)
      Object.assign(next, copy)
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
      const estimate = calculateIntermediateEstimate(next, product)
      if (estimate.autoBalance) {
        applyIntermediateAutoBalance(next, product)
      }
      applyCounts(next)
    })
  }

  return (
    <section className={embedded ? '' : 'bg-surface-1 rounded-xl p-5 sm:p-6'}>
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
              : `当前为 ${permission ? PERMISSION_LABELS[permission] : '成长版'} 权限，使用授权文件内的固定配置。`)}
          </p>
        </div>
          {(canEdit || canSelectPreset) && (
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
              shardEstimate={shardEstimate}
              goldEstimate={goldEstimate}
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
                    disabled={!canEdit || mode === 'rotation'}
                    title={mode === 'rotation' ? '游戏内轮换暂不可用' : undefined}
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
              游戏内轮换暂不可用，当前仅支持生成 MAA 排班表。
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
                    disabled={!canEdit}
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
                checked={config.drones?.enable ?? false}
                disabled={!canEdit}
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
                checked={config.drones?.auto ?? false}
                disabled={!canEdit || !config.drones?.enable}
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
                disabled={!canEdit || !config.drones?.enable}
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
              <input
                id="drone-targets"
                type="text"
                value={droneTargets}
                disabled={!canEdit || !config.drones?.enable || config.drones?.auto}
                onChange={(event) => onUpdate((next) => {
                  next.drones = {
                    ...(next.drones ?? { enable: true, order: 'pre' }),
                    targets: event.currentTarget.value.split(',').map((item) => item.trim()).filter(Boolean),
                  }
                  applyCounts(next)
                })}
                placeholder="LMD, Pure Gold, LMD"
                className="w-full rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted disabled:text-ink-muted"
              />
            </div>
          </div>
        </div>
      </div>

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

function formatDailyAmount(value: number): string {
  return `${value >= 0 ? '+' : ''}${(Math.round(value * 10) / 10).toLocaleString('zh-CN')}/日`
}

function formatDepletionDays(estimate: IntermediateEstimate): string {
  if (estimate.consumedPerDay <= 0) return '暂无消耗'
  if (estimate.depletionDays === null) return '不会消耗完'
  if (estimate.depletionDays < 0.1) return '<0.1 日'
  return `${(Math.round(estimate.depletionDays * 10) / 10).toLocaleString('zh-CN')} 日`
}

function IntermediateInventoryEditor({
  canEdit,
  shardEstimate,
  goldEstimate,
  onChange,
}: {
  canEdit: boolean;
  shardEstimate: IntermediateEstimate;
  goldEstimate: IntermediateEstimate;
  onChange: (product: IntermediateProduct, value: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-muted">中间产物库存</p>
      <div className="space-y-2">
        <IntermediateInventoryField
          label="源石碎片"
          product="Originium Shard"
          estimate={shardEstimate}
          canEdit={canEdit}
          onChange={onChange}
        />
        <IntermediateInventoryField
          label="赤金"
          product="Pure Gold"
          estimate={goldEstimate}
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
  estimate,
  canEdit,
  onChange,
}: {
  label: string;
  product: IntermediateProduct;
  estimate: IntermediateEstimate;
  canEdit: boolean;
  onChange: (product: IntermediateProduct, value: number) => void;
}) {
  return (
    <label className="block rounded-lg bg-surface-1 px-3 py-3 text-sm">
      <span className="flex items-center justify-between gap-3">
        <span className="text-ink-secondary">{label}</span>
        <input
          type="number"
          min={0}
          step={1}
          value={formatStockValue(estimate.stock)}
          disabled={!canEdit}
          onChange={(event) => onChange(product, Number(event.currentTarget.value))}
          className="number-input-clean w-24 rounded-md border border-surface-4 bg-surface-0 px-3 py-1 text-right text-ink-primary disabled:text-ink-muted"
        />
      </span>
      <span className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink-muted">
        <span>净变动 {formatDailyAmount(estimate.netPerDay)}</span>
        <span className={estimate.autoBalance ? 'text-warning' : undefined}>
          消耗完 {formatDepletionDays(estimate)}
        </span>
      </span>
    </label>
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
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-ink-muted">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
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
              <input
                type="number"
                min={0}
                max={6}
                value={counts[product] ?? 0}
                onChange={(event) => onChange(product, Number(event.currentTarget.value))}
                className="number-input-clean w-16 rounded-md border border-surface-4 bg-surface-0 px-3 py-1 text-right text-ink-primary"
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
