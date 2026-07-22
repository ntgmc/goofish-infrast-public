import { Link } from 'react-router-dom'
import { copy } from '../../../copy/index'
import { useSiteFeatures } from '../../../lib/site-feature-context'


export default function ToolsSection() {
  const { features } = useSiteFeatures()
  return (
    <div className="space-y-6">
      {features.depot_value && (
      <section className="tool-panel p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_ToolsSection_001}</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {copy.dashboard.pages_tool_dashboard_ToolsSection_002}</p>
          </div>
          <Link
            to="/tools/depot-value"
            className="tool-secondary-action w-fit"
          >
            {copy.dashboard.pages_tool_dashboard_ToolsSection_003}</Link>
        </div>
      </section>
      )}
    </div>
  )
}
