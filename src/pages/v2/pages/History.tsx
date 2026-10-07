import { useEffect, useState } from 'react'
import { Archive, ArrowRight, FileClock, Search } from 'lucide-react'
import { copy } from '../../../copy'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { formatPlanName, formatResultHistorySummary, formatWorkspaceDate } from '../../../lib/workspace-history'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../../lib/workspace-limits'
import type { WorkspaceResultHistorySummary } from '../../../lib/types'
import type { V2Workflow } from '../WorkspaceSections'
import { EmptyState, Facts, Field, Notice, SectionTitle } from '../components/WorkspaceUI'

const text = copy.optimize

export default function History({ workflow: w }: { workflow: V2Workflow }) {
  const { features } = useSiteFeatures()
  const [view, setView] = useState('results')
  const [archived, setArchived] = useState(false)
  const [chosen, setChosen] = useState(w.historyItem?.id ?? '')
  const [search, setSearch] = useState('')
  const [draftName, setDraftName] = useState(formatPlanName(w.activeConfig))
  useEffect(() => setDraftName(formatPlanName(w.activeConfig)), [w.activeConfig.desc, w.activeConfig.layout])
  const planLimit = w.profileCapacity?.plan_slots.limit ?? WORKSPACE_SAVED_CONFIG_LIMIT
  const historyLimit = w.profileCapacity?.history_slots.limit ?? WORKSPACE_RESULT_HISTORY_LIMIT
  const historyUsed = w.profileCapacity?.history_slots.used ?? w.resultHistory.length
  const archiveLimit = w.profileCapacity?.archive_slots.limit ?? 0
  const records = (archived ? w.archivedResults : w.resultHistory).filter((item) => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const selected = records.find((item) => item.id === chosen) ?? records[0]
  const hasMore = archived ? w.archivedResultsHasMore : w.resultHistoryHasMore
  return <div className="v2-history-workspace">
    <Notice error>{w.workspaceError ?? w.resultHistoryError}</Notice><Notice>{w.workspaceNotice}</Notice>
    <nav className="v2-view-switch" aria-label={copy.v2.history}><button aria-pressed={view === 'results'} onClick={() => setView('results')}><FileClock size={18} />{copy.v2.savedResults}<span>{historyUsed}</span></button><button aria-pressed={view === 'configs'} onClick={() => setView('configs')}>{copy.v2.savedConfigurations}<span>{w.savedConfigs.length}</span></button></nav>
    <section hidden={view !== 'results'}>
      <div className="v2-record-toolbar"><label className="v2-search"><Search size={18} aria-hidden="true" /><input aria-label={copy.v2.searchRecords} value={search} placeholder={copy.v2.searchRecords} onChange={(event) => setSearch(event.target.value)} /></label><div className="v2-filter-group" role="group" aria-label={copy.v2.savedResults}><button aria-pressed={!archived} onClick={() => setArchived(false)}>{text.pages_tool_optimize_PlansSection_028} {historyUsed}/{historyLimit}</button>{archiveLimit > 0 && <button aria-pressed={archived} onClick={() => setArchived(true)}><Archive size={16} />{copy.inventory.archive_title} {w.profileCapacity?.archive_slots.used ?? w.archivedResults.length}/{archiveLimit}</button>}</div></div>
      <div className="v2-selection-workspace v2-record-workspace"><div className="v2-record-index">{records.map((record) => <article key={record.id} className="v2-record" aria-label={record.name} aria-current={selected?.id === record.id ? 'true' : undefined}>
        <button className="v2-record-select" aria-pressed={selected?.id === record.id} onClick={() => setChosen(record.id)}><time>{formatWorkspaceDate(record.created_at)}</time><strong>{record.name}</strong><span>{formatResultHistorySummary(record)}</span></button>
        <button className="v2-text-button" disabled={w.workspaceBusyAction === `detail:${record.id}`} onClick={() => void w.handleViewHistory(record)}>{text.pages_tool_optimize_PlansSection_030}<ArrowRight size={16} /></button>
      </article>)}{!records.length && <EmptyState title={archived ? copy.inventory.archive_empty : text.pages_tool_optimize_PlansSection_029} />}{hasMore && <button className="v2-button v2-button-secondary" disabled={w.resultHistoryLoadingScope !== null} onClick={() => void (archived ? w.loadMoreArchivedResults() : w.loadMoreResultHistory())}>{w.resultHistoryLoadingScope ? text.pages_tool_optimize_result_history_loading : text.pages_tool_optimize_result_history_load_more}</button>}</div>
        {selected ? <RecordDetails key={selected.id} record={selected} workflow={w} archived={archived} historyFull={historyUsed >= historyLimit} archiveLimit={archiveLimit} exportEnabled={features.maa_export} /> : <EmptyState title={copy.v2.selectRecord}>{copy.v2.selectRecordHint}</EmptyState>}
      </div>
    </section>
    <section hidden={view !== 'configs'} className="v2-config-library"><SectionTitle title={text.pages_tool_optimize_PlansSection_002} description={text.pages_tool_optimize_PlansSection_003} />
      <form className="v2-save-config" onSubmit={(event) => { event.preventDefault(); void w.handleSaveCurrentConfig(draftName) }}><Field label={text.pages_tool_optimize_PlansSection_004} value={draftName} maxLength={40} disabled={w.savedConfigs.length >= planLimit} onChange={(event) => setDraftName(event.target.value)} /><button type="submit" className="v2-button v2-button-primary" disabled={w.workspaceBusyAction === 'save-current' || w.savedConfigs.length >= planLimit}>{w.workspaceBusyAction === 'save-current' ? text.pages_tool_optimize_PlansSection_006 : text.pages_tool_optimize_PlansSection_007}</button><span>{w.savedConfigs.length}/{planLimit}</span></form>
      {w.savedConfigs.length >= planLimit && <Notice>{text.pages_tool_optimize_PlansSection_010}</Notice>}
      {!w.savedConfigs.length ? <EmptyState title={text.pages_tool_optimize_PlansSection_023} /> : <div className="v2-config-list">{w.savedConfigs.map((item) => <article key={item.id}><div><h3>{item.name}</h3><p>{formatPlanName(item.config)} · {formatWorkspaceDate(item.updated_at)}</p></div><div className="v2-actions"><button className="v2-button v2-button-secondary" disabled={w.loading || item.read_only || w.workspaceBusyAction === `touch:${item.id}`} onClick={() => w.handleUseSavedConfig(item)}>{text.pages_tool_optimize_PlansSection_025}</button><button className="v2-text-button" disabled={item.read_only || w.workspaceBusyAction === `rename:${item.id}`} onClick={() => void w.handleRenameSavedConfig(item)}>{text.pages_tool_optimize_PlansSection_026}</button><button className="v2-text-button v2-danger" disabled={w.workspaceBusyAction === `delete:${item.id}`} onClick={() => void w.handleDeleteSavedConfig(item)}>{text.pages_tool_optimize_PlansSection_027}</button></div></article>)}</div>}
    </section>
  </div>
}

function RecordDetails({ record, workflow: w, archived, historyFull, archiveLimit, exportEnabled }: { record: WorkspaceResultHistorySummary; workflow: V2Workflow; archived: boolean; historyFull: boolean; archiveLimit: number; exportEnabled: boolean }) {
  return <aside className="v2-record-details"><span className="v2-label">{archived ? copy.inventory.archive_title : copy.v2.savedResults}</span><h2>{record.name}</h2><p>{formatResultHistorySummary(record)}</p><Facts items={[[copy.v2.updated, formatWorkspaceDate(record.created_at)], [copy.v2.operatorData, record.operator_count]]} />
    <div className="v2-record-actions">{exportEnabled && <button className="v2-button v2-button-primary" disabled={w.workspaceBusyAction === `download:${record.id}` || !record.maa_exportable} onClick={() => void w.handleDownloadHistory(record)}>{w.workspaceBusyAction === `download:${record.id}` ? copy.inventory.export_downloading : text.pages_tool_optimize_PlansSection_031}</button>}<button className="v2-button v2-button-secondary" disabled={w.loading || w.workspaceBusyAction === `detail:${record.id}` || !record.has_config} onClick={() => void w.handleUseHistoryConfig(record)}>{text.pages_tool_optimize_PlansSection_032}</button>
      {archived ? <><button className="v2-text-button" disabled={historyFull || w.workspaceBusyAction === `unarchive:${record.id}`} onClick={() => void w.handleUnarchiveHistory(record)}>{copy.inventory.unarchive_action}</button><button className="v2-text-button" disabled={w.workspaceBusyAction === `rename:${record.id}`} onClick={() => void w.handleRenameArchivedHistory(record)}>{copy.inventory.archive_rename_action}</button>{historyFull && <Notice>{copy.inventory.history_full_for_unarchive}</Notice>}</> : <><button className="v2-text-button" disabled={archiveLimit < 1 || w.workspaceBusyAction === `archive:${record.id}`} onClick={() => void w.handleArchiveHistory(record)}>{copy.inventory.archive_action}</button><button className="v2-text-button v2-danger" disabled={w.workspaceBusyAction === `delete:${record.id}`} onClick={() => void w.handleDeleteHistory(record)}>{copy.inventory.delete_result}</button></>}
    </div>
  </aside>
}
