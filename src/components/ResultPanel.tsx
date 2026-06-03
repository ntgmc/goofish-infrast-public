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
  const totalEff = result.raw_results?.reduce((s, r) => s + r.total_efficiency, 0) || 0

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm">预计总效率</p>
          <p className="text-3xl font-bold text-green-400">{totalEff.toFixed(2)}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm">建筑类型</p>
          <p className="text-3xl font-bold">{result.buildingType}</p>
        </div>
      </div>

      <h3 className="text-lg font-bold mb-3">排班详情</h3>
      <div className="space-y-4 mb-6">
        {result.plans?.map((plan, i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <span className="font-bold text-lg">{plan.name || `班次 ${i + 1}`}</span>
              {plan.Fiammetta?.enable && (
                <span className="text-xs bg-yellow-900/40 text-yellow-300 px-2 py-1 rounded">
                  菲亚梅塔 → {plan.Fiammetta.target}
                </span>
              )}
            </div>
            {plan.rooms && Object.entries(plan.rooms).map(([roomType, rooms]) =>
              rooms?.map((room: Record<string, unknown>, j: number) => {
                const ops = room.operators as string[] | undefined
                if (!ops || ops.length === 0) return null
                return (
                  <div key={`${roomType}-${j}`} className="flex justify-between text-sm text-gray-300 py-1 border-t border-gray-700/50">
                    <span>{ROOM_LABELS[roomType] || roomType}{rooms.length > 1 ? ` ${j + 1}` : ''} ({(room.product as string) || '-'})</span>
                    <span>{ops.join(', ')} — {((room.efficiency as number) || 0).toFixed(1)}%</span>
                  </div>
                )
              })
            )}
            {plan.drones?.enable && (
              <div className="text-xs text-gray-500 mt-2 pt-1 border-t border-gray-700/50">
                🚁 无人机 → {plan.drones.room} {plan.drones.index} ({plan.drones.order})
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onDownload}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition"
        >
          📥 下载 MAA 排班 JSON
        </button>
        <button
          onClick={onSaveWorkfile}
          className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded transition"
        >
          💾 保存工作文件
        </button>
      </div>
    </div>
  )
}
