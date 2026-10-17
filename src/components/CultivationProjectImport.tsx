import { useState } from 'react'
import { copy } from '../copy'
import { mergeCultivationProjects, readCultivationProjects, saveCultivationProjects, type CultivationProjectScope } from '../lib/cultivation-project-import'
import type { CultivationProject } from '../lib/cultivation-projects'
import { useSiteFeatures } from '../lib/site-feature-context'
import { v2Path } from '../pages/v2/navigation'
import InternalLink from './InternalLink'

const text = copy.cultivationProjects

export default function CultivationProjectImport({ scope, projects, batch = false, partial = false, v2 = false }: {
  scope: CultivationProjectScope
  projects: CultivationProject[]
  batch?: boolean
  partial?: boolean
  v2?: boolean
}) {
  const { features } = useSiteFeatures()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  if (!features.site || !features.cultivation_plan || !features.v2 || !projects.length) return null
  function add() {
    try {
      const merged = mergeCultivationProjects(readCultivationProjects(scope), projects)
      saveCultivationProjects(scope, merged.projects)
      setMessage({ text: text.imported(merged.added, merged.kept), error: false })
    } catch (error) {
      setMessage({ text: error instanceof Error && error.message === 'project_limit' ? text.importLimit : text.importFailed, error: true })
    }
  }
  return <div className="space-y-2">
    <button type="button" className={v2 ? 'v2-text-button' : 'tool-secondary-action whitespace-nowrap text-sm'} onClick={add}>{batch ? text.importBatch : text.importSuggestion}</button>
    {partial && <p className="text-xs leading-5 text-ink-muted">{text.importScopeHint}</p>}
    {message && <p role={message.error ? 'alert' : 'status'} className="text-sm leading-6 text-ink-secondary">{message.text}{!message.error && <> <InternalLink className={v2 ? 'v2-text-button' : 'underline underline-offset-4'} to={v2Path('cultivation-projects', scope.profileId)}>{text.openProjects}</InternalLink></>}</p>}
  </div>
}
