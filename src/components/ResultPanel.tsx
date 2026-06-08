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
              可直接下载给 MAA 使用的排班文件，或保存工作文件下次继续调整。
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
            <button
              onClick={onDownload}
              className="bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-5 rounded-xl transition-colors duration-150"
            >
              下载排班 JSON
            </button>
            <button
              onClick={onSaveWorkfile}
              className="bg-surface-2 hover:bg-surface-3 text-ink-primary font-semibold py-3 px-5 rounded-xl transition-colors duration-150"
            >
              保存工作文件
            </button>
          </div>
        </div>
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
              <div className="px-6 py-4 space-y-1">
                {plan.rows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center justify-between py-3 border-t border-surface-3/50 first:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-ink-secondary text-sm">
                        {row.label}
                        {row.indexLabel && (
                          <span className="text-ink-muted ml-1">{row.indexLabel}</span>
                        )}
                      </span>
                      <span className="text-ink-muted text-xs">
                        ({row.product})
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-ink-primary text-sm">
                        {row.operators}
                      </span>
                      <span className="text-brand-400 text-sm font-mono font-medium">
                        {row.efficiency}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Drones */}
                {plan.drones?.enable && (
                  <div className="flex items-center gap-2 pt-3 mt-2 border-t border-surface-3/50">
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
