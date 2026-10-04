import { Link } from 'react-router'
import { copy } from '../../../copy/index'
import { useSiteFeatures } from '../../../lib/site-feature-context'


export default function ToolsSection() {
  const { features } = useSiteFeatures()
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <Link to="/tools/cultivation-plan" className="tool-panel group flex flex-col overflow-hidden transition-colors hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <div aria-hidden="true" className="flex aspect-video flex-col justify-center gap-3 border-b border-surface-3 bg-surface-1 px-8">
          {[76, 52, 32].map((width, index) => <div key={width} className="flex items-center gap-3"><span className="text-xs tabular-nums text-ink-muted">0{index + 1}</span><div className="h-3 rounded-sm bg-brand-400" style={{ width: `${width}%`, opacity: 1 - index * 0.25 }} /></div>)}
        </div>
        <div className="p-5"><h2 className="text-lg font-semibold text-ink-primary">{copy.tools.cultivation.title}</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.tools.cultivation.description}</p></div>
      </Link>
      <Link to="/tools/manual-schedule" className="tool-panel group overflow-hidden transition-colors hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <img src="/assets/previews/manual-schedule.svg" alt={copy.tools.manualSchedule.preview}
          width={800} height={450} loading="lazy" className="aspect-video w-full border-b border-surface-3 object-cover" />
        <div className="p-5">
          <h2 className="text-lg font-semibold text-ink-primary">{copy.tools.manualSchedule.title}</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.tools.manualSchedule.description}</p>
        </div>
      </Link>
      {features.depot_value && (
        <Link to="/tools/depot-value" className="tool-panel group overflow-hidden transition-colors hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <img src="/assets/previews/depot-value.svg" alt={copy.tools.depotPreview}
            width={800} height={450} loading="lazy" className="aspect-video w-full border-b border-surface-3 object-cover" />
          <div className="p-5">
            <h2 className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_ToolsSection_001}</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.dashboard.pages_tool_dashboard_ToolsSection_002}</p>
        </div>
        </Link>
      )}
    </div>
  )
}
