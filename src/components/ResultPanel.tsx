import { useMemo } from 'react'
import type { OptimizeResult } from '../lib/types'

interface Props {
  result: OptimizeResult;
  onDownload: () => void;
  onSaveWorkfile: () => void;
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

type RoomRow = {
  key: string;
  label: string;
  indexLabel: string;
  product: string;
  operators: string;
  efficiency: string;
}

type PreparedPlan = OptimizeResult['plans'][number] & {
  rows: RoomRow[];
}

export default function ResultPanel({ result, onDownload, onSaveWorkfile }: Props) {
  const { totalEff, plans } = useMemo(() => {
    const totalEff = result.raw_results.reduce((sum, item) => sum + (item?.total_efficiency ?? 0), 0)
    const plans: PreparedPlan[] = result.plans.map((plan) => ({
      ...plan,
      rows: Object.entries(plan.rooms ?? {}).flatMap(([roomType, rooms]) => {
        if (!Array.isArray(rooms)) return []
        return rooms.flatMap((room, index) => {
          const ops = room.operators
          if (!Array.isArray(ops) || ops.length === 0) return []
          return {
            key: `${roomType}-${index}`,
            label: ROOM_LABELS[roomType] || roomType,
            indexLabel: rooms.length > 1 ? String(index + 1) : '',
            product: room.product || '-',
            operators: ops.join(', '),
            efficiency: `${(typeof room.efficiency === 'number' ? room.efficiency : 0).toFixed(1)}%`,
          }
        })
      }),
    }))

    return { totalEff, plans }
  }, [result])

  return (
    <div className="space-y-8">
      {/* Result actions */}
      <div className="bg-surface-1 rounded-xl p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink-primary">
              排班方案已就绪
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              排班 JSON 用于导入或交给 MAA 使用；工作文件用于下次回到本工具继续调整练度与基建配置。
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
            <button
              type="button"
              onClick={onDownload}
              className="bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-5 rounded-xl transition-colors duration-150"
            >
              下载排班 JSON
            </button>
            <button
              type="button"
              onClick={onSaveWorkfile}
              className="bg-surface-2 hover:bg-surface-3 text-ink-primary font-semibold py-3 px-5 rounded-xl transition-colors duration-150"
            >
              保存工作文件
            </button>
          </div>
        </div>
        <MaaImportGuide />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-surface-1 rounded-xl p-6">
          <p className="text-ink-muted text-sm font-medium mb-2">预计总效率</p>
          <p className="text-4xl font-bold text-brand-400">
            {totalEff.toFixed(2)}
            <span className="text-lg text-ink-muted ml-1">%</span>
          </p>
        </div>
        <div className="bg-surface-1 rounded-xl p-6">
          <p className="text-ink-muted text-sm font-medium mb-2">建筑类型</p>
          <p className="text-4xl font-bold text-ink-primary">
            {result?.buildingType ?? '-'}
          </p>
        </div>
      </div>

      {/* Shift plans */}
      <div>
        <h3 className="text-lg font-semibold text-ink-primary mb-5">排班详情</h3>
        <div className="space-y-5">
          {plans.map((plan, i) => (
            <div key={i} className="bg-surface-1 rounded-xl overflow-hidden">
              {/* Plan header */}
              <div className="flex items-center justify-between px-6 py-4 bg-surface-2/50">
                <span className="font-semibold text-ink-primary">
                  {plan.name || `班次 ${i + 1}`}
                </span>
                {plan.Fiammetta?.enable && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning/10 text-warning text-xs font-medium">
                    菲亚梅塔 → {plan.Fiammetta.target}
                  </span>
                )}
              </div>

              {/* Rooms */}
              <div className="px-4 py-3 sm:px-6 sm:py-4">
                <div className="hidden grid-cols-[minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(0,2fr)_90px] gap-4 border-b border-surface-3/60 pb-2 text-xs font-medium text-ink-muted md:grid">
                  <span>房间</span>
                  <span>产物</span>
                  <span>干员</span>
                  <span className="text-right">效率</span>
                </div>
                {plan.rows.map((row) => (
                  <div
                    key={row.key}
                    className="border-t border-surface-3/50 py-3 first:border-0 md:grid md:grid-cols-[minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(0,2fr)_90px] md:items-center md:gap-4 md:first:border-t"
                  >
                    <div className="flex items-center justify-between gap-3 md:block">
                      <span className="text-sm font-medium text-ink-secondary">
                        {row.label}
                        {row.indexLabel && (
                          <span className="text-ink-muted ml-1">{row.indexLabel}</span>
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
                    <div className="mt-2 text-sm font-medium text-brand-400 md:mt-0 md:text-right md:font-mono">
                      {row.efficiency}
                    </div>
                  </div>
                ))}

                {/* Drones */}
                {plan.drones?.enable && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-surface-3/50 pt-3">
                    <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-ink-secondary">
                      无人机
                    </span>
                    <span className="text-ink-secondary text-sm">
                      无人机 → {plan.drones.room} {plan.drones.index}
                    </span>
                    <span className="text-ink-muted text-xs">
                      ({plan.drones.order})
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
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
