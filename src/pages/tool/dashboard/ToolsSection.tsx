import ScheduleAnalysisTool from '../../../components/ScheduleAnalysisTool'
import { Link } from 'react-router-dom'

export default function ToolsSection() {
  return (
    <div className="space-y-6">
      <section className="tool-panel p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">仓库价值分析器</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              粘贴 MAA 仓库识别导出的 JSON，生成仓库资产估值和可下载截图；不会读取或覆盖当前账号保存的数据。
            </p>
          </div>
          <Link
            to="/tools/depot-value"
            className="tool-secondary-action w-fit"
          >
            打开独立页面
          </Link>
        </div>
      </section>
      <section className="tool-panel p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">排班表分析</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              这里和公开工具页使用同一套分析能力；不会读取或覆盖当前账号保存的干员数据。
            </p>
          </div>
          <Link
            to="/tools/schedule-analysis"
            className="tool-secondary-action w-fit"
          >
            打开独立页面
          </Link>
        </div>
      </section>
      <ScheduleAnalysisTool compact />
    </div>
  )
}
