import { useMemo } from 'react'
import type { DroneAssignment, OptimizeResult, ShiftRoom } from '../lib/types'

interface Props {
  result: OptimizeResult;
  onDownload: () => void;
  onSaveWorkfile: () => void;
  detailDefaultOpen?: boolean;
}

const ROOM_LABELS: Record<string, string> = {
  trading: '贸易站',
  manufacture: '制造站',
  control: '控制中枢',
  meeting: '会客室',
  power: '发电站',
  dormitory: '宿舍',
  processing: '加工站',
  hire: '办公室',
}

const PRODUCT_LABELS: Record<string, string> = {
  LMD: '龙门币',
  Orundum: '合成玉',
  'Pure Gold': '赤金',
  'Battle Record': '作战记录',
  'Originium Shard': '源石碎片',
}

const DRONE_REASON_LABELS: Record<string, string> = {
  'manual target': '按配置目标匹配',
  'tequila priority': '优先加速龙舌兰订单',
  'proviso priority': '优先加速但书体系',
  'highest efficiency': '选择当前最高有效效率',
}

type RoomRow = {
  key: string;
  label: string;
  indexLabel: string;
  product: string;
  operators: string;
  efficiency: string;
  speedEfficiency: string;
  detail: string;
  hasAdjustedSpeed: boolean;
}

type PreparedPlan = OptimizeResult['plans'][number] & {
  rows: RoomRow[];
}

export default function ResultPanel({ result, onDownload, onSaveWorkfile, detailDefaultOpen = false }: Props) {
  const isRotationMode = result.schedule_mode === 'rotation'
  const { totalEff, plans, productionStats, detailStats } = useMemo(() => {
    const totalEff = result.raw_results.reduce((sum, item) => sum + (item?.total_efficiency ?? 0), 0)
    const plans: PreparedPlan[] = result.plans.map((plan) => ({
      ...plan,
      rows: Object.entries(plan.rooms ?? {}).flatMap(([roomType, rooms]) => {
        if (!Array.isArray(rooms)) return []
        return rooms.flatMap((room, index) => {
          const ops = room.operators
          if (!Array.isArray(ops) || ops.length === 0) return []
          const efficiency = getDisplayEfficiency(room)
          const speedEfficiency = getEffectiveEfficiency(roomType, room)
          const detail = [getEfficiencyDetail(roomType, room), getMoodDetail(room)]
            .filter(Boolean)
            .join(' · ')
          return {
            key: `${roomType}-${index}`,
            label: ROOM_LABELS[roomType] || roomType,
            indexLabel: rooms.length > 1 ? String(index + 1) : '',
            product: formatProduct(room.product),
            operators: ops.join(', '),
            efficiency: formatPercent(efficiency),
            speedEfficiency: formatPercent(speedEfficiency),
            detail,
            hasAdjustedSpeed: Math.abs(speedEfficiency - efficiency) >= 0.05,
          }
        })
      }),
    }))

    const daily = result.daily_production ?? {}
    const manufacturing = daily.manufacturing ?? {}
    const productionStats = {
      manufacturing,
      manufacturingTotal: Object.values(manufacturing).reduce((sum, value) => sum + value, 0),
      lmd: daily.trading?.LMD ?? 0,
      orundum: daily.trading?.Orundum ?? 0,
      goldNet: daily.net?.['Pure Gold'] ?? 0,
      dronesUsed: daily.drones?.used ?? 0,
      droneMinutes: daily.drones?.acceleration_minutes ?? 0,
    }

    const detailStats = {
      planCount: plans.length,
      roomCount: plans.reduce((sum, plan) => sum + plan.rows.length, 0),
    }

    return { totalEff, plans, productionStats, detailStats }
  }, [result])

  return (
    <div className="space-y-8">
      <div className="bg-surface-1 rounded-xl p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink-primary">
              排班方案已就绪
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {result.schedule_mode_name ?? 'MAA排班表'} · {result.planTimes ?? `${detailStats.planCount} 个班次`}。
              {isRotationMode
                ? '按下方排班详情在游戏内手动设置；工作文件用于下次回到本工具继续调整练度与基建配置。'
                : '排班 JSON 用于导入或交给 MAA 使用；工作文件用于下次回到本工具继续调整练度与基建配置。'}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
            {!isRotationMode && (
              <button
                type="button"
                onClick={onDownload}
                className="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
              >
                下载排班 JSON
              </button>
            )}
            <button
              type="button"
              onClick={onSaveWorkfile}
              className="rounded-xl bg-surface-2 px-5 py-3 font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3"
            >
              保存工作文件
            </button>
          </div>
        </div>
        {isRotationMode ? <RotationManualGuide /> : <MaaImportGuide />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="预计总效率" value={totalEff.toFixed(2)} suffix="%" highlight />
        <MetricCard
          label="制造站产量"
          value={formatAmount(productionStats.manufacturingTotal)}
          suffix="件/日"
          note={formatProductionBreakdown(productionStats.manufacturing)}
        />
        <MetricCard
          label="预计日产出"
          value={formatAmount(productionStats.lmd)}
          suffix="龙门币"
          note={`赤金净变动 ${formatSigned(productionStats.goldNet)}${productionStats.orundum > 0 ? `，合成玉 ${formatAmount(productionStats.orundum)}` : ''}`}
        />
        <MetricCard
          label="无人机加速"
          value={formatAmount(productionStats.dronesUsed)}
          suffix="架"
          note={`折合 ${formatAmount(productionStats.droneMinutes)} 分钟`}
        />
      </div>

      <details className="overflow-hidden rounded-xl bg-surface-1" open={detailDefaultOpen || isRotationMode}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/60 sm:px-6">
          <span>排班详情</span>
          <span className="text-xs font-medium text-ink-muted">
            {result.planTimes ?? `${detailStats.planCount} 个班次`}，{detailStats.roomCount} 个房间
          </span>
        </summary>
        <div className="space-y-5 border-t border-surface-3/60 p-4 sm:p-5">
          {plans.map((plan, i) => (
            <div key={i} className="overflow-hidden rounded-xl bg-surface-1">
              <div className="flex items-center justify-between px-6 py-4 bg-surface-2/50">
                <span className="font-semibold text-ink-primary">
                  {plan.name || `班次 ${i + 1}`}
                </span>
                {plan.Fiammetta?.enable && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                    菲亚梅塔 → {plan.Fiammetta.target}
                  </span>
                )}
              </div>

              <div className="px-4 py-3 sm:px-6 sm:py-4">
                <div className="hidden grid-cols-[minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(0,2fr)_minmax(120px,0.8fr)] gap-4 border-b border-surface-3/60 pb-2 text-xs font-medium text-ink-muted md:grid">
                  <span>房间</span>
                  <span>产物</span>
                  <span>干员</span>
                  <span className="text-right">效率</span>
                </div>
                {plan.rows.map((row) => (
                  <div
                    key={row.key}
                    className="border-t border-surface-3/50 py-3 first:border-0 md:grid md:grid-cols-[minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(0,2fr)_minmax(120px,0.8fr)] md:items-center md:gap-4 md:first:border-t"
                  >
                    <div className="flex items-center justify-between gap-3 md:block">
                      <span className="text-sm font-medium text-ink-secondary">
                        {row.label}
                        {row.indexLabel && (
                          <span className="ml-1 text-ink-muted">{row.indexLabel}</span>
                        )}
                      </span>
                      <span className="text-xs text-ink-muted md:hidden">{row.product}</span>
                    </div>
                    <div className="hidden text-sm text-ink-muted md:block">
                      {row.product}
                    </div>
                    <div className="mt-1 min-w-0 text-sm leading-6 text-ink-primary md:mt-0">
                      {row.operators}
                    </div>
                    <div className="mt-2 md:mt-0 md:text-right">
                      <div className="text-sm font-semibold text-brand-400 md:font-mono">
                        {row.efficiency}
                      </div>
                      {row.hasAdjustedSpeed && (
                        <div className="mt-0.5 text-xs text-ink-muted">
                          速度 {row.speedEfficiency}
                        </div>
                      )}
                      {row.detail && (
                        <div className="mt-0.5 text-xs text-ink-muted">
                          {row.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {plan.drones?.enable && <DroneSummary drones={plan.drones} />}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

function MetricCard({
  label,
  value,
  suffix,
  note,
  highlight = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface-1 p-5">
      <p className="mb-2 text-sm font-medium text-ink-muted">{label}</p>
      <p className={`text-3xl font-bold ${highlight ? 'text-brand-400' : 'text-ink-primary'}`}>
        {value}
        {suffix && <span className="ml-1 text-sm font-medium text-ink-muted">{suffix}</span>}
      </p>
      {note && <p className="mt-1 text-xs text-ink-muted">{note}</p>}
    </div>
  )
}

function getDisplayEfficiency(room: ShiftRoom): number {
  return Number(room.overflow?.display_efficiency ?? room.overflow?.final_efficiency ?? room.efficiency ?? 0)
}

function getEffectiveEfficiency(roomType: string, room: ShiftRoom): number {
  if (roomType === 'trading') {
    return Number(room.overflow?.speed_efficiency ?? room.final_efficiency ?? room.efficiency ?? 0)
  }
  return Number(room.overflow?.final_efficiency ?? room.final_efficiency ?? room.efficiency ?? 0)
}

function getEfficiencyDetail(roomType: string, room: ShiftRoom): string {
  const overflow = room.overflow
  if (!overflow) return ''
  if (roomType === 'trading' && typeof overflow.time === 'string') {
    return `满单 ${overflow.time}`
  }
  if (roomType === 'trading' && typeof overflow.expected_order_time === 'string') {
    return `单均 ${overflow.expected_order_time}`
  }
  if (roomType === 'manufacture' && typeof overflow.time === 'string') {
    return `满仓 ${overflow.time}`
  }
  return ''
}

function getMoodDetail(room: ShiftRoom): string {
  const mood = room.mood ?? {}
  const entries = Object.values(mood)
  if (entries.length === 0) return ''
  const minEnd = Math.min(...entries.map((item) => Number(item.end ?? MAX_MOOD_FALLBACK)))
  const maxCost = Math.max(...entries.map((item) => Number(item.cost_per_hour ?? 0)))
  const redOps = Object.entries(mood)
    .filter(([, item]) => item.red_face)
    .map(([name]) => name)
  const parts = [`心情≥${formatCompactNumber(minEnd)}`, `最高消耗/时 ${formatCompactNumber(maxCost)}`]
  if (room.rotation?.work_hours_to_zero !== undefined && room.rotation.work_hours_to_zero !== null) {
    const triggers = room.rotation.trigger_operators?.length
      ? ` (${room.rotation.trigger_operators.join(', ')})`
      : ''
    parts.push(`轮换到零 ${formatCompactNumber(room.rotation.work_hours_to_zero)}h${triggers}`)
  }
  if (redOps.length > 0) parts.push(`红脸风险 ${redOps.join(', ')}`)
  return parts.join('，')
}

const MAX_MOOD_FALLBACK = 24

function formatProduct(product?: string): string {
  if (!product) return '-'
  return PRODUCT_LABELS[product] ?? product
}

function formatPercent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('zh-CN')
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatAmount(value)}`
}

function formatProductionBreakdown(manufacturing: Record<string, number>): string {
  const parts = ['Pure Gold', 'Battle Record', 'Originium Shard']
    .map((product) => {
      const amount = manufacturing[product] ?? 0
      return amount > 0 ? `${formatProduct(product)} ${formatAmount(amount)}` : ''
    })
    .filter(Boolean)
  return parts.length > 0 ? parts.join('，') : '暂无制造站产出'
}

function DroneSummary({ drones }: { drones: DroneAssignment }) {
  const roomLabel = ROOM_LABELS[drones.room] || drones.room
  const reason = drones.reason ? DRONE_REASON_LABELS[drones.reason] ?? drones.reason : ''

  return (
    <div className="mt-3 border-t border-surface-3/50 pt-3">
      <div className="flex flex-col gap-2 rounded-lg bg-surface-2/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-brand-100 px-2 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">
              无人机{drones.mode === 'auto' ? ' Auto' : ''}
            </span>
            <span className="text-sm font-medium text-ink-primary">
              {roomLabel} {drones.index}
              {drones.product && ` · ${formatProduct(drones.product)}`}
            </span>
          </div>
          {reason && (
            <p className="mt-1 text-xs text-ink-muted">
              {reason}
              {drones.candidate_count ? `，从 ${drones.candidate_count} 个生产房间中选择` : ''}
            </p>
          )}
        </div>
        <div className="text-left sm:text-right">
          {typeof drones.display_efficiency === 'number' && (
            <p className="text-sm font-semibold text-brand-400">{formatPercent(drones.display_efficiency)}</p>
          )}
          <p className="text-xs text-ink-muted">
            {drones.order}
            {typeof drones.efficiency === 'number' && drones.efficiency !== drones.display_efficiency
              ? ` · 速度 ${formatPercent(drones.efficiency)}`
              : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

function RotationManualGuide() {
  return (
    <div className="mt-6 border-t border-surface-3/60 pt-5">
      <div className="rounded-lg bg-surface-2/60 px-4 py-4">
        <h3 className="text-base font-semibold text-ink-primary">
          游戏内手动设置
        </h3>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          游戏内轮换不生成排班 JSON。按下方排班详情中的两个班次，逐个房间设置产物和干员；无人机加速按班次底部的无人机摘要手动处理。
        </p>
      </div>
    </div>
  )
}

export function MaaImportGuide() {
  return (
    <div className="mt-6 border-t border-surface-3/60 pt-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.25fr)] lg:items-start">
        <div>
          <h3 className="text-base font-semibold text-ink-primary">
            如何在 MAA 中使用排班 JSON
          </h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-secondary">
            <li>在 MAA 左侧勾选 <span className="font-medium text-ink-primary">基建换班</span></li>
            <li>点击 <span className="font-medium text-ink-primary">基建换班</span> 右侧 <span className="font-medium text-ink-primary">小齿轮</span></li>
            <li><span className="font-medium text-ink-primary">基建模式</span> 选择 <span className="font-medium text-ink-primary">自定义基建配置</span></li>
            <li><span className="font-medium text-ink-primary">内置配置</span> 选择 <span className="font-medium text-ink-primary">自定义</span></li>
            <li>点击选择，选择本站下载的排班 JSON</li>
          </ol>
        </div>
        <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-0">
          <img
            src="/assets/maa-import-schedule-json.png"
            alt="MAA 自定义基建配置中选择排班 JSON 的位置示意图"
            className="block h-auto w-full"
            loading="lazy"
          />
        </div>
      </div>
    </div>
  )
}
