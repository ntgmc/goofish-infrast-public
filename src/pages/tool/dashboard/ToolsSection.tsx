import { Link } from 'react-router'
import { copy } from '../../../copy/index'
import { useSiteFeatures } from '../../../lib/site-feature-context'


export default function ToolsSection() {
  const { features } = useSiteFeatures()
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <div aria-disabled="true" className="tool-panel cursor-not-allowed overflow-hidden">
        <img src="/assets/previews/optimize-result-light.png" alt={copy.tools.manualSchedule.preview}
          width={1200} height={675} loading="lazy" className="aspect-video w-full border-b border-surface-3 object-cover object-top opacity-60" />
        <div className="p-5">
          <h2 className="text-lg font-semibold text-ink-primary">{copy.tools.manualSchedule.title}</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.tools.manualSchedule.pending}</p>
        </div>
      </div>
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
