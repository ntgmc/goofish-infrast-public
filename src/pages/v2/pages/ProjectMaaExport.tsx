import { useId, useState } from 'react'
import { ExportIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import { buildMaaCultivationPlan, type CultivationProject, type ProjectOperator } from '../../../lib/cultivation-projects'
import { Notice } from '../components/WorkspaceUI'

const text = copy.cultivationProjects

export function ProjectMaaExport({ projects, operators }: { projects: CultivationProject[]; operators: ProjectOperator[] }) {
  const hintId = useId()
  const plan = buildMaaCultivationPlan(projects, operators)
  const content = plan?.length ? JSON.stringify(plan, null, 2) : ''
  const [feedback, setFeedback] = useState<{ content: string; error: boolean } | null>(null)
  const currentFeedback = feedback?.content === content ? feedback : null
  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(content)
      setFeedback({ content, error: false })
    } catch {
      setFeedback({ content, error: true })
    }
  }
  return <details className="v2-project-material-detail">
    <summary><ExportIcon size={16} aria-hidden="true" />{text.maaExport}</summary>
    <p className="v2-muted" id={hintId}>{text.maaHint}</p>
    <p className="v2-muted">{text.maaLevelHint}</p>
    {!content ? <Notice>{plan === null ? text.maaUnavailable : text.maaEmpty}</Notice> : <>
      <div className="v2-actions"><button className="v2-button v2-button-secondary" onClick={() => void copyPlan()}>{text.maaCopy}</button></div>
      <Notice error={currentFeedback?.error}>{currentFeedback ? currentFeedback.error ? text.maaCopyFailed : text.maaCopied : null}</Notice>
      <label className="v2-field"><span>{text.maaContent}</span><textarea className="v2-input" readOnly rows={8} value={content} aria-describedby={hintId} onFocus={(event) => event.currentTarget.select()} /></label>
    </>}
  </details>
}
