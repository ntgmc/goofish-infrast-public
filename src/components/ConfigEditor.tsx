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

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  basic: 'Basic',
  premium: 'Premium',
  admin: 'Admin',
}

export const CONFIG_PRESETS: Record<string, LicenseConfig> = {
  '243': {
    layout: '2-4-3',
    desc: '243 均衡流 (2赤金/2经验)',
    trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: {
      trading_stations: { LMD: 2 },
      manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 2 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
  '243-1': {
    layout: '2-4-3',
    desc: '243 搓玉 (2赤金/2源石)',
    trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: {
      trading_stations: { LMD: 1, Orundum: 1 },
      manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 2 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
  '333': {
    layout: '3-3-3',
    desc: '333 搓玉流',
    trading_stations_count: 3,
    manufacturing_stations_count: 3,
    product_requirements: {
      trading_stations: { LMD: 2, Orundum: 1 },
      manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 1 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
}

export function cloneConfig(config: LicenseConfig): LicenseConfig {
  return JSON.parse(JSON.stringify(config)) as LicenseConfig
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
  next.layout = next.layout || `${next.trading_stations_count}-${next.manufacturing_stations_count}-3`
  next.desc = next.desc || `${next.layout} 基建配置`
  next.Fiammetta = next.Fiammetta ?? { enable: false }
  next.drones = next.drones ?? { enable: false, order: 'pre', targets: [] }
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
  if (config.drones?.enable && (!Array.isArray(config.drones.targets) || config.drones.targets.length === 0)) {
    return { ok: false, message: '启用无人机时至少需要一个加速目标。' }
  }
  return { ok: true }
}

interface ConfigEditorProps {
  config: LicenseConfig;
  canEdit: boolean;
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
              ? '修改配置后重新生成，保存工作文件会保留这次配置。'
              : `当前为 ${permission ? PERMISSION_LABELS[permission] : 'Basic'} 权限，使用授权文件内的固定配置。`)}
          </p>
        </div>
        {canEdit && (
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
          </div>
        </div>

        <div className="rounded-lg bg-surface-2/60 p-4">
          <h3 className="font-semibold text-ink-primary">特殊策略</h3>
          <div className="mt-4 space-y-4">
            <label className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
              <span>菲亚梅塔</span>
              <input
                type="checkbox"
                checked={config.Fiammetta?.enable ?? false}
                disabled={!canEdit}
                onChange={(event) => onUpdate((next) => {
                  next.Fiammetta = { enable: event.currentTarget.checked }
                  applyCounts(next)
                })}
                className="h-4 w-4 accent-brand-500"
              />
            </label>
            {config.Fiammetta?.enable && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                使用菲亚梅塔需要保证换班时间固定；如果使用 MAA 自带定时换班，请将换班间隔设为 8 小时或 12 小时。
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
                disabled={!canEdit || !config.drones?.enable}
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

      {!validation.ok && (
        <p className="mt-4 text-sm text-warning">{validation.message}</p>
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
