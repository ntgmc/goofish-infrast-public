import ScheduleAnalysisTool from '../components/ScheduleAnalysisTool'
import { Link } from 'react-router-dom'

export default function ScheduleAnalysisPage() {
  return (
    <main className="min-h-screen bg-surface-0 px-4 py-6 text-ink-primary sm:px-6 lg:px-8" tabIndex={-1} data-route-focus>
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-500">MAA 小工具</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink-primary">排班表分析</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
              不需要登录或 CDK，上传干员数据和已有排班表即可查看风险与产出。
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            <Link
              to="/"
              className="rounded-lg border border-surface-3 bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary"
            >
              返回首页
            </Link>
            <Link
              to="/tool/profiles"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
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
