import ScheduleAnalysisTool from '../../../components/ScheduleAnalysisTool'

export default function ToolsSection() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-surface-3 bg-surface-1 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">仓库价值分析器</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              粘贴 MAA 仓库识别导出的 JSON，生成仓库资产估值和可下载截图；不会读取或覆盖当前账号保存的数据。
            </p>
          </div>
          <a
            href="/tools/depot-value"
            className="inline-flex w-fit items-center justify-center rounded-lg border border-surface-3 bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary"
          >
            打开独立页面
          </a>
        </div>
      </section>
      <section className="rounded-lg border border-surface-3 bg-surface-1 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">排班表分析</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              这里和公开工具页使用同一套分析能力；不会读取或覆盖当前账号保存的干员数据。
            </p>
          </div>
          <a
            href="/tools/schedule-analysis"
            className="inline-flex w-fit items-center justify-center rounded-lg border border-surface-3 bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary"
          >
            打开独立页面
          </a>
        </div>
      </section>
      <ScheduleAnalysisTool compact />
    </div>
  )
}
