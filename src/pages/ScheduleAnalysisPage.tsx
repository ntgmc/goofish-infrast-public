import ScheduleAnalysisTool from '../components/ScheduleAnalysisTool'
import { Link } from 'react-router-dom'

export default function ScheduleAnalysisPage() {
  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="tool-page-frame max-w-5xl">
        <header className="tool-page-header mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="tool-eyebrow">MAA 小工具</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink-primary">排班表分析</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
              不需要登录或 CDK，上传干员数据和已有排班表即可查看风险与产出。
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            <Link
              to="/"
              className="tool-secondary-action"
            >
              返回首页
            </Link>
            <Link
              to="/tool/profiles"
              className="tool-primary-action"
            >
              进入工作区
            </Link>
          </nav>
        </header>

        <ScheduleAnalysisTool />
      </div>
    </main>
  )
}
