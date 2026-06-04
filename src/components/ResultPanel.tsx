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

export default function ResultPanel({ result, onDownload, onSaveWorkfile }: Props) {
  const totalEff = result?.raw_results?.reduce((s, r) => s + (r?.total_efficiency ?? 0), 0) ?? 0

  return (
    <div className="space-y-8">
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
          {(result?.plans ?? []).map((plan, i) => (
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
                {plan.rooms && Object.entries(plan.rooms).flatMap(([roomType, rooms]) =>
                  (!Array.isArray(rooms) ? [] : rooms).map((room: Record<string, unknown>, j: number) => {
                    if (!room || typeof room !== 'object') return null
                    const ops = room.operators as string[] | undefined
                    if (!ops || !Array.isArray(ops) || ops.length === 0) return null
                    return (
                      <div 
                        key={`${roomType}-${j}`} 
                        className="flex items-center justify-between py-3 border-t border-surface-3/50 first:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-ink-secondary text-sm">
                            {ROOM_LABELS[roomType] || roomType}
                            {(rooms || []).length > 1 && (
                              <span className="text-ink-muted ml-1">{j + 1}</span>
                            )}
                          </span>
                          <span className="text-ink-muted text-xs">
                            ({(room.product as string) || '-'})
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-ink-primary text-sm">
                            {ops.join(', ')}
                          </span>
                          <span className="text-brand-400 text-sm font-mono font-medium">
                            {(typeof room.efficiency === 'number' ? room.efficiency : 0).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}

                {/* Drones */}
                {plan.drones?.enable && (
                  <div className="flex items-center gap-2 pt-3 mt-2 border-t border-surface-3/50">
                    <span className="text-lg" role="img" aria-label="无人机">🤖</span>
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

      {/* Actions */}
      <div className="flex gap-4 pt-2">
        <button
          onClick={onDownload}
          className="flex-1 bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3.5 px-6 rounded-xl transition-colors duration-150"
        >
          📋 下载 MAA 排班 JSON
        </button>
        <button
          onClick={onSaveWorkfile}
          className="flex-1 bg-surface-2 hover:bg-surface-3 text-ink-primary font-semibold py-3.5 px-6 rounded-xl transition-colors duration-150"
        >
          💾 保存工作文件
        </button>
      </div>
    </div>
  )
}