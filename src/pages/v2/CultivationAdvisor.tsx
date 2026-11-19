import { useState } from 'react'
import CultivationProjectImport from '../../components/CultivationProjectImport'
import { copy } from '../../copy'
import { matchesSearch } from '../../lib/search'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { CultivationProject } from '../../lib/cultivation-projects'
import type { CultivationProjectScope } from '../../lib/cultivation-project-import'
import { allocateCultivationMaterials } from '../../lib/cultivation-planner'
import type { CultivationData } from '../../lib/cultivation-contract'
import WorkspaceAssistant from './WorkspaceAssistant'
import { Field, Notice } from './components/WorkspaceUI'

const text = copy.v2.workspaceAssistant
const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
export type AdvisorRow = { id: string; title: string; facts: string[]; projects?: CultivationProject[]; partial?: boolean }

export function cultivationMaterialFacts(items: Record<string, number>, data: CultivationData, warnings: string[]) {
  if (warnings.length) return [text.unknownCost]
  const estimate = allocateCultivationMaterials(items, data.inventory, data)
  const missing = Object.keys(estimate.missing).length
  return [missing ? text.missingKinds(missing) : text.readyMaterials,
    ...(missing ? [estimate.sanity === null ? text.materialUnknown : text.missingSanity(format(estimate.sanity))] : [])]
}

type Props = { scope: CultivationProjectScope; rows: AdvisorRow[]; title?: string; description?: string }

export default function CultivationAdvisor(props: Props) {
  const { features, pauseNotices } = useSiteFeatures()
  return (features.ai_cultivation_advisor || pauseNotices?.ai_cultivation_advisor) && props.rows.length ? <Advisor key={`${props.scope.userId}:${props.scope.profileId}`} {...props} /> : null
}

function Advisor({ scope, rows, title = text.cultivation, description = text.cultivationHelp }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>(() => rows.slice(0, 3).map((row) => row.id))
  const chosen = rows.filter((row) => selected.includes(row.id)).slice(0, 8).map((row, index) => ({ ...row, key: `candidate-${index + 1}` }))
  const visible = rows.filter((row) => matchesSearch(row.title, search) || selected.includes(row.id)).slice(0, Math.max(12, selected.length))
  const signature = JSON.stringify(chosen.map(({ id, title, facts }) => [id, title, facts]))
  if (!rows.length) return null
  return <WorkspaceAssistant task="cultivation" revision={signature} title={title} userId={scope.userId} profileId={scope.profileId} description={description} example={text.cultivationExample} disabled={!chosen.length}
      renderControls={(busy) => <details className="v2-disclosure"><summary>{text.cultivationCandidates} · {chosen.length}</summary>
        <Field label={copy.tools.cultivation.search} type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
        {!visible.length && <p>{copy.tools.cultivation.noMatches}</p>}
        <div className="v2-choice-list">{visible.map((row) => <label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} disabled={busy || (chosen.length >= 8 && !selected.includes(row.id))} onChange={(event) => { const checked = event.currentTarget.checked; setSelected((previous) => checked ? [...previous, row.id] : previous.filter((id) => id !== row.id)) }} /><span>{row.title}</span></label>)}</div>
      </details>}
      buildRequest={(question) => ({ task: 'cultivation', profile_id: scope.profileId, question, candidates: chosen.map(({ key, title, facts }) => ({ key, title, facts })) })}
      renderReply={(reply) => 'keys' in reply && reply.keys.length ? <ol>{reply.keys.map((key) => {
        const row = chosen.find((candidate) => candidate.key === key)
        if (!row) return null
        return <li key={row.id}><strong>{row.title}</strong><ul>{row.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
          {row.projects?.length ? <CultivationProjectImport key={row.id} scope={scope} projects={row.projects} partial={row.partial} v2 /> : null}</li>
      })}</ol> : <Notice>{text.noCandidate}</Notice>} />
}
