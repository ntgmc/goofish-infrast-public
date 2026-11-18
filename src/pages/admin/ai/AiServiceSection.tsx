import { useContext, useState } from 'react'
import { copy } from '../../../copy'
import { AdminQueryScope } from '../../../lib/private-query-scope'
import { AdminTabs } from '../shared/AdminTabs'
import AiSettingsSection from './AiSettingsSection'
import AiUsageSection from './AiUsageSection'

export default function AiServiceSection() {
  const scope = useContext(AdminQueryScope)
  const [view, setView] = useState<'usage' | 'settings'>('usage')
  const [settingsVisited, setSettingsVisited] = useState(false)
  return <div className="min-w-0"><AdminTabs label={copy.aiUsage.tabs} value={view}
    items={[{ id: 'usage', label: copy.aiUsage.records }, { id: 'settings', label: copy.aiUsage.settings }]}
    onChange={(next) => { setView(next); if (next === 'settings') setSettingsVisited(true) }} />
    <AdminQueryScope.Provider value={{ ...scope, active: scope.active && view === 'usage' }}><div hidden={view !== 'usage'}><AiUsageSection /></div></AdminQueryScope.Provider>
    {settingsVisited && <AdminQueryScope.Provider value={{ ...scope, active: scope.active && view === 'settings' }}><div hidden={view !== 'settings'}><AiSettingsSection /></div></AdminQueryScope.Provider>}
  </div>
}
