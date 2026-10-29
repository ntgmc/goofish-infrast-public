import { useState, type ComponentProps } from 'react'
import { ExportIcon } from '../../components/icons'
import { copy } from '../../copy'
import type { PreparedResult } from '../../components/result-panel/formatters'
import type { OptimizeResult } from '../../lib/types'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { getMaaExportNotice } from '../tool/optimize/maa-export-notice'
import ResultExportDrawer from './ResultExportDrawer'
import type { V2Workflow } from './WorkspaceSections'

export default function ManualResultExport({ result, resultId, prepared, shift, workflow, onRecover }: {
  result: OptimizeResult
  resultId: string
  prepared: PreparedResult
  shift: number
  workflow: V2Workflow
  onRecover: ComponentProps<typeof ResultExportDrawer>['onRecover']
}) {
  const { features } = useSiteFeatures()
  const [open, setOpen] = useState(false)
  const busy = workflow.loading || Boolean(workflow.workspaceBusyAction?.startsWith('download'))
  const failure = workflow.exportFailure?.resultId === resultId ? workflow.exportFailure : null
  return <>
    <button type="button" className="tool-primary-action" disabled={busy} onClick={() => setOpen(true)}>
      <ExportIcon size={16} aria-hidden="true" />{copy.v2.export}
    </button>
    <ResultExportDrawer open={open} onOpenChange={setOpen} result={result} prepared={prepared} shift={shift} busy={busy}
      failure={failure} exportNotice={workflow.workspaceNotice ?? getMaaExportNotice(result.schedule_mode, features.maa_export, workflow)}
      onRecover={(action) => { setOpen(false); onRecover(action) }}
      onDownloadMaa={features.maa_export ? () => void workflow.downloadMaaResult(resultId) : undefined}
      onDownloadFullResult={features.full_result_export && workflow.userCanDownloadFullResult ? () => void workflow.downloadFullResult(resultId) : undefined} />
  </>
}
