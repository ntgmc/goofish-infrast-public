import ScheduleAnalysisTool from '../components/ScheduleAnalysisTool'
import { Link } from 'react-router-dom'
import { copy } from '../copy/index'
import ThemeSwitcher from '../components/ThemeSwitcher'


export default function ScheduleAnalysisPage() {
  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="tool-page-frame max-w-5xl">
        <header className="tool-page-header mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="tool-eyebrow">{copy.tools.pages_ScheduleAnalysisPage_001}</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink-primary">{copy.tools.pages_ScheduleAnalysisPage_002}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
              {copy.tools.pages_ScheduleAnalysisPage_003}</p>
          </div>
          <nav className="flex flex-wrap gap-2">
            <ThemeSwitcher />
            <Link
              to="/"
              className="tool-secondary-action"
            >
              {copy.tools.pages_ScheduleAnalysisPage_004}</Link>
            <Link
              to="/tool/profiles"
              className="tool-primary-action"
            >
              {copy.tools.pages_ScheduleAnalysisPage_005}</Link>
          </nav>
        </header>

        <ScheduleAnalysisTool />
      </div>
    </main>
  )
}
