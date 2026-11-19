import { useState } from 'react'
import Link from '../../components/InternalLink'
import { copy } from '../../copy'
import { scheduleChanges } from '../../lib/account-changes'
import { formatWorkspaceDate } from '../../lib/workspace-history'
import type { OptimizeResult, WorkspaceResultHistorySummary } from '../../lib/types'
import { useResultHistoryDetailQuery } from '../tool/optimize/result-history-query'
import AccountChanges from './AccountChanges'
import { Notice } from './components/WorkspaceUI'
import { v2Path } from './navigation'

const text = copy.v2.workspaceAssistant

export default function ResultChanges({ userId, profileId, result, previous }: { userId: string; profileId: string; result: OptimizeResult; previous: WorkspaceResultHistorySummary }) {
  const [open, setOpen] = useState(false)
  const query = useResultHistoryDetailQuery(userId, profileId, open ? previous.id : undefined)
  const changes = query.data ? scheduleChanges(query.data.result, result) : null
  return <details className="v2-disclosure v2-change-list" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{text.resultChanges}</summary>
    {open && <>
      {query.isLoading && <p role="status">{copy.v2.loadingResult}</p>}
      {query.isError && <Notice error>{text.changesRetry} <button type="button" className="v2-text-button" onClick={() => void query.refetch()}>{copy.v2.retry}</button></Notice>}
      {changes && <><p className="v2-muted">{text.previousResult(formatWorkspaceDate(previous.created_at))}</p>
        <AccountChanges userId={userId} profileId={profileId} changes={changes}>
          {changes.length > 0 && <p className="v2-muted">{text.resultNext} <Link className="v2-text-button" to={v2Path('plans', profileId)}>{copy.v2.history}</Link></p>}
        </AccountChanges>
      </>}
    </>}
  </details>
}
