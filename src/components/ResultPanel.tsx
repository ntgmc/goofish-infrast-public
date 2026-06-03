import type { OptimizeResult } from '../lib/types'

interface Props {
  result: OptimizeResult;
  onDownload: () => void;
  onSaveWorkfile: () => void;
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
      <div className="space-y-2 mb-6">
        {result.raw_results?.map((res, i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold">班次 {i + 1}</span>
              <span className="text-green-400">效率: {res.total_efficiency.toFixed(2)}</span>
            </div>
            <div className="space-y-1">
              {res.assignment_detail?.map((d, j) => (
                <div key={j} className="flex justify-between text-sm text-gray-300">
                  <span>{d.workplace} ({d.product || '-'})</span>
                  <span>{d.ops.join(', ')} — {d.eff.toFixed(1)}%</span>
                </div>
              ))}
            </div>
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
